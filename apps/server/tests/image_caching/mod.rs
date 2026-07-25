//! Cache-validator behaviour for image endpoints.
//!
//! These endpoints live at stable, token-free URLs (`/api/v2/media/{id}/thumbnail`), so the only
//! way a client learns that a regenerated thumbnail replaced the one it already has is
//! revalidation. Regenerating thumbnails used to be invisible to any browser that had loaded the
//! old bytes, because the response was `Cache-Control: private, max-age=31536000` with no
//! validator at all -- these tests pin down the pieces that fixed that.

use std::{fs, path::PathBuf, time::SystemTime};

use axum::http::{header, StatusCode};
use axum_test::TestResponse;
use sea_orm::{ActiveModelTrait, ActiveValue, IntoActiveModel};
use tempfile::TempDir;
use tests::fake_data;

use crate::common::{series::setup_single_series_with_n_books, TestApp};

const ORIGINAL_THUMBNAIL: &[u8] = b"pretend this is a 1988x3057 jpeg";
const REGENERATED_THUMBNAIL: &[u8] = b"pretend this is a 512x787 webp";

struct Fixture {
	app: TestApp,
	book_id: String,
	thumbnail_path: PathBuf,
	// Held so the directory outlives the test
	_thumbnails_dir: TempDir,
}

impl Fixture {
	async fn new() -> Self {
		let app = TestApp::new_with_default_user().await;
		let conn = app.conn();

		let library = fake_data::Library {
			name: Some("Image".to_string()),
			..Default::default()
		}
		.insert(conn)
		.await;

		let (_, books) = setup_single_series_with_n_books(
			&app,
			fake_data::Series {
				name: Some("Black Science".to_string()),
				library_id: Some(library.id.clone()),
				..Default::default()
			},
			1,
		)
		.await;
		let book = books.into_iter().next().expect("expected a book");

		let thumbnails_dir = TempDir::new().expect("failed to create thumbnails dir");
		let thumbnail_path = thumbnails_dir.path().join(format!("{}.webp", book.id));
		fs::write(&thumbnail_path, ORIGINAL_THUMBNAIL)
			.expect("failed to write thumbnail");

		let book_id = book.id.clone();
		let mut book = book.into_active_model();
		book.thumbnail_path =
			ActiveValue::Set(Some(thumbnail_path.to_string_lossy().into_owned()));
		book.update(conn)
			.await
			.expect("failed to set thumbnail_path");

		Self {
			app,
			book_id,
			thumbnail_path,
			_thumbnails_dir: thumbnails_dir,
		}
	}

	fn url(&self) -> String {
		format!("/api/v2/media/{}/thumbnail", self.book_id)
	}

	/// Stand in for a thumbnail regeneration job: same URL, same media row, different bytes
	fn regenerate_thumbnail(&self) {
		fs::write(&self.thumbnail_path, REGENERATED_THUMBNAIL)
			.expect("failed to regenerate thumbnail");
	}

	fn set_thumbnail_mtime(&self, mtime: SystemTime) {
		fs::File::options()
			.write(true)
			.open(&self.thumbnail_path)
			.expect("failed to open thumbnail")
			.set_modified(mtime)
			.expect("failed to set thumbnail mtime");
	}
}

fn header_value(response: &TestResponse, name: header::HeaderName) -> String {
	response
		.maybe_header(name.clone())
		.unwrap_or_else(|| panic!("expected a {name} header"))
		.to_str()
		.expect("header was not valid utf-8")
		.to_string()
}

#[tokio::test]
async fn thumbnail_is_cacheable_but_revalidatable() {
	let fixture = Fixture::new().await;

	let response = fixture.app.get(&fixture.url()).await;
	response.assert_status_ok();
	assert_eq!(response.as_bytes(), ORIGINAL_THUMBNAIL);

	let cache_control = header_value(&response, header::CACHE_CONTROL);
	// These endpoints are authenticated, so a shared cache must never store them
	assert!(cache_control.contains("private"), "{cache_control}");
	// ...but the old year-long window with no validator is what made regeneration invisible
	assert!(
		!cache_control.contains("max-age=31536000"),
		"{cache_control}"
	);
	assert!(
		cache_control.contains("stale-while-revalidate"),
		"{cache_control}"
	);

	// Validators the client can revalidate with
	assert!(response.contains_header(header::ETAG));
	assert!(response.contains_header(header::LAST_MODIFIED));
}

#[tokio::test]
async fn matching_etag_returns_304_with_no_body() {
	let fixture = Fixture::new().await;

	let etag = header_value(&fixture.app.get(&fixture.url()).await, header::ETAG);

	let response = fixture
		.app
		.get_with_headers(&fixture.url(), &[("if-none-match", &etag)])
		.await;

	response.assert_status(StatusCode::NOT_MODIFIED);
	assert!(
		response.as_bytes().is_empty(),
		"a 304 must not carry a body"
	);
	// The client still needs these to refresh its stored response
	assert_eq!(header_value(&response, header::ETAG), etag);
	assert!(response.contains_header(header::CACHE_CONTROL));
	// ...and must not be told about a representation it isn't being sent. Note that the HTTP
	// layer is entitled to frame the empty body as `Content-Length: 0`; what matters is that we
	// never claim the image's length while omitting the image.
	assert!(!response.contains_header(header::CONTENT_TYPE));
	let content_length = response.maybe_header(header::CONTENT_LENGTH);
	assert!(
		content_length
			.as_ref()
			.is_none_or(|length| length.as_bytes() == b"0"),
		"304 advertised a body length of {content_length:?}"
	);
}

#[tokio::test]
async fn non_matching_etag_returns_the_bytes() {
	let fixture = Fixture::new().await;

	let response = fixture
		.app
		.get_with_headers(&fixture.url(), &[("if-none-match", "\"not-the-one\"")])
		.await;

	response.assert_status_ok();
	assert_eq!(response.as_bytes(), ORIGINAL_THUMBNAIL);
}

/// The regression that motivated all of this: a thumbnail regenerated in place (full-size JPEG ->
/// resized WebP) under an unchanged URL must produce a different validator, and a client holding
/// the old validator must be served the new bytes rather than a 304.
#[tokio::test]
async fn regenerating_a_thumbnail_invalidates_the_cached_copy() {
	let fixture = Fixture::new().await;

	let before = fixture.app.get(&fixture.url()).await;
	before.assert_status_ok();
	let stale_etag = header_value(&before, header::ETAG);

	fixture.regenerate_thumbnail();

	let after = fixture.app.get(&fixture.url()).await;
	after.assert_status_ok();
	assert_eq!(after.as_bytes(), REGENERATED_THUMBNAIL);

	let fresh_etag = header_value(&after, header::ETAG);
	assert_ne!(
		stale_etag, fresh_etag,
		"regenerating an image must change its validator"
	);

	// A browser that cached the pre-regeneration copy asks with the old validator and must be
	// handed the new bytes
	let revalidated = fixture
		.app
		.get_with_headers(&fixture.url(), &[("if-none-match", &stale_etag)])
		.await;
	revalidated.assert_status_ok();
	assert_eq!(revalidated.as_bytes(), REGENERATED_THUMBNAIL);

	// ...and once it has them, it goes back to cheap 304s
	let up_to_date = fixture
		.app
		.get_with_headers(&fixture.url(), &[("if-none-match", &fresh_etag)])
		.await;
	up_to_date.assert_status(StatusCode::NOT_MODIFIED);
}

#[tokio::test]
async fn if_modified_since_is_honoured() {
	let fixture = Fixture::new().await;
	// 06 Nov 1994 08:49:37 GMT
	fixture.set_thumbnail_mtime(
		SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(784_111_777),
	);

	let response = fixture.app.get(&fixture.url()).await;
	assert_eq!(
		header_value(&response, header::LAST_MODIFIED),
		"Sun, 06 Nov 1994 08:49:37 GMT"
	);

	let unchanged = fixture
		.app
		.get_with_headers(
			&fixture.url(),
			&[("if-modified-since", "Mon, 07 Nov 1994 08:49:37 GMT")],
		)
		.await;
	unchanged.assert_status(StatusCode::NOT_MODIFIED);
	assert!(unchanged.as_bytes().is_empty());

	let changed = fixture
		.app
		.get_with_headers(
			&fixture.url(),
			&[("if-modified-since", "Sat, 05 Nov 1994 08:49:37 GMT")],
		)
		.await;
	changed.assert_status_ok();
	assert_eq!(changed.as_bytes(), ORIGINAL_THUMBNAIL);
}

/// A regeneration that happens to preserve the file's mtime still has to be caught, which is why
/// `If-None-Match` wins over `If-Modified-Since` when a client sends both.
#[tokio::test]
async fn etag_wins_over_a_preserved_mtime() {
	let fixture = Fixture::new().await;
	let mtime = SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(784_111_777);
	fixture.set_thumbnail_mtime(mtime);

	let stale_etag = header_value(&fixture.app.get(&fixture.url()).await, header::ETAG);

	fixture.regenerate_thumbnail();
	fixture.set_thumbnail_mtime(mtime);

	let response = fixture
		.app
		.get_with_headers(
			&fixture.url(),
			&[
				("if-none-match", stale_etag.as_str()),
				("if-modified-since", "Sun, 06 Nov 1994 08:49:37 GMT"),
			],
		)
		.await;

	response.assert_status_ok();
	assert_eq!(response.as_bytes(), REGENERATED_THUMBNAIL);
}

/// The middleware wraps the whole router, so it has to stay inert for everything that doesn't
/// advertise a validator.
#[tokio::test]
async fn responses_without_validators_are_untouched() {
	let app = TestApp::new_with_default_user().await;

	let response = app
		.get_with_headers("/api/v2/ping", &[("if-none-match", "*")])
		.await;

	response.assert_status_ok();
	assert_eq!(response.text(), "pong");
}

/// A soft check that the entity we serve is the one we hashed: the same media row served twice
/// without any change in between must produce the same validator.
#[tokio::test]
async fn unchanged_thumbnail_keeps_its_etag() {
	let fixture = Fixture::new().await;

	let first = header_value(&fixture.app.get(&fixture.url()).await, header::ETAG);
	let second = header_value(&fixture.app.get(&fixture.url()).await, header::ETAG);

	assert_eq!(first, second);
}
