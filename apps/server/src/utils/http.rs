use std::{fmt::Write, path::Path, time::SystemTime};

use axum::{
	http::{header, HeaderValue},
	response::{IntoResponse, Response},
};
use chrono::{DateTime, NaiveDateTime, Utc};
use longbox_core::filesystem::ContentType;
use sha2::{Digest, Sha256};
use tracing::error;

/// The cache policy for images which Longbox itself derives and can rewrite in place: thumbnails
/// and covers, user avatars, custom emoji.
///
/// These live at stable, token-free URLs (e.g. `/api/v2/media/{id}/thumbnail`), so the *only* thing
/// that tells a client its copy is out of date is revalidation. A regeneration -- a format/quality
/// change, a resized `thumbnail_config`, or a user re-running the thumbnail job -- must reach
/// clients that already have the old bytes on disk.
///
/// - `max-age=600` keeps a browsing session (library grid -> series -> book -> back) entirely on
///   the client's disk cache. This is what stops a ~72-cover library page from firing 72
///   revalidations on every navigation.
/// - `stale-while-revalidate=604800` means that for the following week the client paints the
///   cached image *immediately* and revalidates in the background, so a regeneration lands on the
///   next navigation without ever blocking a paint. Clients that don't implement
///   `stale-while-revalidate` (notably Safari) simply fall back to a blocking conditional GET,
///   which is a ~200 byte 304 on HTTP/2.
/// - Past that, a blocking conditional GET. Still a 304 unless the bytes actually changed.
const DERIVED_IMAGE_CACHE_CONTROL: &str =
	"private, max-age=600, stale-while-revalidate=604800";

/// The cache policy for images read straight out of a book's file, i.e. reader pages.
///
/// A page is immutable for a given archive + page index: it can only change if the user replaces
/// the file on disk. It is also the most expensive thing we serve (archive seek + decompress, or a
/// PDF render), so a revalidation is not the cheap "stat and 304" it is for a thumbnail on disk --
/// we have to reproduce the page to know its validator. That argues for a much longer fresh
/// window than derived images get.
///
/// It does *not* argue for the old year-long immutable policy though: a replaced file under a
/// stable media ID would otherwise be permanently invisible. A day of freshness plus a year of
/// `stale-while-revalidate` means a reader session never blocks on revalidation and a changed file
/// still converges on its own.
const SOURCE_PAGE_CACHE_CONTROL: &str =
	"private, max-age=86400, stale-while-revalidate=31536000";

/// Which caching contract an [`ImageResponse`] advertises. See [`DERIVED_IMAGE_CACHE_CONTROL`] and
/// [`SOURCE_PAGE_CACHE_CONTROL`] for the reasoning behind each.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ImageCachePolicy {
	/// An image Longbox generated and may regenerate under the same URL.
	#[default]
	Derived,
	/// A page read out of a book file, immutable unless that file changes.
	SourcePage,
	/// A stand-in served because the real image could not be produced (e.g.
	/// thumbnail generation failed mid-scan and the handler fell back to a raw
	/// page). `no-store`: caching a failure pins it — the next request must
	/// retry the real thing.
	Uncacheable,
}

impl ImageCachePolicy {
	fn cache_control(self) -> HeaderValue {
		match self {
			Self::Derived => HeaderValue::from_static(DERIVED_IMAGE_CACHE_CONTROL),
			Self::SourcePage => HeaderValue::from_static(SOURCE_PAGE_CACHE_CONTROL),
			Self::Uncacheable => HeaderValue::from_static("no-store"),
		}
	}
}

/// [`ImageResponse`] is a thin wrapper struct to return an image correctly in Axum.
/// It contains a subset of actual Content-Type's (using [`ContentType`] enum from
/// `longbox_core`), as well as the raw image data. This is mostly the same as [`BufferResponse`],
/// but adds cache headers and validators.
///
/// Every response carries a strong `ETag` derived from the bytes being served, plus (where the
/// caller knows which file the bytes came from) a `Last-Modified`. Those validators are what let
/// the `conditional_get` middleware answer a client's `If-None-Match` / `If-Modified-Since` with a
/// 304, and -- much more importantly -- what lets a client discover that a regenerated image under
/// an unchanged URL is *not* the one it already has.
///
/// The ETag is hashed from the response body rather than derived from the source file's
/// mtime/size, because several of these responses have no single source file: reader pages come
/// out of an archive, thumbnails may be generated on the fly by the self-heal path, and the Kobo
/// and OPDS v1.2 handlers re-encode bytes before sending them. Hashing what we are about to write
/// is correct for all of those with no extra I/O and no plumbing, and it cannot miss a change the
/// way a preserved mtime can. The cost is a hash over a buffer that is already in memory and hot
/// in cache, which is small next to the read/decode that produced it.
pub struct ImageResponse {
	pub content_type: ContentType,
	pub data: Vec<u8>,
	pub policy: ImageCachePolicy,
	pub last_modified: Option<SystemTime>,
}

impl ImageResponse {
	/// A response for an image Longbox derived and may regenerate later, e.g. a thumbnail.
	pub fn new(content_type: ContentType, data: Vec<u8>) -> Self {
		Self {
			content_type,
			data,
			policy: ImageCachePolicy::Derived,
			last_modified: None,
		}
	}

	/// A response for a page read out of a book file. See [`ImageCachePolicy::SourcePage`].
	pub fn source_page(content_type: ContentType, data: Vec<u8>) -> Self {
		Self {
			policy: ImageCachePolicy::SourcePage,
			..Self::new(content_type, data)
		}
	}

	/// A stand-in for an image that could not be produced. See
	/// [`ImageCachePolicy::Uncacheable`].
	pub fn uncacheable(content_type: ContentType, data: Vec<u8>) -> Self {
		Self {
			policy: ImageCachePolicy::Uncacheable,
			..Self::new(content_type, data)
		}
	}

	/// Record the modification time of the file the bytes were read from, so the response can
	/// carry a `Last-Modified`.
	///
	/// Only call this when `path` is genuinely the source of `self.data` -- a `Last-Modified` that
	/// describes a *different* file is precisely the sort of lying validator this whole change
	/// exists to remove. Anything served from a fallback chain or generated in memory should just
	/// leave it unset and rely on the ETag.
	pub async fn with_source_file(mut self, path: impl AsRef<Path>) -> Self {
		self.last_modified = tokio::fs::metadata(path.as_ref())
			.await
			.and_then(|meta| meta.modified())
			.ok();
		self
	}
}

impl From<(ContentType, Vec<u8>)> for ImageResponse {
	fn from((content_type, data): (ContentType, Vec<u8>)) -> Self {
		Self::new(content_type, data)
	}
}

impl IntoResponse for ImageResponse {
	fn into_response(self) -> Response {
		let cache_control = self.policy.cache_control();
		// A no-store response must not carry validators: an ETag invites the
		// client to revalidate a body we've told it never to keep.
		let etag = (self.policy != ImageCachePolicy::Uncacheable)
			.then(|| entity_tag(&self.data));
		let last_modified = self.last_modified.map(format_http_date);
		let content_type = HeaderValue::from_str(self.content_type.to_string().as_str())
			.unwrap_or_else(|err| {
				error!(?err, "Failed to derive explicit content type");
				HeaderValue::from_static("image/jpeg")
			});

		let mut base_response = self.data.into_response();
		let headers = base_response.headers_mut();

		headers.insert(header::CONTENT_TYPE, content_type);
		headers.insert(header::CACHE_CONTROL, cache_control);

		if let Some(etag) = etag {
			match HeaderValue::from_str(&etag) {
				Ok(value) => {
					headers.insert(header::ETAG, value);
				},
				Err(err) => error!(?err, "Failed to build ETag header"),
			}
		}

		if let Some(last_modified) = last_modified {
			match HeaderValue::from_str(&last_modified) {
				Ok(value) => {
					headers.insert(header::LAST_MODIFIED, value);
				},
				Err(err) => error!(?err, "Failed to build Last-Modified header"),
			}
		}

		base_response
	}
}

/// Build a strong entity tag for `data`.
///
/// SHA-256 truncated to 128 bits: `sha2` is already a dependency, it is hardware accelerated on
/// most CPUs Longbox runs on, and 128 bits is far past the point where an accidental collision
/// between two versions of the same cover is a real concern.
fn entity_tag(data: &[u8]) -> String {
	let digest = Sha256::digest(data);

	// `"` + 16 bytes as hex + `"`
	let mut tag = String::with_capacity(34);
	tag.push('"');
	for byte in &digest[..16] {
		// Writing to a String is infallible
		let _ = write!(tag, "{byte:02x}");
	}
	tag.push('"');

	tag
}

/// Format a timestamp as an HTTP-date (IMF-fixdate), e.g. `Sun, 06 Nov 1994 08:49:37 GMT`.
pub fn format_http_date(time: SystemTime) -> String {
	DateTime::<Utc>::from(time)
		.format("%a, %d %b %Y %H:%M:%S GMT")
		.to_string()
}

/// Parse an HTTP-date as sent in `If-Modified-Since`. Accepts the IMF-fixdate that
/// [`format_http_date`] emits (which is what clients echo back), falling back to RFC 2822 for the
/// stragglers.
pub fn parse_http_date(value: &str) -> Option<SystemTime> {
	let value = value.trim();

	NaiveDateTime::parse_from_str(value, "%a, %d %b %Y %H:%M:%S GMT")
		.map(|naive| naive.and_utc())
		.ok()
		.or_else(|| {
			DateTime::parse_from_rfc2822(value)
				.map(|parsed| parsed.with_timezone(&Utc))
				.ok()
		})
		.map(SystemTime::from)
}

/// [Xml] is a wrapper struct to return XML correctly in Axum. It really just
/// sets the content type to application/xml.
pub struct Xml(pub String);

impl IntoResponse for Xml {
	fn into_response(self) -> Response {
		// initialize the response based on axum's default for strings
		let mut base_response = self.0.into_response();

		// only real difference is that we set the content type to xml
		base_response.headers_mut().insert(
			header::CONTENT_TYPE,
			HeaderValue::from_static("application/xml"),
		);

		base_response
	}
}

/// [`BufferResponse`] is a wrapper struct to return a buffer of any Longbox-compliant (see [`ContentType`])
/// Content-Type correctly in Axum.
pub struct BufferResponse {
	pub content_type: ContentType,
	pub data: Vec<u8>,
}

impl From<(ContentType, Vec<u8>)> for BufferResponse {
	fn from((content_type, data): (ContentType, Vec<u8>)) -> Self {
		Self { content_type, data }
	}
}

impl IntoResponse for BufferResponse {
	fn into_response(self) -> Response {
		let mut base_response = self.data.into_response();

		base_response.headers_mut().insert(
			header::CONTENT_TYPE,
			HeaderValue::from_str(self.content_type.to_string().as_str())
				.expect("Failed to parse content type"),
		);

		base_response
	}
}

/// Download an image from a URL and return its raw bytes and extension (derived from the content type)
pub async fn download_image(url: &str) -> Result<(Vec<u8>, String), String> {
	let response = reqwest::get(url)
		.await
		.map_err(|e| format!("Failed to fetch image from '{url}': {e}"))?;

	if !response.status().is_success() {
		return Err(format!(
			"Non-success status {} fetching image from '{url}'",
			response.status()
		));
	}

	let content_type = response
		.headers()
		.get(header::CONTENT_TYPE)
		.and_then(|v| v.to_str().ok())
		.unwrap_or_default();

	if !content_type.starts_with("image/") {
		return Err(format!(
			"Invalid content type '{content_type}' fetching image from '{url}'"
		));
	}

	let ext = content_type
		.split('/')
		.nth(1)
		.map(|s| s.split(';').next().unwrap_or(s).trim().to_lowercase())
		.unwrap_or_else(|| "jpg".to_string());

	let bytes = response.bytes().await.map_err(|e| {
		tracing::error!(?e, "Failed to read image bytes from response");
		format!("Failed to read image bytes from '{url}'")
	})?;

	Ok((bytes.to_vec(), ext))
}

#[cfg(test)]
mod tests {
	use super::*;
	use longbox_core::filesystem::ContentType;

	#[test]
	fn test_buffer_response() {
		let response = BufferResponse {
			content_type: ContentType::HTML,
			data: b"Hello, world!".to_vec(),
		};
		let axum_response = response.into_response();

		assert_eq!(
			axum_response.headers().get(header::CONTENT_TYPE),
			Some(&HeaderValue::from_static("text/html"))
		);
	}

	fn header(response: &Response, name: header::HeaderName) -> Option<&str> {
		response.headers().get(name).and_then(|v| v.to_str().ok())
	}

	#[test]
	fn test_image_response() {
		let response = ImageResponse::new(ContentType::JPEG, b"Hello, world!".to_vec());
		let axum_response = response.into_response();

		assert_eq!(
			axum_response.headers().get(header::CONTENT_TYPE),
			Some(&HeaderValue::from_static("image/jpeg"))
		);
	}

	#[test]
	fn uncacheable_images_are_no_store_without_validators() {
		let response =
			ImageResponse::uncacheable(ContentType::JPEG, b"stand-in".to_vec())
				.into_response();

		assert_eq!(
			header(&response, header::CACHE_CONTROL),
			Some("no-store"),
			"a failure stand-in must never be cached"
		);
		assert!(
			header(&response, header::ETAG).is_none(),
			"no-store must not invite revalidation with an ETag"
		);
	}

	#[test]
	fn derived_images_are_cached_but_revalidatable() {
		let response =
			ImageResponse::new(ContentType::WEBP, b"thumbnail".to_vec()).into_response();

		let cache_control = header(&response, header::CACHE_CONTROL)
			.expect("derived images must set Cache-Control");

		// Authenticated endpoints -- a shared cache must never hold onto these
		assert!(cache_control.contains("private"));
		// The old policy was `max-age=31536000` with no validator, which made a regenerated
		// thumbnail invisible to any client that had already loaded the old one
		assert!(cache_control.contains("max-age=600"));
		assert!(cache_control.contains("stale-while-revalidate=604800"));
	}

	#[test]
	fn source_pages_get_a_longer_fresh_window() {
		let response = ImageResponse::source_page(ContentType::JPEG, b"page".to_vec())
			.into_response();

		let cache_control = header(&response, header::CACHE_CONTROL)
			.expect("source pages must set Cache-Control");

		assert!(cache_control.contains("private"));
		assert!(cache_control.contains("max-age=86400"));
		assert!(cache_control.contains("stale-while-revalidate=31536000"));
	}

	#[test]
	fn image_responses_carry_a_strong_etag() {
		let response =
			ImageResponse::new(ContentType::WEBP, b"thumbnail".to_vec()).into_response();

		let etag = header(&response, header::ETAG).expect("images must set an ETag");

		assert!(etag.starts_with('"') && etag.ends_with('"'), "{etag}");
		assert!(
			!etag.starts_with("W/"),
			"expected a strong validator: {etag}"
		);
	}

	#[test]
	fn etag_changes_when_the_image_changes() {
		// The regression this whole thing exists for: regenerating a thumbnail replaces the
		// bytes under an unchanged URL, so the validator has to move with them.
		let full_size = ImageResponse::new(ContentType::JPEG, b"1988x3057 jpeg".to_vec())
			.into_response();
		let regenerated = ImageResponse::new(ContentType::WEBP, b"512x787 webp".to_vec())
			.into_response();

		assert_ne!(
			header(&full_size, header::ETAG),
			header(&regenerated, header::ETAG)
		);
	}

	#[test]
	fn etag_is_stable_for_identical_bytes() {
		let first =
			ImageResponse::new(ContentType::WEBP, b"same".to_vec()).into_response();
		let second =
			ImageResponse::new(ContentType::WEBP, b"same".to_vec()).into_response();

		assert_eq!(header(&first, header::ETAG), header(&second, header::ETAG));
	}

	#[test]
	fn last_modified_is_only_set_when_a_source_file_is_known() {
		let response =
			ImageResponse::new(ContentType::WEBP, b"generated".to_vec()).into_response();

		assert_eq!(header(&response, header::LAST_MODIFIED), None);
	}

	#[tokio::test]
	async fn last_modified_is_read_from_the_source_file() {
		let file = tempfile::NamedTempFile::new().expect("failed to create temp file");
		let expected = format_http_date(
			file.as_file()
				.metadata()
				.expect("failed to stat temp file")
				.modified()
				.expect("platform does not report mtime"),
		);

		let response = ImageResponse::new(ContentType::WEBP, b"thumbnail".to_vec())
			.with_source_file(file.path())
			.await
			.into_response();

		assert_eq!(header(&response, header::LAST_MODIFIED), Some(&*expected));
	}

	#[tokio::test]
	async fn a_missing_source_file_leaves_last_modified_unset() {
		let response = ImageResponse::new(ContentType::WEBP, b"thumbnail".to_vec())
			.with_source_file("/definitely/not/a/real/thumbnail.webp")
			.await
			.into_response();

		assert_eq!(header(&response, header::LAST_MODIFIED), None);
	}

	#[test]
	fn http_dates_round_trip() {
		let formatted = "Sun, 06 Nov 1994 08:49:37 GMT";
		let parsed = parse_http_date(formatted).expect("failed to parse HTTP date");

		assert_eq!(format_http_date(parsed), formatted);
	}

	#[test]
	fn http_dates_accept_rfc_2822_offsets() {
		assert_eq!(
			parse_http_date("Sun, 06 Nov 1994 08:49:37 +0000"),
			parse_http_date("Sun, 06 Nov 1994 08:49:37 GMT")
		);
	}

	#[test]
	fn garbage_http_dates_are_rejected() {
		assert_eq!(parse_http_date("not a date"), None);
	}

	#[test]
	fn test_xml_response() {
		let response = Xml("<xml></xml>".to_string());
		let axum_response = response.into_response();

		assert_eq!(
			axum_response.headers().get(header::CONTENT_TYPE),
			Some(&HeaderValue::from_static("application/xml"))
		);
	}
}
