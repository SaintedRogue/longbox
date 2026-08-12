//! Tests for the League of Comic Geeks provider.
//!
//! Every parser test runs against **fixtures captured from the live site** (see
//! `fixtures/`), and no test here touches the network — the client tests stand up a
//! wiremock server instead. That matters more than usual for this provider: the
//! "schema" is someone else's markup, so the fixtures are the only record of what it
//! looked like when this code was written.
//!
//! The fixtures are pruned copies: scripts, styles, `<img>` tags and the sections
//! below the ones we parse were removed to keep them committable. Everything the
//! parsers actually read is verbatim.

use wiremock::{
	matchers::{body_string_contains, method, path, query_param},
	Mock, MockServer, ResponseTemplate,
};

use super::*;

const SERIES_SEARCH: &str = include_str!("fixtures/series_search.json");
const SERIES_DETAIL: &str = include_str!("fixtures/series_detail.json");
const RELEASES: &str = include_str!("fixtures/releases.json");
const AJAX_ISSUES: &str = include_str!("fixtures/ajax_issues.html");
const ISSUE_PAGE: &str = include_str!("fixtures/issue_page.html");
/// A collected edition: Absolute Carnage Omnibus HC. Structurally different from a
/// single issue -- no `div.header-intro`, an ISBN instead of a UPC, and 34 story-level
/// credit blocks rather than one.
const COLLECTED_EDITION_PAGE: &str = include_str!("fixtures/collected_edition_page.html");
/// A series listing requested with the collected-edition formats: two regular issues
/// plus three real "Vol. N HC/TP" editions LOCG files under the same series.
const SERIES_EDITIONS: &str = include_str!("fixtures/series_editions.json");
/// A weekly release list requested with the collected-edition formats - the trades and
/// omnibuses an issues-only filter never shows.
const RELEASES_EDITIONS: &str = include_str!("fixtures/releases_editions.json");

// ---------------------------------------------------------------------------
// Series search cards
// ---------------------------------------------------------------------------

#[test]
fn parses_series_search_cards() {
	let cards = parse::parse_series_search(SERIES_SEARCH).expect("fixture is valid JSON");
	assert!(!cards.is_empty(), "expected series cards");

	let absolute = cards
		.iter()
		.find(|c| c.title == "Absolute Batman")
		.expect("Absolute Batman is in the fixture");

	assert_eq!(absolute.id, "178012");
	assert_eq!(absolute.publisher.as_deref(), Some("DC Comics"));
	assert_eq!(absolute.start_year, Some(2024));
	assert_eq!(absolute.end_year, None, "an ongoing series has no end year");
	assert!(absolute.ongoing);
	assert_eq!(absolute.issue_count, Some(26));
	assert_eq!(
		absolute.url.as_deref(),
		Some("/comics/series/178012/absolute-batman")
	);
}

#[test]
fn series_cover_comes_from_data_src_not_the_lazyload_placeholder() {
	// Regression guard for the subtlest trap in this provider: list cards lazy-load,
	// so `src` holds a base64 1x1 GIF and the real URL is in `data-src`. Reading
	// `src` yields a "cover" that renders as a transparent pixel.
	let cards = parse::parse_series_search(SERIES_SEARCH).expect("valid fixture");
	let cover = cards
		.iter()
		.find(|c| c.title == "Absolute Batman")
		.and_then(|c| c.cover_url.clone())
		.expect("a cover url");

	assert!(
		cover.starts_with("https://"),
		"cover should be a real URL, got {cover:?}"
	);
	assert!(
		!cover.starts_with("data:image"),
		"cover must not be the lazyload placeholder"
	);
}

// ---------------------------------------------------------------------------
// Year ranges and issue numbers
// ---------------------------------------------------------------------------

#[test]
fn parses_the_year_range_forms_locg_prints() {
	assert_eq!(
		parse::parse_year_range("2024 - Present"),
		(Some(2024), None, true)
	);
	assert_eq!(
		parse::parse_year_range("1963 - 1996"),
		(Some(1963), Some(1996), false)
	);
	// A single-year series: start and end are the same year.
	assert_eq!(
		parse::parse_year_range("2019"),
		(Some(2019), Some(2019), false)
	);
	assert_eq!(parse::parse_year_range(""), (None, None, false));
	assert_eq!(
		parse::parse_year_range("no years here"),
		(None, None, false)
	);
}

#[test]
fn splits_series_name_from_issue_number() {
	assert_eq!(
		parse::split_title_number("Absolute Batman #1"),
		("Absolute Batman".to_string(), Some("1".to_string()))
	);
	// Non-numeric issue numbers are real and must survive as text.
	assert_eq!(
		parse::split_title_number("Amazing Spider-Man #1.MU"),
		("Amazing Spider-Man".to_string(), Some("1.MU".to_string()))
	);
	assert_eq!(
		parse::split_title_number("Sandman #½"),
		("Sandman".to_string(), Some("½".to_string()))
	);
	// Collected editions carry no number at all - the common case in a trade-heavy
	// library, and not an error.
	assert_eq!(
		parse::split_title_number("Wolverine Omnibus HC"),
		("Wolverine Omnibus HC".to_string(), None)
	);
	// A trailing '#' with nothing after it is not a number.
	assert_eq!(
		parse::split_title_number("Weird Title #"),
		("Weird Title #".to_string(), None)
	);
}

#[test]
fn non_numeric_issue_numbers_keep_raw_but_have_no_float() {
	let (_, raw) = parse::split_title_number("Amazing Spider-Man #1.MU");
	let raw = raw.expect("raw number");
	assert_eq!(raw, "1.MU");
	assert!(
		raw.parse::<f32>().is_err(),
		"'1.MU' must not parse to a float - number stays None while number_raw keeps it"
	);
}

// ---------------------------------------------------------------------------
// Series detail
// ---------------------------------------------------------------------------

#[test]
fn parses_series_detail_json_and_header() {
	let response: parse::GetComicsResponse =
		serde_json::from_str(SERIES_DETAIL).expect("valid fixture");

	let series = response.series.expect("the series object is present");
	assert_eq!(series.title.as_deref(), Some("Absolute Batman"));
	assert_eq!(series.publisher_name.as_deref(), Some("DC Comics"));

	// The description arrives as HTML and is the *full* text, unlike the truncated
	// <meta name="description"> on the series page.
	let summary = series
		.description
		.as_deref()
		.and_then(parse::html_to_text)
		.expect("a description");
	assert!(summary.starts_with("Batman legend Scott Snyder"));
	assert!(!summary.contains('<'), "tags should be stripped: {summary}");

	let (publisher, start, end, ongoing) = parse::parse_series_header(&response.header);
	assert_eq!(publisher.as_deref(), Some("DC Comics"));
	assert_eq!(start, Some(2024));
	assert_eq!(end, None);
	assert!(ongoing);
}

#[test]
fn parses_issue_cards_from_a_series_list() {
	let cards = parse::parse_issue_list(SERIES_DETAIL).expect("valid fixture");
	assert!(!cards.is_empty());

	let first = &cards[0];
	assert_eq!(first.id, "2463692");
	assert_eq!(first.title, "Absolute Batman #1");
	assert_eq!(first.publisher.as_deref(), Some("DC Comics"));
	assert!(!first.is_variant(), "data-parent=0 means primary issue");

	// The store date is read from the `data-date` timestamp, not the localised
	// "Oct 9th, 2024" text beside it.
	let date = first.store_date.expect("a store date");
	assert_eq!(parse::date_parts(date), (9, 10, 2024));
}

// ---------------------------------------------------------------------------
// Releases + variant filtering
// ---------------------------------------------------------------------------

#[test]
fn release_list_variants_are_identifiable() {
	let cards = parse::parse_issue_list(RELEASES).expect("valid fixture");
	assert!(cards.len() >= 2, "fixture should hold several cards");

	let variants = cards.iter().filter(|c| c.is_variant()).count();
	let primaries = cards.iter().filter(|c| !c.is_variant()).count();
	assert!(primaries > 0, "expected at least one primary issue");
	assert!(
		variants > 0,
		"fixture must include a variant so the filter is actually exercised"
	);

	// Variants share their parent's title, which is exactly why they have to go:
	// leaving them in multiplies candidates for the same issue.
	for card in cards.iter().filter(|c| c.is_variant()) {
		assert!(matches!(card.parent_id, Some(p) if p != 0));
	}
}

// ---------------------------------------------------------------------------
// Quick search widget
// ---------------------------------------------------------------------------

#[test]
fn parses_the_issue_widget_and_ignores_the_other_widgets() {
	let cards = parse::parse_issue_widget(AJAX_ISSUES);
	assert!(!cards.is_empty(), "expected issue rows");

	// The same response carries Series and Characters widgets. Scoping to the comics
	// list is what keeps a character from being offered as a book match.
	for card in &cards {
		let url = card.url.as_deref().unwrap_or_default();
		assert!(
			url.starts_with("/comic/"),
			"widget rows must be issues, got {url:?}"
		);
		assert!(!card.id.is_empty());
	}

	// This endpoint uses a plain `src`, not lazyload - the opposite of list cards.
	let with_cover = cards.iter().filter(|c| c.cover_url.is_some()).count();
	assert!(
		with_cover > 0,
		"expected covers from the widget's plain src"
	);
}

// ---------------------------------------------------------------------------
// Issue detail page
// ---------------------------------------------------------------------------

#[test]
fn parses_the_issue_page() {
	let page = parse::parse_issue_page(ISSUE_PAGE);

	assert_eq!(page.heading.as_deref(), Some("Absolute Batman #1"));
	assert_eq!(page.publisher.as_deref(), Some("DC Comics"));
	assert_eq!(
		page.released.map(parse::date_parts),
		Some((9, 10, 2024)),
		"store date comes from the 'Released Oct 9, 2024' header line"
	);
	assert_eq!(page.series_id.as_deref(), Some("178012"));
	assert_eq!(
		page.cover_url.as_deref(),
		Some("https://s3.amazonaws.com/comicgeeks/comics/covers/medium-2463692.jpg")
	);

	let summary = page.summary.expect("a summary");
	assert!(summary.starts_with("Batman legend Scott Snyder"));
}

/// The page count must come from a number *adjacent* to the word.
///
/// Absolute Carnage Omnibus' summary ends "…VENOM #16-20; and the EVERYONE IS A TARGET
/// stinger pages". Taking the first `" pages"` and scanning back for digits turned an
/// 880-page omnibus into a 20-page one — a plausible-looking number, which is the kind
/// of wrong that survives review.
#[test]
fn page_count_ignores_the_word_pages_in_prose() {
	let page = parse::parse_issue_page(COLLECTED_EDITION_PAGE);
	assert_eq!(page.page_count, Some(880));

	let summary = page.summary.expect("a summary");
	assert!(
		summary.contains("stinger pages"),
		"the fixture must still contain the phrase that caused this, got {summary:?}"
	);
}

#[test]
fn page_count_is_the_issue_level_number_not_the_per_story_one() {
	// The page reports both: 44 pages for the issue, 42 for the story inside it.
	// Taking the wrong one is silently plausible, hence an explicit test.
	let page = parse::parse_issue_page(ISSUE_PAGE);
	assert_eq!(page.page_count, Some(44));
}

#[test]
fn collects_characters_across_the_per_story_sections() {
	let page = parse::parse_issue_page(ISSUE_PAGE);
	assert!(
		page.characters.len() >= 20,
		"expected the issue's full character list, got {}",
		page.characters.len()
	);
	assert!(page.characters.iter().any(|c| c == "Batman"));
	// De-duplicated: an anthology repeats characters across story sections.
	let mut sorted = page.characters.clone();
	sorted.sort();
	let before = sorted.len();
	sorted.dedup();
	assert_eq!(before, sorted.len(), "characters must be de-duplicated");
}

#[test]
fn maps_page_credits_into_the_metadata_fields() {
	let page = parse::parse_issue_page(ISSUE_PAGE);
	let buckets = roles::bucket_credits(
		page.credits
			.iter()
			.map(|(role, name)| (role.as_str(), name.as_str())),
	);

	assert_eq!(buckets.writers, vec!["Scott Snyder".to_string()]);
	assert_eq!(buckets.artists, vec!["Nick Dragotta".to_string()]);
	assert_eq!(buckets.colorists, vec!["Frank Martin".to_string()]);
	assert_eq!(buckets.letterers, vec!["Clayton Cowles".to_string()]);

	// Cover credits live in a separate top-level section, not in the per-story block.
	assert!(
		buckets.cover_artists.contains(&"Nick Dragotta".to_string()),
		"cover artists: {:?}",
		buckets.cover_artists
	);

	// Every editorial variant on the page collapses into `editors`.
	for editor in [
		"Katie Kubert",
		"Sabrina Futch",
		"Chris Conroy",
		"Marie Javins",
	] {
		assert!(
			buckets.editors.contains(&editor.to_string()),
			"{editor} missing from editors: {:?}",
			buckets.editors
		);
	}
}

/// A collected edition's page must yield as much as a single issue's.
///
/// This is the shape most of a trade-heavy library is made of, and it differs from a
/// single issue in ways that silently produced empty fields: the publisher/date line is
/// not wrapped in `div.header-intro`, the identifier is an ISBN rather than a UPC, and
/// the credits are spread over 34 story blocks instead of one.
#[test]
fn parses_a_collected_edition_page() {
	let page = parse::parse_issue_page(COLLECTED_EDITION_PAGE);

	assert_eq!(page.heading.as_deref(), Some("Absolute Carnage Omnibus HC"));
	assert_eq!(
		page.publisher.as_deref(),
		Some("Marvel Comics"),
		"the publisher is in #comic-header but not inside div.header-intro here"
	);
	assert_eq!(
		page.released.map(parse::date_parts),
		Some((23, 9, 2020)),
		"'Released Sep 23, 2020' has to be found without the header-intro wrapper"
	);
	assert_eq!(page.page_count, Some(880), "the page says 880 pages");
	assert_eq!(
		page.isbn.as_deref(),
		Some("9781302925291"),
		"collected editions carry an ISBN, which is a field Longbox can actually store"
	);

	let summary = page.summary.expect("a summary");
	assert!(
		summary.starts_with("Lethal killer Cletus Kasady"),
		"got {summary:?}"
	);

	// Credits are aggregated across every story block on the page.
	let buckets = roles::bucket_credits(
		page.credits
			.iter()
			.map(|(role, name)| (role.as_str(), name.as_str())),
	);
	assert!(
		buckets.writers.contains(&"Donny Cates".to_string()),
		"writers: {:?}",
		buckets.writers
	);
	assert!(
		buckets.cover_artists.contains(&"Ryan Stegman".to_string()),
		"cover artists: {:?}",
		buckets.cover_artists
	);
	assert!(
		buckets.letterers.contains(&"Clayton Cowles".to_string()),
		"letterers: {:?}",
		buckets.letterers
	);
}

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

#[test]
fn credentials_must_be_username_colon_password() {
	assert!(LocgClient::new("user:pass".to_string(), None).is_ok());

	for bad in ["", "no-colon", ":pass", "user:"] {
		assert!(
			LocgClient::new(bad.to_string(), None).is_err(),
			"{bad:?} should be rejected"
		);
	}
}

#[test]
fn a_password_containing_a_colon_is_preserved() {
	// split_once, not split - passwords with colons are legal and common.
	let client = LocgClient::new("user:pa:ss".to_string(), None).expect("valid");
	assert_eq!(client.username, "user");
	assert_eq!(client.password, "pa:ss");
}

#[test]
fn issue_probe_paths_carry_a_slug() {
	// An issue page cannot be addressed by id alone. `/comic/{id}` answers HTTP 200
	// with a "Page Not Found" body, and a wrong slug 404s *once a session exists* while
	// redirecting when logged out - which is why resolution uses a session-less probe.
	// This slipped through the first time because a mock happily serves any path; only
	// the live tests caught it.
	assert_eq!(issue_probe_path("2463692"), "/comic/2463692/x");
	assert!(issue_probe_path("1").starts_with("/comic/1/"));
	assert_ne!(
		issue_probe_path("1"),
		"/comic/1",
		"the bare id path is a soft 404 and must never be requested"
	);
}

// ---------------------------------------------------------------------------
// Client behaviour against a mock server
// ---------------------------------------------------------------------------

fn test_client(server: &MockServer) -> LocgClient {
	LocgClient::with_base_url("user:pass".to_string(), Some(6000), server.uri())
		.expect("client builds")
}

/// A successful login: 303 to /dashboard, which reqwest follows.
async fn mock_successful_login(server: &MockServer) {
	Mock::given(method("POST"))
		.and(path("/login"))
		.respond_with(
			ResponseTemplate::new(303)
				.insert_header("location", "/dashboard")
				.insert_header("set-cookie", "ci_session=abc123; Path=/; HttpOnly"),
		)
		.mount(server)
		.await;
	Mock::given(method("GET"))
		.and(path("/dashboard"))
		.respond_with(
			ResponseTemplate::new(200).set_body_string("<html>dashboard</html>"),
		)
		.mount(server)
		.await;
}

#[tokio::test]
async fn validate_credentials_accepts_a_login_that_lands_on_the_dashboard() {
	let server = MockServer::start().await;
	mock_successful_login(&server).await;

	let result = test_client(&server)
		.validate_credentials()
		.await
		.expect("validation runs");

	assert_eq!(result.status, ProviderValidationStatus::Valid);
}

#[tokio::test]
async fn validate_credentials_rejects_a_login_that_re_renders_the_form() {
	// The failure mode that makes this provider unusual: a *wrong* password produces
	// HTTP 200, not 401. Only the landing path distinguishes it from success.
	let server = MockServer::start().await;
	Mock::given(method("POST"))
		.and(path("/login"))
		.respond_with(
			ResponseTemplate::new(200)
				.set_body_string("<html><form>Log In</form></html>"),
		)
		.mount(&server)
		.await;

	let result = test_client(&server)
		.validate_credentials()
		.await
		.expect("validation runs");

	assert_eq!(result.status, ProviderValidationStatus::InvalidCredentials);
}

#[tokio::test]
async fn validate_credentials_reports_a_challenge_as_forbidden() {
	let server = MockServer::start().await;
	Mock::given(method("POST"))
		.and(path("/login"))
		.respond_with(ResponseTemplate::new(403).set_body_string("Just a moment..."))
		.mount(&server)
		.await;

	let result = test_client(&server)
		.validate_credentials()
		.await
		.expect("validation runs");

	assert_eq!(result.status, ProviderValidationStatus::Forbidden);
}

#[tokio::test]
async fn login_posts_the_credentials_as_a_form() {
	let server = MockServer::start().await;
	Mock::given(method("POST"))
		.and(path("/login"))
		.and(body_string_contains("username=user"))
		.and(body_string_contains("password=pass"))
		.respond_with(
			ResponseTemplate::new(303)
				.insert_header("location", "/dashboard")
				.insert_header("set-cookie", "ci_session=abc123; Path=/"),
		)
		.expect(1)
		.mount(&server)
		.await;
	Mock::given(method("GET"))
		.and(path("/dashboard"))
		.respond_with(ResponseTemplate::new(200))
		.mount(&server)
		.await;

	let result = test_client(&server).validate_credentials().await.unwrap();
	assert_eq!(result.status, ProviderValidationStatus::Valid);
	// MockServer verifies expect(1) on drop.
}

#[tokio::test]
async fn search_series_builds_candidates_without_a_detail_fetch_per_result() {
	let server = MockServer::start().await;
	mock_successful_login(&server).await;
	Mock::given(method("GET"))
		.and(path("/comic/get_comics"))
		.and(query_param("list", "search"))
		.and(query_param("list_option", "series"))
		.respond_with(
			ResponseTemplate::new(200)
				.insert_header("content-type", "application/json")
				.set_body_string(SERIES_SEARCH),
		)
		// Exactly one call: the cards carry enough to build candidates, so unlike the
		// Metron provider there is no per-result detail request.
		.expect(1)
		.mount(&server)
		.await;

	let query = SearchQuery {
		title: "Absolute Batman".to_string(),
		limit: Some(5),
		..Default::default()
	};
	let candidates = test_client(&server)
		.search_series(&query)
		.await
		.expect("search succeeds");

	assert!(!candidates.is_empty());
	assert!(candidates.len() <= 5, "limit must be honoured");
	assert!(candidates.iter().all(|c| c.provider == "locg"));

	let top = &candidates[0];
	match &top.metadata {
		ExternalMetadata::Series(series) => {
			assert_eq!(series.title, "Absolute Batman");
			assert_eq!(series.publisher.as_deref(), Some("DC Comics"));
			assert_eq!(series.status, Some(PublicationStatus::Ongoing));
			assert_eq!(series.volume_count, Some(26));
		},
		other => panic!("expected series metadata, got {other:?}"),
	}
}

#[tokio::test]
async fn search_series_sends_the_collected_edition_formats() {
	// The measured coverage finding, encoded: filtering to regular issues + annuals
	// alone hides trade paperbacks and hardcovers, which is most of a typical
	// self-hosted comic library.
	let server = MockServer::start().await;
	mock_successful_login(&server).await;
	Mock::given(method("GET"))
		.and(path("/comic/get_comics"))
		.and(query_param("format[]", "4")) // Hardcovers
		.respond_with(
			ResponseTemplate::new(200)
				.insert_header("content-type", "application/json")
				.set_body_string(SERIES_SEARCH),
		)
		.expect(1)
		.mount(&server)
		.await;

	let query = SearchQuery {
		title: "Absolute Batman".to_string(),
		..Default::default()
	};
	test_client(&server)
		.search_series(&query)
		.await
		.expect("search succeeds");
}

#[tokio::test]
async fn fetch_series_metadata_reads_the_json_series_object() {
	let server = MockServer::start().await;
	mock_successful_login(&server).await;
	Mock::given(method("GET"))
		.and(path("/comic/get_comics"))
		.and(query_param("list", "series"))
		.and(query_param("series_id", "178012"))
		.respond_with(
			ResponseTemplate::new(200)
				.insert_header("content-type", "application/json")
				.set_body_string(SERIES_DETAIL),
		)
		.mount(&server)
		.await;

	let series = test_client(&server)
		.fetch_series_metadata("178012")
		.await
		.expect("fetch succeeds");

	assert_eq!(series.title, "Absolute Batman");
	assert_eq!(series.publisher.as_deref(), Some("DC Comics"));
	assert_eq!(series.year, Some(2024));
	assert_eq!(series.end_year, None);
	assert_eq!(series.status, Some(PublicationStatus::Ongoing));
	assert_eq!(
		series.volume_count,
		Some(26),
		"issues, counted without variants"
	);
	assert!(series
		.summary
		.as_deref()
		.is_some_and(|s| s.starts_with("Batman legend")));
	// LOCG exposes none of these at series level.
	assert!(series.genres.is_none());
	assert!(series.tags.is_none());
	assert!(series.age_rating.is_none());
	assert!(series.alternative_titles.is_empty());
}

#[tokio::test]
async fn fetch_media_metadata_maps_the_issue_page() {
	let server = MockServer::start().await;
	mock_successful_login(&server).await;
	Mock::given(method("GET"))
		.and(path("/comic/2463692/x"))
		.respond_with(
			ResponseTemplate::new(200)
				.insert_header("content-type", "text/html")
				.set_body_string(ISSUE_PAGE),
		)
		.mount(&server)
		.await;

	let media = test_client(&server)
		.fetch_media_metadata("2463692")
		.await
		.expect("fetch succeeds");

	assert_eq!(media.provider, "locg");
	assert_eq!(media.external_id, "2463692");
	assert_eq!(media.title.as_deref(), Some("Absolute Batman #1"));
	assert_eq!(media.series_name.as_deref(), Some("Absolute Batman"));
	assert_eq!(media.series_external_id.as_deref(), Some("178012"));
	assert_eq!(media.number, Some(1.0));
	assert_eq!(media.number_raw.as_deref(), Some("1"));
	assert_eq!(
		(media.day, media.month, media.year),
		(Some(9), Some(10), Some(2024))
	);
	assert_eq!(media.page_count, Some(44));
	assert_eq!(media.publisher.as_deref(), Some("DC Comics"));
	assert_eq!(media.writers, Some(vec!["Scott Snyder".to_string()]));
	assert!(media.characters.is_some_and(|c| c.len() >= 20));

	// Fields LOCG does not carry stay None rather than being invented.
	assert!(media.genres.is_none());
	assert!(media.tags.is_none());
	assert!(media.isbn.is_none());
	assert!(media.isbn_13.is_none());
	assert!(media.teams.is_none());
	assert!(media.story_arc.is_none());
	assert!(media.imprint.is_none());
}

#[tokio::test]
async fn fetch_media_metadata_reports_a_missing_issue_as_not_found() {
	let server = MockServer::start().await;
	mock_successful_login(&server).await;
	Mock::given(method("GET"))
		.and(path("/comic/99999999/x"))
		.respond_with(
			ResponseTemplate::new(200)
				.insert_header("content-type", "text/html")
				// LOCG answers an unknown id with a page that simply has no heading.
				.set_body_string("<html><body><p>Nothing here</p></body></html>"),
		)
		.mount(&server)
		.await;

	let result = test_client(&server).fetch_media_metadata("99999999").await;
	assert!(matches!(result, Err(MetadataProviderError::NotFound(_))));
}

#[tokio::test]
async fn search_media_for_an_unnumbered_title_uses_both_routes() {
	// A trade or omnibus has no issue number. Both routes run: the quick search finds
	// editions titled independently of their series, and the series listing finds the
	// ones filed inside it. Neither alone is sufficient.
	let server = MockServer::start().await;
	mock_successful_login(&server).await;
	Mock::given(method("GET"))
		.and(path("/comic/get_comics"))
		.and(query_param("list", "search"))
		.respond_with(
			ResponseTemplate::new(200)
				.insert_header("content-type", "application/json")
				.set_body_string(SERIES_SEARCH),
		)
		.mount(&server)
		.await;
	Mock::given(method("GET"))
		.and(path("/comic/get_comics"))
		.and(query_param("list", "series"))
		.respond_with(
			ResponseTemplate::new(200)
				.insert_header("content-type", "application/json")
				.set_body_string(SERIES_EDITIONS),
		)
		.mount(&server)
		.await;
	Mock::given(method("GET"))
		.and(path("/search/ajax_issues"))
		.respond_with(
			ResponseTemplate::new(200)
				.insert_header("content-type", "text/html")
				.set_body_string(AJAX_ISSUES),
		)
		.expect(1)
		.mount(&server)
		.await;

	let query = SearchQuery {
		title: "Absolute Batman Vol. 1: The Zoo".to_string(),
		limit: Some(20),
		..Default::default()
	};
	let candidates = test_client(&server)
		.search_media(&query)
		.await
		.expect("search succeeds");

	assert!(!candidates.is_empty());
	assert!(candidates.iter().all(|c| c.provider == "locg"));

	// The collected edition filed under the series must be offered - that is the whole
	// point of widening the format filter.
	let titles: Vec<String> = candidates
		.iter()
		.filter_map(|c| match &c.metadata {
			ExternalMetadata::Media(m) => m.title.clone(),
			_ => None,
		})
		.collect();
	assert!(
		titles.iter().any(|t| t.contains("The Zoo")),
		"expected a collected edition from the series listing, got {titles:?}"
	);

	// Merged, not duplicated.
	let mut ids: Vec<&str> = candidates.iter().map(|c| c.external_id.as_str()).collect();
	let before = ids.len();
	ids.sort_unstable();
	ids.dedup();
	assert_eq!(
		before,
		ids.len(),
		"candidates must be de-duplicated by LOCG id"
	);
}

#[tokio::test]
async fn a_numbered_search_does_not_spend_a_quick_search_request() {
	// The series route is precise for numbered issues, so the extra typeahead request
	// is only worth making when it found nothing.
	let server = MockServer::start().await;
	mock_successful_login(&server).await;
	Mock::given(method("GET"))
		.and(path("/comic/get_comics"))
		.and(query_param("list", "search"))
		.respond_with(
			ResponseTemplate::new(200)
				.insert_header("content-type", "application/json")
				.set_body_string(SERIES_SEARCH),
		)
		.mount(&server)
		.await;
	Mock::given(method("GET"))
		.and(path("/comic/get_comics"))
		.and(query_param("list", "series"))
		.respond_with(
			ResponseTemplate::new(200)
				.insert_header("content-type", "application/json")
				.set_body_string(SERIES_EDITIONS),
		)
		.mount(&server)
		.await;
	Mock::given(method("GET"))
		.and(path("/search/ajax_issues"))
		.respond_with(ResponseTemplate::new(200).set_body_string("<div></div>"))
		.expect(0)
		.mount(&server)
		.await;

	let query = SearchQuery {
		title: "Absolute Batman #1".to_string(),
		series_name: Some("Absolute Batman".to_string()),
		number: Some("1".to_string()),
		limit: Some(10),
		..Default::default()
	};
	let candidates = test_client(&server)
		.search_media(&query)
		.await
		.expect("search succeeds");
	assert!(!candidates.is_empty());
	// MockServer verifies expect(0) on drop.
}

#[tokio::test]
async fn the_series_listing_requests_the_collected_edition_formats() {
	// Regression guard for the filter widening: a series listing restricted to
	// `1,6` hides the nine "Vol. N HC/TP" editions LOCG files under Absolute Batman.
	let server = MockServer::start().await;
	mock_successful_login(&server).await;
	Mock::given(method("GET"))
		.and(path("/comic/get_comics"))
		.and(query_param("list", "search"))
		.respond_with(
			ResponseTemplate::new(200)
				.insert_header("content-type", "application/json")
				.set_body_string(SERIES_SEARCH),
		)
		.mount(&server)
		.await;
	Mock::given(method("GET"))
		.and(path("/comic/get_comics"))
		.and(query_param("list", "series"))
		.and(query_param("format[]", "4")) // Hardcovers - where omnibuses live
		.and(query_param("format[]", "3")) // Trade paperbacks
		// No call-count expectation: the shortlist deliberately tries more than one
		// same-titled series. The format matchers above are the assertion - without
		// them the mock would not match and the search would fail outright.
		.respond_with(
			ResponseTemplate::new(200)
				.insert_header("content-type", "application/json")
				.set_body_string(SERIES_EDITIONS),
		)
		.mount(&server)
		.await;
	Mock::given(method("GET"))
		.and(path("/search/ajax_issues"))
		.respond_with(
			ResponseTemplate::new(200)
				.insert_header("content-type", "text/html")
				.set_body_string(AJAX_ISSUES),
		)
		.mount(&server)
		.await;

	let query = SearchQuery {
		title: "Absolute Batman Omnibus".to_string(),
		limit: Some(10),
		..Default::default()
	};
	test_client(&server)
		.search_media(&query)
		.await
		.expect("search succeeds");
}

#[test]
fn parses_collected_editions_from_a_widened_series_listing() {
	let cards = parse::parse_issue_list(SERIES_EDITIONS).expect("valid fixture");
	let titles: Vec<&str> = cards.iter().map(|c| c.title.as_str()).collect();
	assert!(
		titles.iter().any(|t| t.contains("HC")),
		"expected a hardcover edition: {titles:?}"
	);
	assert!(
		titles.iter().any(|t| t.contains("TP")),
		"expected a trade paperback: {titles:?}"
	);
	// Collected editions carry no issue number, which is why the unnumbered search
	// route has to look here at all.
	for card in cards.iter().filter(|c| c.title.contains("Vol.")) {
		assert_eq!(parse::split_title_number(&card.title).1, None);
	}
}

/// A search result has to arrive reviewable.
///
/// Search cards carry a title, publisher, cover and date. Everything a reviewer compares
/// — summary, page count, ISBN, credits, characters — is only on the detail page, so an
/// unhydrated candidate renders as a column of dashes. That is exactly what a real review
/// of an omnibus looked like before this.
#[tokio::test]
async fn search_candidates_arrive_hydrated_from_their_detail_page() {
	let server = MockServer::start().await;
	mock_successful_login(&server).await;
	// The unnumbered route consults both the series listing and the quick search.
	Mock::given(method("GET"))
		.and(path("/comic/get_comics"))
		.respond_with(
			ResponseTemplate::new(200)
				.insert_header("content-type", "application/json")
				.set_body_string(SERIES_SEARCH),
		)
		.mount(&server)
		.await;
	Mock::given(method("GET"))
		.and(path("/search/ajax_issues"))
		.respond_with(
			ResponseTemplate::new(200)
				.insert_header("content-type", "text/html")
				.set_body_string(AJAX_ISSUES),
		)
		.mount(&server)
		.await;
	// Any issue page resolves to the collected-edition fixture, so a hydrated candidate
	// must carry that page's fields rather than the card's.
	Mock::given(method("GET"))
		.and(wiremock::matchers::path_regex(r"^/comic/\d+/x$"))
		.respond_with(
			ResponseTemplate::new(200)
				.insert_header("content-type", "text/html")
				.set_body_string(COLLECTED_EDITION_PAGE),
		)
		.mount(&server)
		.await;

	let query = SearchQuery {
		title: "Absolute Carnage Omnibus".to_string(),
		limit: Some(3),
		..Default::default()
	};
	let candidates = test_client(&server)
		.search_media(&query)
		.await
		.expect("search succeeds");

	assert!(!candidates.is_empty());
	let top = match &candidates[0].metadata {
		ExternalMetadata::Media(media) => media,
		other => panic!("expected media metadata, got {other:?}"),
	};

	assert_eq!(
		top.page_count,
		Some(880),
		"page count only exists on the page"
	);
	assert_eq!(top.isbn.as_deref(), Some("9781302925291"));
	assert!(top.summary.is_some(), "summary only exists on the page");
	assert!(
		top.writers.as_ref().is_some_and(|w| !w.is_empty()),
		"credits only exist on the page"
	);
}

#[tokio::test]
async fn search_media_with_a_number_resolves_the_series_then_the_issue() {
	let server = MockServer::start().await;
	mock_successful_login(&server).await;
	Mock::given(method("GET"))
		.and(path("/comic/get_comics"))
		.and(query_param("list", "search"))
		.respond_with(
			ResponseTemplate::new(200)
				.insert_header("content-type", "application/json")
				.set_body_string(SERIES_SEARCH),
		)
		.mount(&server)
		.await;
	Mock::given(method("GET"))
		.and(path("/comic/get_comics"))
		.and(query_param("list", "series"))
		.respond_with(
			ResponseTemplate::new(200)
				.insert_header("content-type", "application/json")
				.set_body_string(SERIES_DETAIL),
		)
		.mount(&server)
		.await;

	let query = SearchQuery {
		title: "Absolute Batman #1".to_string(),
		series_name: Some("Absolute Batman".to_string()),
		number: Some("1".to_string()),
		limit: Some(5),
		..Default::default()
	};
	let candidates = test_client(&server)
		.search_media(&query)
		.await
		.expect("search succeeds");

	assert!(!candidates.is_empty());
	let top = &candidates[0];
	match &top.metadata {
		ExternalMetadata::Media(media) => {
			assert_eq!(media.number_raw.as_deref(), Some("1"));
			assert_eq!(
				media.series_external_id.as_deref(),
				Some("178012"),
				"the resolved series id should be carried onto the candidate"
			);
		},
		other => panic!("expected media metadata, got {other:?}"),
	}
}

#[tokio::test]
async fn upcoming_releases_resolve_series_ids_and_skip_variants() {
	let server = MockServer::start().await;
	mock_successful_login(&server).await;
	Mock::given(method("GET"))
		.and(path("/comic/get_comics"))
		.and(query_param("list", "releases"))
		.respond_with(
			ResponseTemplate::new(200)
				.insert_header("content-type", "application/json")
				.set_body_string(RELEASES),
		)
		.mount(&server)
		.await;
	// Release cards carry no series id, so each distinct series costs a page fetch.
	Mock::given(method("GET"))
		.and(wiremock::matchers::path_regex(r"^/comic/\d+/x$"))
		.respond_with(
			ResponseTemplate::new(200)
				.insert_header("content-type", "text/html")
				.set_body_string(ISSUE_PAGE),
		)
		.mount(&server)
		.await;

	let releases = test_client(&server)
		.fetch_upcoming_releases(
			NaiveDate::from_ymd_opt(2026, 8, 10).unwrap(),
			NaiveDate::from_ymd_opt(2026, 8, 16).unwrap(),
			50,
		)
		.await
		.expect("sweep succeeds");

	assert!(!releases.is_empty(), "expected releases in the window");
	for release in &releases {
		assert_eq!(
			release.series_external_id, "178012",
			"every release must carry a resolved series id"
		);
		assert!(!release.external_id.is_empty());
	}
}

#[tokio::test]
async fn upcoming_releases_sweeps_issues_and_collected_editions_separately() {
	// The two weekly filter sets are NOT nested: measured on one week, `1,6` returned
	// 236 primaries and zero collected editions while `1,3,4,6` returned 157 including
	// 41 collected editions but dropped 120 digital-first serials. So the sweep asks
	// twice and unions - collapsing this back to one request silently loses one half or
	// the other, depending on which filter is kept.
	let server = MockServer::start().await;
	mock_successful_login(&server).await;
	// The widened pass, identified by the hardcover/trade formats.
	Mock::given(method("GET"))
		.and(path("/comic/get_comics"))
		.and(query_param("list", "releases"))
		.and(query_param("format[]", "3"))
		.respond_with(
			ResponseTemplate::new(200)
				.insert_header("content-type", "application/json")
				.set_body_string(RELEASES_EDITIONS),
		)
		.expect(1..)
		.mount(&server)
		.await;
	// The issues-only pass.
	Mock::given(method("GET"))
		.and(path("/comic/get_comics"))
		.and(query_param("list", "releases"))
		.respond_with(
			ResponseTemplate::new(200)
				.insert_header("content-type", "application/json")
				.set_body_string(RELEASES),
		)
		.expect(1..)
		.mount(&server)
		.await;
	Mock::given(method("GET"))
		.and(wiremock::matchers::path_regex(r"^/comic/\d+/x$"))
		.respond_with(
			ResponseTemplate::new(200)
				.insert_header("content-type", "text/html")
				.set_body_string(ISSUE_PAGE),
		)
		.mount(&server)
		.await;

	let releases = test_client(&server)
		.fetch_upcoming_releases(
			NaiveDate::from_ymd_opt(2026, 8, 10).unwrap(),
			NaiveDate::from_ymd_opt(2026, 8, 16).unwrap(),
			50,
		)
		.await
		.expect("sweep succeeds");

	let titles: Vec<&str> = releases.iter().filter_map(|r| r.title.as_deref()).collect();
	assert!(
		titles.iter().any(|t| t.contains("TP") || t.contains("HC")),
		"the widened pass should contribute collected editions: {titles:?}"
	);
	assert!(
		titles.iter().any(|t| t.contains('#')),
		"the issues-only pass should still contribute numbered issues: {titles:?}"
	);
	// Union, not duplication.
	let mut ids: Vec<&str> = releases.iter().map(|r| r.external_id.as_str()).collect();
	let before = ids.len();
	ids.sort_unstable();
	ids.dedup();
	assert_eq!(
		before,
		ids.len(),
		"releases must be de-duplicated across passes"
	);
}

#[tokio::test]
async fn upcoming_releases_returns_nothing_for_an_inverted_window() {
	let server = MockServer::start().await;
	let releases = test_client(&server)
		.fetch_upcoming_releases(
			NaiveDate::from_ymd_opt(2026, 8, 20).unwrap(),
			NaiveDate::from_ymd_opt(2026, 8, 10).unwrap(),
			50,
		)
		.await
		.expect("sweep succeeds");
	assert!(releases.is_empty());
}

// ---------------------------------------------------------------------------
// Live probes - ignored, never run in CI
// ---------------------------------------------------------------------------

fn live_client() -> LocgClient {
	dotenvy::dotenv().ok();
	let creds = std::env::var("LOCG_CREDENTIALS").expect("LOCG_CREDENTIALS not set");
	LocgClient::new(creds, None).expect("LOCG_CREDENTIALS must be 'username:password'")
}

#[ignore = "Requires LOCG_CREDENTIALS env var and hits the live site"]
#[tokio::test]
async fn live_validate_credentials() {
	let result = live_client().validate_credentials().await.unwrap();
	println!("validation: {result:?}");
	assert_eq!(result.status, ProviderValidationStatus::Valid);
}

#[ignore = "Requires LOCG_CREDENTIALS env var and hits the live site"]
#[tokio::test]
async fn live_search_and_fetch() {
	let client = live_client();
	let query = SearchQuery {
		title: "Absolute Batman".to_string(),
		limit: Some(5),
		..Default::default()
	};
	let candidates = client.search_series(&query).await.unwrap();
	println!("series candidates: {candidates:#?}");
	assert!(!candidates.is_empty());

	let series = client
		.fetch_series_metadata(&candidates[0].external_id)
		.await
		.unwrap();
	println!("series: {series:#?}");

	let media = client.fetch_media_metadata("2463692").await.unwrap();
	println!("issue: {media:#?}");
	assert_eq!(media.series_name.as_deref(), Some("Absolute Batman"));
}

#[ignore = "Requires LOCG_CREDENTIALS env var and hits the live site"]
#[tokio::test]
async fn live_upcoming_releases() {
	// Deliberately a one-week window with a small cap: each distinct series in the
	// window costs a page fetch, so a wide live sweep is expensive.
	let client = live_client();
	let start = chrono::Utc::now().date_naive();
	let releases = client
		.fetch_upcoming_releases(start, start + Duration::weeks(1), 5)
		.await
		.unwrap();
	println!("{} releases: {releases:#?}", releases.len());
	for release in &releases {
		assert!(!release.series_external_id.is_empty());
		assert!(!release.external_id.is_empty());
	}
}

#[ignore = "Requires LOCG_CREDENTIALS env var and hits the live site"]
#[tokio::test]
async fn live_search_finds_a_collected_edition() {
	// A real title from a trade-heavy library. Unnumbered, so both routes run; the
	// collected-edition formats are what make this findable at all.
	let client = live_client();
	for title in [
		"Wonder Woman by Phil Jimenez Omnibus",
		"Absolute Batman Vol. 1: The Zoo",
	] {
		let query = SearchQuery {
			title: title.to_string(),
			limit: Some(8),
			..Default::default()
		};
		let candidates = client.search_media(&query).await.unwrap();
		let titles: Vec<String> = candidates
			.iter()
			.filter_map(|c| match &c.metadata {
				ExternalMetadata::Media(m) => m
					.title
					.clone()
					.map(|t| format!("{t} ({:.2})", c.confidence)),
				_ => None,
			})
			.collect();
		println!("\n{title:?} ->");
		for t in &titles {
			println!("    {t}");
		}
		assert!(!candidates.is_empty(), "no candidates for {title}");
	}
}

#[ignore = "Requires LOCG_CREDENTIALS env var and hits the live site"]
#[tokio::test]
async fn live_fetch_the_absolute_carnage_omnibus() {
	// The exact page that showed a column of dashes in review.
	let media = live_client().fetch_media_metadata("6266160").await.unwrap();
	println!("{media:#?}");

	assert_eq!(media.publisher.as_deref(), Some("Marvel Comics"));
	assert_eq!(media.page_count, Some(880));
	assert_eq!(media.isbn.as_deref(), Some("9781302925291"));
	assert_eq!(
		(media.day, media.month, media.year),
		(Some(23), Some(9), Some(2020))
	);
	assert!(media.summary.is_some_and(|s| s.contains("Collecting")));
	assert!(media
		.writers
		.is_some_and(|w| w.contains(&"Donny Cates".to_string())));
	assert!(media
		.cover_artists
		.is_some_and(|c| c.contains(&"Ryan Stegman".to_string())));
}
