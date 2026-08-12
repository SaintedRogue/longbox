//! Pure parsers for League of Comic Geeks markup.
//!
//! Everything here is a function from captured bytes to a plain struct — no HTTP, no
//! clock, no config — so the fixture tests exercise exactly the code that runs in
//! production. All selectors come from [`super::selectors`]; this module never parses
//! one of its own.
//!
//! LOCG's `/comic/get_comics` returns JSON whose values are HTML fragments, so the
//! shape is "deserialize, then parse the strings inside".

use chrono::{DateTime, Datelike, NaiveDate};
use scraper::{ElementRef, Html};
use serde::Deserialize;

use super::selectors as sel;

/// The envelope `/comic/get_comics` returns. Fields we don't consume (`statbar`,
/// `filters_*`, `configurator`, community counters, …) are ignored by serde, which
/// also means new upstream fields can't break deserialization.
#[derive(Debug, Deserialize)]
pub struct GetComicsResponse {
	/// Rendered list markup — series cards or issue cards depending on the request.
	#[serde(default)]
	pub list: String,
	/// Rendered header markup. On a `list=series` request this is the only place the
	/// series' year range appears.
	#[serde(default)]
	pub header: String,
	/// Total matching rows *after* the `format[]` filter — the filter is what makes
	/// this meaningful (unfiltered, variants inflate a 26-issue series to 149).
	#[serde(default)]
	pub count: Option<i32>,
	/// Structured series metadata, present only on `list=series` requests. The one
	/// genuinely JSON-typed payload LOCG gives us.
	#[serde(default)]
	pub series: Option<SeriesObject>,
}

/// The `series` key of a `list=series` response. Carries the *full* description —
/// the series page itself only has a truncated `<meta name="description">`.
#[derive(Debug, Deserialize)]
pub struct SeriesObject {
	#[serde(default)]
	pub title: Option<String>,
	#[serde(default)]
	pub publisher_name: Option<String>,
	/// HTML (`<p>…</p>`), not plain text.
	#[serde(default)]
	pub description: Option<String>,
}

/// A series result parsed from a search response's card markup.
#[derive(Debug, Clone, PartialEq)]
pub struct SeriesCard {
	pub id: String,
	pub title: String,
	pub publisher: Option<String>,
	pub start_year: Option<i32>,
	pub end_year: Option<i32>,
	/// True when the year range reads "… - Present".
	pub ongoing: bool,
	pub cover_url: Option<String>,
	pub issue_count: Option<i32>,
	pub url: Option<String>,
}

/// An issue result parsed from either a list response's cards or the quick-search
/// widget. The two sources populate different subsets — the widget has no store-date
/// timestamp and no variant flag.
#[derive(Debug, Clone, PartialEq)]
pub struct IssueCard {
	pub id: String,
	/// Verbatim card title, e.g. "Absolute Batman #1" or "Wolverine Omnibus HC".
	pub title: String,
	pub publisher: Option<String>,
	/// Store date. List cards carry a `data-date` Unix timestamp; the quick-search
	/// widget only prints text ("Jun 15th, 2027"), which is parsed instead.
	pub store_date: Option<NaiveDate>,
	pub cover_url: Option<String>,
	pub url: Option<String>,
	/// `data-parent`: `Some(0)` for a primary issue, `Some(other)` for a variant of
	/// that issue, `None` when the source doesn't say (the quick-search widget).
	pub parent_id: Option<i64>,
}

impl IssueCard {
	/// Whether this card is a cover variant of another issue. Variants share a title
	/// and number with their parent, so leaving them in multiplies candidates (a
	/// 26-issue series returns 149 rows unfiltered).
	pub fn is_variant(&self) -> bool {
		matches!(self.parent_id, Some(parent) if parent != 0)
	}
}

/// Everything the provider reads off an issue detail page.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct IssuePage {
	/// The `h1`, e.g. "Absolute Batman #1" — series name and number combined.
	pub heading: Option<String>,
	pub publisher: Option<String>,
	/// From the "Released Oct 9, 2024" line. This is the *store* date; the cover date
	/// in `#comic-details` is a different, month-precision value.
	pub released: Option<NaiveDate>,
	pub summary: Option<String>,
	/// Issue-level page count (not the per-story one).
	pub page_count: Option<i32>,
	/// Collected editions carry an ISBN where single issues carry a UPC. The UPC has
	/// nowhere to go in Longbox; the ISBN does, so it is worth pulling.
	pub isbn: Option<String>,
	pub cover_url: Option<String>,
	pub series_id: Option<String>,
	pub series_url: Option<String>,
	pub characters: Vec<String>,
	/// Every `(role, name)` pair found, in document order, with compound roles left
	/// intact ("Writer, Artist") for [`super::roles`] to split.
	pub credits: Vec<(String, String)>,
}

/// Collapse whitespace and strip `&nbsp;`/separator noise from scraped text.
fn tidy(raw: &str) -> String {
	raw.replace('\u{a0}', " ")
		.split_whitespace()
		.collect::<Vec<_>>()
		.join(" ")
}

fn text_of(el: ElementRef<'_>) -> String {
	tidy(&el.text().collect::<String>())
}

fn non_empty(s: String) -> Option<String> {
	let s = s.trim().to_string();
	(!s.is_empty()).then_some(s)
}

/// Extract the numeric id from a LOCG path like `/comics/series/178012/absolute-batman`
/// or `/comic/2463692/absolute-batman-1`.
fn id_from_path(href: &str, segment: &str) -> Option<String> {
	let rest = href.split_once(segment)?.1;
	let id: String = rest.chars().take_while(char::is_ascii_digit).collect();
	(!id.is_empty()).then_some(id)
}

/// Parse a card subtitle year range: "2024 - Present", "1963 - 1996", or a lone
/// "2024". Returns `(start, end, ongoing)`.
pub fn parse_year_range(raw: &str) -> (Option<i32>, Option<i32>, bool) {
	let text = tidy(raw);
	let years: Vec<i32> = text
		.split(|c: char| !c.is_ascii_digit())
		.filter(|t| t.len() == 4)
		.filter_map(|t| t.parse::<i32>().ok())
		.collect();
	let ongoing = text.to_lowercase().contains("present");
	match years.as_slice() {
		[] => (None, None, ongoing),
		[only] => (Some(*only), (!ongoing).then_some(*only), ongoing),
		[start, end, ..] => (Some(*start), (!ongoing).then_some(*end), ongoing),
	}
}

/// Split a card/page title into its series part and raw issue number: "Absolute
/// Batman #1" → `("Absolute Batman", Some("1"))`.
///
/// Collected editions carry no `#` at all ("Wolverine Omnibus HC"), which is the
/// common case in a trade-heavy library, so a missing number is normal, not an error.
/// The number is deliberately returned as text — "1.MU" and "½" are real LOCG issue
/// numbers and neither parses to a float.
pub fn split_title_number(title: &str) -> (String, Option<String>) {
	let title = tidy(title);
	match title.rsplit_once('#') {
		Some((series, number)) => {
			let number = number.trim();
			let series = series.trim().trim_end_matches(&[',', '-', ':'][..]).trim();
			if number.is_empty() || series.is_empty() {
				(title, None)
			} else {
				(series.to_string(), Some(number.to_string()))
			}
		},
		None => (title, None),
	}
}

/// Parse the series cards from a `list=search&list_option=series` response body.
///
/// The provider itself deserializes once and calls [`parse_series_cards`]; this
/// whole-body form exists so fixture tests exercise the JSON envelope too.
#[cfg(test)]
pub fn parse_series_search(body: &str) -> Result<Vec<SeriesCard>, serde_json::Error> {
	let response: GetComicsResponse = serde_json::from_str(body)?;
	Ok(parse_series_cards(&response.list))
}

/// Parse series cards out of already-extracted list markup.
pub fn parse_series_cards(list_html: &str) -> Vec<SeriesCard> {
	let doc = Html::parse_fragment(list_html);
	let mut cards = Vec::new();

	for card in doc.select(&sel::SERIES_CARD) {
		// Cards are bare `<li>`s, so the series link is what identifies one.
		let Some(link) = card.select(&sel::SERIES_LINK).next() else {
			continue;
		};
		let href = link.value().attr("href");
		let Some(id) = link
			.value()
			.attr("data-id")
			.map(str::to_string)
			.filter(|id| !id.is_empty())
			.or_else(|| href.and_then(|h| id_from_path(h, "/comics/series/")))
		else {
			continue;
		};

		let title = card
			.select(&sel::SERIES_TITLE)
			.next()
			.map(text_of)
			.and_then(non_empty);
		let Some(title) = title else { continue };

		// Positional: the subtitle is `<span>publisher</span><span>years</span>`.
		let subtitle: Vec<String> = card
			.select(&sel::SERIES_SUBTITLE_SPANS)
			.map(text_of)
			.filter(|s| !s.is_empty())
			.collect();
		let publisher = subtitle.first().cloned();
		let (start_year, end_year, ongoing) = subtitle
			.iter()
			.find(|s| s.chars().filter(char::is_ascii_digit).count() >= 4)
			.map(|s| parse_year_range(s))
			.unwrap_or((None, None, false));

		cards.push(SeriesCard {
			id,
			title,
			publisher,
			start_year,
			end_year,
			ongoing,
			cover_url: card
				.select(&sel::LAZY_COVER)
				.next()
				.and_then(|img| img.value().attr("data-src"))
				.map(str::to_string),
			issue_count: card
				.select(&sel::SERIES_ISSUE_COUNT)
				.next()
				.map(text_of)
				.and_then(|t| t.parse::<i32>().ok()),
			url: href.map(str::to_string),
		});
	}

	cards
}

/// Parse the issue cards from a `list=series` or `list=releases` response body.
/// Whole-body counterpart to [`parse_issue_cards`]; see [`parse_series_search`].
#[cfg(test)]
pub fn parse_issue_list(body: &str) -> Result<Vec<IssueCard>, serde_json::Error> {
	let response: GetComicsResponse = serde_json::from_str(body)?;
	Ok(parse_issue_cards(&response.list))
}

/// Parse issue cards out of already-extracted list markup.
pub fn parse_issue_cards(list_html: &str) -> Vec<IssueCard> {
	let doc = Html::parse_fragment(list_html);
	let mut cards = Vec::new();

	for card in doc.select(&sel::ISSUE_CARD) {
		let Some(id) = card
			.value()
			.attr("data-comic")
			.map(str::to_string)
			.filter(|id| !id.is_empty())
		else {
			continue;
		};
		let link = card.select(&sel::ISSUE_TITLE_LINK).next();
		let title = link.map(text_of).and_then(non_empty).or_else(|| {
			// `data-sorting` on the title div is a normalized copy of the same text.
			card.select(&sel::ISSUE_TITLE_LINK)
				.next()
				.and_then(|el| el.value().attr("data-sorting"))
				.map(tidy)
		});
		let Some(title) = title else { continue };

		cards.push(IssueCard {
			id,
			title,
			publisher: card
				.select(&sel::ISSUE_PUBLISHER)
				.next()
				.map(text_of)
				.and_then(non_empty),
			store_date: card
				.select(&sel::ISSUE_DATE)
				.next()
				.and_then(|el| el.value().attr("data-date"))
				.and_then(|ts| ts.parse::<i64>().ok())
				.and_then(timestamp_to_date),
			cover_url: card
				.select(&sel::LAZY_COVER)
				.next()
				.and_then(|img| img.value().attr("data-src"))
				.map(str::to_string),
			url: link
				.and_then(|l| l.value().attr("href"))
				.map(str::to_string),
			parent_id: card
				.value()
				.attr("data-parent")
				.and_then(|p| p.parse::<i64>().ok()),
		});
	}

	cards
}

/// Parse the Issues widget of a `/search/ajax_issues` response.
///
/// The response carries three widgets (Issues, Series, Characters); scoping to the
/// comics list is what keeps character rows out of the issue results. Note this
/// endpoint is a typeahead and returns at most ~5 rows.
pub fn parse_issue_widget(html: &str) -> Vec<IssueCard> {
	let doc = Html::parse_fragment(html);
	let mut cards = Vec::new();

	let Some(list) = doc.select(&sel::WIDGET_COMICS_LIST).next() else {
		return cards;
	};

	for item in list.select(&sel::WIDGET_ITEM) {
		let Some(link) = item.select(&sel::WIDGET_TITLE_LINK).next() else {
			continue;
		};
		let href = link.value().attr("href");
		let Some(id) = href.and_then(|h| id_from_path(h, "/comic/")) else {
			continue;
		};
		let Some(title) = non_empty(text_of(link)) else {
			continue;
		};

		cards.push(IssueCard {
			id,
			title,
			publisher: item
				.select(&sel::WIDGET_PUBLISHER)
				.next()
				.map(text_of)
				.and_then(non_empty),
			// No timestamp attribute here, so the printed date is parsed instead.
			store_date: item
				.select(&sel::WIDGET_DATE)
				.next()
				.map(text_of)
				.as_deref()
				.and_then(parse_long_date),
			cover_url: item
				.select(&sel::WIDGET_COVER)
				.next()
				.and_then(|img| img.value().attr("src"))
				.map(str::to_string),
			url: href.map(str::to_string),
			parent_id: None,
		});
	}

	cards
}

/// Parse the `header` markup of a `list=series` response for publisher and years.
/// Returns `(publisher, start_year, end_year, ongoing)`.
pub fn parse_series_header(
	header_html: &str,
) -> (Option<String>, Option<i32>, Option<i32>, bool) {
	let doc = Html::parse_fragment(header_html);
	let Some(intro) = doc.select(&sel::SERIES_HEADER_INTRO).next() else {
		return (None, None, None, false);
	};
	let text = text_of(intro);
	// "DC Comics · 2024 - Present" — split on the interpunct the site uses.
	let (publisher, years) = match text.split_once('·') {
		Some((pub_part, year_part)) => (
			non_empty(pub_part.trim().to_string()),
			year_part.to_string(),
		),
		None => (None, text.clone()),
	};
	let (start, end, ongoing) = parse_year_range(&years);
	(publisher, start, end, ongoing)
}

/// Parse an issue detail page.
pub fn parse_issue_page(html: &str) -> IssuePage {
	let doc = Html::parse_document(html);

	// "DC Comics · Released Oct 9, 2024".
	//
	// Single issues wrap this in `div.header-intro`; collected editions do not, so fall
	// back to the header section's own text with the title line removed. Depending on the
	// wrapper alone silently lost the publisher and the release date on every trade and
	// omnibus -- most of a trade-heavy library.
	let header_line = doc
		.select(&sel::PAGE_HEADER_INTRO)
		.next()
		.map(text_of)
		.or_else(|| {
			doc.select(&sel::PAGE_HEADER)
				.next()
				.map(|header| header_prelude(&text_of(header)))
		});
	let (publisher, released) = match header_line.as_deref() {
		Some(line) => match line.split_once('·') {
			Some((p, r)) => (non_empty(p.trim().to_string()), parse_released_date(r)),
			None => (None, None),
		},
		None => (None, None),
	};

	let details = doc.select(&sel::PAGE_DETAILS).next();
	// Every paragraph, not just the first. LOCG splits a description across several: the
	// hook, the detail, and — on a collected edition — the "Collecting …" list, which is
	// the single most useful paragraph for an omnibus and was being dropped.
	let summary = details.and_then(|d| {
		let paragraphs: Vec<String> = d
			.select(&sel::PAGE_DETAILS_SUMMARY)
			.map(text_of)
			.filter(|text| !text.trim().is_empty())
			.collect();
		non_empty(paragraphs.join("\n\n"))
	});
	// The details block is a run of text: "Comic · 44 pages · $4.99 Cover Date …", or
	// "Hardcover · 880 pages · $100.00 … ISBN 9781302925291" for a collected edition.
	let details_text = details.map(|d| text_of(d));
	let page_count = details_text.as_deref().and_then(parse_page_count);
	let isbn = details_text.as_deref().and_then(parse_isbn);

	let series_link = doc.select(&sel::PAGE_SERIES_LINK).next();
	let series_href = series_link.and_then(|l| l.value().attr("href"));

	// Characters are split across per-story sections, and an anthology repeats some.
	let mut characters: Vec<String> = Vec::new();
	for section in doc.select(&sel::PAGE_CHARACTER_SECTIONS) {
		for link in section.select(&sel::CHARACTER_LINK) {
			if let Some(name) = non_empty(text_of(link)) {
				if !characters.contains(&name) {
					characters.push(name);
				}
			}
		}
	}

	let mut page = IssuePage {
		heading: doc
			.select(&sel::PAGE_TITLE)
			.next()
			.map(text_of)
			.and_then(non_empty),
		publisher,
		released,
		summary,
		page_count,
		isbn,
		cover_url: doc
			.select(&sel::PAGE_OG_IMAGE)
			.next()
			.and_then(|m| m.value().attr("content"))
			.map(str::to_string),
		series_id: series_href.and_then(|h| id_from_path(h, "/comics/series/")),
		series_url: series_href.map(str::to_string),
		characters,
		credits: Vec::new(),
	};

	for section in doc
		.select(&sel::PAGE_CREATOR_SECTIONS)
		.chain(doc.select(&sel::PAGE_TOP_LEVEL_CREDITS))
	{
		for cell in section.select(&sel::CREDIT_CELL) {
			let Some(role) = cell.select(&sel::CREDIT_ROLE).next().map(text_of) else {
				continue;
			};
			let Some(name) = cell
				.select(&sel::CREDIT_NAME)
				.next()
				.map(text_of)
				.and_then(non_empty)
			else {
				continue;
			};
			let role = role.trim().to_string();
			if role.is_empty() {
				continue;
			}
			if !page.credits.contains(&(role.clone(), name.clone())) {
				page.credits.push((role, name));
			}
		}
	}

	page
}

/// Everything in a header before the title line.
///
/// The header renders as "Marvel Comics · Released Sep 23, 2020 Absolute Carnage
/// Omnibus HC" once tags are stripped, so the publisher/date part is whatever precedes
/// the heading text. Splitting on the interpunct alone would swallow the title into the
/// date.
fn header_prelude(header_text: &str) -> String {
	// The release date ends at a 4-digit year; anything after that is the title.
	match regex_free_year_end(header_text) {
		Some(end) => header_text[..end].trim().to_string(),
		None => header_text.to_string(),
	}
}

/// Index just past the first 4-digit run in `text`, if any.
fn regex_free_year_end(text: &str) -> Option<usize> {
	let bytes = text.as_bytes();
	let mut run = 0usize;
	for (idx, byte) in bytes.iter().enumerate() {
		if byte.is_ascii_digit() {
			run += 1;
			if run == 4 {
				// Not part of a longer number (an ISBN, say).
				let next_is_digit =
					bytes.get(idx + 1).is_some_and(|b| b.is_ascii_digit());
				if !next_is_digit {
					return Some(idx + 1);
				}
			}
		} else {
			run = 0;
		}
	}
	None
}

/// Pull an ISBN out of the details run: "… ISBN 9781302925291 …".
///
/// Only digits and `X` are kept, so a hyphenated ISBN-13 normalizes to the same form
/// Longbox stores.
fn parse_isbn(details_text: &str) -> Option<String> {
	let idx = details_text.find("ISBN")?;
	let tail = &details_text[idx + 4..];
	let digits: String = tail
		.chars()
		.skip_while(|c| !c.is_ascii_alphanumeric())
		.take_while(|c| c.is_ascii_digit() || *c == '-' || *c == 'X' || *c == 'x')
		.filter(|c| *c != '-')
		.collect();
	(digits.len() >= 10).then_some(digits)
}

/// Pull the page count out of the details run: "Hardcover · 880 pages · $100.00".
///
/// The number has to be **adjacent** to the word. Taking the first `" pages"` and
/// scanning backwards for digits reads the wrong number whenever the summary happens to
/// end in the word: Absolute Carnage Omnibus describes "VENOM #16-20; and the EVERYONE
/// IS A TARGET stinger pages", which yielded a 20-page omnibus instead of an 880-page
/// one.
///
/// Takes the first adjacent match, which is the issue-level figure; the per-story counts
/// that follow are smaller and not what a book's page count means.
fn parse_page_count(details_text: &str) -> Option<i32> {
	let lower = details_text.to_lowercase();
	let bytes = lower.as_bytes();
	let mut from = 0usize;

	while let Some(found) = lower[from..].find("pages") {
		let at = from + found;
		// Walk back over any whitespace between the number and the word.
		let mut cursor = at;
		while cursor > 0 && bytes[cursor - 1].is_ascii_whitespace() {
			cursor -= 1;
		}
		let digits_end = cursor;
		while cursor > 0 && bytes[cursor - 1].is_ascii_digit() {
			cursor -= 1;
		}
		if cursor < digits_end {
			if let Ok(count) = lower[cursor..digits_end].parse::<i32>() {
				return Some(count);
			}
		}
		from = at + "pages".len();
	}

	None
}

/// Convert a Unix timestamp to a calendar date.
fn timestamp_to_date(ts: i64) -> Option<NaiveDate> {
	DateTime::from_timestamp(ts, 0).map(|dt| dt.naive_utc().date())
}

/// Parse the "Released Oct 9, 2024" fragment of the header.
fn parse_released_date(raw: &str) -> Option<NaiveDate> {
	let text = tidy(raw);
	let after = text.split_once("Released").map(|(_, r)| r).unwrap_or(&text);
	parse_long_date(after)
}

/// Parse the human-readable date forms LOCG prints: "Oct 9, 2024" in page headers and
/// "Oct 9th, 2024" on cards and widget rows.
pub fn parse_long_date(raw: &str) -> Option<NaiveDate> {
	let cleaned = tidy(raw);
	let cleaned = cleaned.trim().trim_start_matches(':').trim();
	// Strip the ordinal suffix so one format string covers both spellings.
	let normalized = strip_ordinal_suffixes(cleaned);
	NaiveDate::parse_from_str(&normalized, "%b %d, %Y")
		.or_else(|_| NaiveDate::parse_from_str(&normalized, "%B %d, %Y"))
		.ok()
}

fn strip_ordinal_suffixes(s: &str) -> String {
	let mut out = String::with_capacity(s.len());
	let mut chars = s.char_indices().peekable();
	while let Some((i, c)) = chars.next() {
		// Drop "st"/"nd"/"rd"/"th" when it directly follows a digit.
		if c.is_ascii_alphabetic() && i > 0 {
			let prev_digit = s[..i]
				.chars()
				.next_back()
				.is_some_and(|p| p.is_ascii_digit());
			let pair = s[i..].chars().take(2).collect::<String>().to_lowercase();
			if prev_digit && matches!(pair.as_str(), "st" | "nd" | "rd" | "th") {
				chars.next();
				continue;
			}
		}
		out.push(c);
	}
	out
}

/// `(day, month, year)` for an [`ExternalMediaMetadata`]-shaped date triple.
///
/// [`ExternalMediaMetadata`]: crate::types::ExternalMediaMetadata
pub fn date_parts(date: NaiveDate) -> (i32, i32, i32) {
	(date.day() as i32, date.month() as i32, date.year())
}

/// Strip tags from a LOCG HTML description, keeping paragraph breaks as blank lines.
pub fn html_to_text(html: &str) -> Option<String> {
	let fragment = Html::parse_fragment(html);
	let text = fragment.root_element().text().collect::<Vec<_>>().join(" ");
	non_empty(tidy(&text))
}
