//! Keying, classification, and freshness rules for cached provider HTTP responses.
//!
//! The cache itself is storage-agnostic — persistence lives behind
//! [`crate::runtime::ProviderRuntime`] — but every store agrees on three things
//! defined here: how a request URL becomes a stable key, which URLs are cacheable
//! at all (and under which freshness class), and how old a cached body may be
//! before it no longer counts as fresh. Freshness is evaluated at read time from
//! the row's age, so changing a TTL takes effect for existing rows immediately.

use std::time::Duration;

use sha2::{Digest, Sha256};
use url::Url;

/// Bodies larger than this are never cached. Provider list pages are far below
/// this; anything above it is an anomaly not worth a table row.
pub const MAX_CACHE_BODY_BYTES: usize = 512 * 1024;

/// Freshness class of a cacheable URL. `Detail` rows (a single issue/volume/
/// series) change rarely; `List` rows (searches, filtered collections) are the
/// moving target and expire much sooner.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CacheKind {
	Detail,
	List,
}

impl CacheKind {
	pub fn as_str(&self) -> &'static str {
		match self {
			CacheKind::Detail => "detail",
			CacheKind::List => "list",
		}
	}

	pub fn parse(value: &str) -> Option<Self> {
		match value {
			"detail" => Some(CacheKind::Detail),
			"list" => Some(CacheKind::List),
			_ => None,
		}
	}
}

/// Freshness windows per [`CacheKind`].
#[derive(Debug, Clone, Copy)]
pub struct CacheTtls {
	pub detail: Duration,
	pub list: Duration,
}

impl Default for CacheTtls {
	fn default() -> Self {
		Self {
			detail: Duration::from_secs(7 * 24 * 60 * 60),
			list: Duration::from_secs(12 * 60 * 60),
		}
	}
}

impl CacheTtls {
	pub fn is_fresh(&self, kind: CacheKind, age: Duration) -> bool {
		let ttl = match kind {
			CacheKind::Detail => self.detail,
			CacheKind::List => self.list,
		};
		age <= ttl
	}
}

/// Normalize a request URL for keying: credentials (`api_key`) are stripped so
/// keys survive token rotation and never persist secrets, remaining query pairs
/// are sorted so parameter order doesn't fragment the cache, and fragments are
/// dropped. Unparseable input is returned verbatim — it will simply never match
/// a classified (cacheable) URL.
pub fn normalize_url(raw: &str) -> String {
	let Ok(mut url) = Url::parse(raw) else {
		return raw.to_string();
	};

	let mut pairs: Vec<(String, String)> = url
		.query_pairs()
		.filter(|(key, _)| key != "api_key")
		.map(|(key, value)| (key.into_owned(), value.into_owned()))
		.collect();
	pairs.sort();

	url.set_fragment(None);
	if pairs.is_empty() {
		url.set_query(None);
	} else {
		let query = pairs
			.iter()
			.fold(
				url::form_urlencoded::Serializer::new(String::new()),
				|mut serializer, (key, value)| {
					serializer.append_pair(key, value);
					serializer
				},
			)
			.finish();
		url.set_query(Some(&query));
	}

	url.to_string()
}

/// SHA-256 hex of the normalized URL — the persistent cache row key.
pub fn cache_key(raw: &str) -> String {
	let normalized = normalize_url(raw);
	let digest = Sha256::digest(normalized.as_bytes());
	digest
		.iter()
		.fold(String::with_capacity(digest.len() * 2), |mut hex, byte| {
			use std::fmt::Write;
			let _ = write!(hex, "{byte:02x}");
			hex
		})
}

/// Whether a URL is cacheable, and under which freshness class. Only URL shapes
/// our providers actually issue are classified; everything else (GraphQL POSTs,
/// auth probes, unknown endpoints) returns `None` and is never cached.
///
/// ComicVine: `/api/{issue|volume}/{4000|4050}-{n}/` → Detail;
/// `/api/{search|issues|volumes}/` → List.
/// Metron: `/api/{resource}/{n}/` → Detail; `/api/{resource}/` → List.
pub fn classify(raw: &str) -> Option<CacheKind> {
	let url = Url::parse(raw).ok()?;
	let segments: Vec<&str> = url.path_segments()?.filter(|s| !s.is_empty()).collect();
	let api_pos = segments.iter().position(|s| *s == "api")?;
	let rest = &segments[api_pos + 1..];

	const DETAIL_RESOURCES: &[&str] = &[
		"issue",
		"volume",
		"series",
		"arc",
		"character",
		"team",
		"publisher",
		"story_arc",
		"person",
	];
	const LIST_RESOURCES: &[&str] = &[
		"search",
		"issues",
		"volumes",
		"issue",
		"series",
		"arc",
		"character",
		"team",
		"publisher",
	];

	match rest {
		[resource] if LIST_RESOURCES.contains(resource) => Some(CacheKind::List),
		[resource, id] if DETAIL_RESOURCES.contains(resource) => {
			is_resource_id(id).then_some(CacheKind::Detail)
		},
		_ => None,
	}
}

/// A bare numeric id (Metron: `9910`) or a ComicVine prefixed id (`4000-123`).
fn is_resource_id(segment: &str) -> bool {
	if segment.is_empty() {
		return false;
	}
	match segment.split_once('-') {
		Some((prefix, number)) => {
			!prefix.is_empty()
				&& !number.is_empty()
				&& prefix.chars().all(|c| c.is_ascii_digit())
				&& number.chars().all(|c| c.is_ascii_digit())
		},
		None => segment.chars().all(|c| c.is_ascii_digit()),
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn normalize_strips_api_key_and_sorts_pairs() {
		let a = normalize_url(
			"https://comicvine.gamespot.com/api/search/?api_key=SECRET&query=saga&format=json",
		);
		let b = normalize_url(
			"https://comicvine.gamespot.com/api/search/?format=json&query=saga&api_key=OTHER",
		);
		assert_eq!(a, b);
		assert!(!a.contains("SECRET"), "api_key must never survive: {a}");
		assert!(a.contains("format=json") && a.contains("query=saga"));
	}

	#[test]
	fn normalize_drops_fragment_and_empty_query() {
		assert_eq!(
			normalize_url("https://metron.cloud/api/issue/9910/#frag"),
			"https://metron.cloud/api/issue/9910/"
		);
		assert_eq!(
			normalize_url("https://metron.cloud/api/issue/9910/?api_key=x"),
			"https://metron.cloud/api/issue/9910/"
		);
	}

	#[test]
	fn cache_key_is_order_insensitive_and_query_sensitive() {
		let a = cache_key("https://metron.cloud/api/issue/?cv_id=1&number=2");
		let b = cache_key("https://metron.cloud/api/issue/?number=2&cv_id=1");
		let c = cache_key("https://metron.cloud/api/issue/?number=3&cv_id=1");
		assert_eq!(a, b);
		assert_ne!(a, c);
		assert_eq!(a.len(), 64, "sha256 hex");
	}

	#[test]
	fn classify_comicvine_urls() {
		assert_eq!(
			classify("https://comicvine.gamespot.com/api/issue/4000-123/?format=json"),
			Some(CacheKind::Detail)
		);
		assert_eq!(
			classify("https://comicvine.gamespot.com/api/volume/4050-796/?format=json"),
			Some(CacheKind::Detail)
		);
		assert_eq!(
			classify("https://comicvine.gamespot.com/api/search/?query=saga"),
			Some(CacheKind::List)
		);
		assert_eq!(
			classify("https://comicvine.gamespot.com/api/issues/?filter=volume:796"),
			Some(CacheKind::List)
		);
		assert_eq!(
			classify("https://comicvine.gamespot.com/api/volumes/?filter=name:saga"),
			Some(CacheKind::List)
		);
	}

	#[test]
	fn classify_metron_urls() {
		assert_eq!(
			classify("https://metron.cloud/api/issue/9910/"),
			Some(CacheKind::Detail)
		);
		assert_eq!(
			classify("https://metron.cloud/api/series/120/"),
			Some(CacheKind::Detail)
		);
		assert_eq!(
			classify("https://metron.cloud/api/issue/?cv_id=1"),
			Some(CacheKind::List)
		);
		assert_eq!(
			classify("https://metron.cloud/api/series/?name=saga"),
			Some(CacheKind::List)
		);
	}

	#[test]
	fn classify_rejects_uncacheable_urls() {
		// Hardcover GraphQL (POST endpoint, no /api/ resource shape we cache).
		assert_eq!(classify("https://api.hardcover.app/v1/graphql"), None);
		// Non-numeric "id".
		assert_eq!(classify("https://metron.cloud/api/issue/latest/"), None);
		// Unknown resource.
		assert_eq!(classify("https://metron.cloud/api/creator/1/"), None);
		// No /api/ segment at all.
		assert_eq!(classify("https://comicvine.gamespot.com/search/"), None);
	}

	#[test]
	fn ttl_freshness_boundaries() {
		let ttls = CacheTtls::default();
		let day = 24 * 60 * 60;
		assert!(ttls.is_fresh(CacheKind::Detail, Duration::from_secs(7 * day - 1)));
		assert!(!ttls.is_fresh(CacheKind::Detail, Duration::from_secs(7 * day + 1)));
		assert!(ttls.is_fresh(CacheKind::List, Duration::from_secs(12 * 60 * 60 - 1)));
		assert!(!ttls.is_fresh(CacheKind::List, Duration::from_secs(12 * 60 * 60 + 1)));
	}

	#[test]
	fn kind_roundtrips_through_str() {
		assert_eq!(
			CacheKind::parse(CacheKind::Detail.as_str()),
			Some(CacheKind::Detail)
		);
		assert_eq!(
			CacheKind::parse(CacheKind::List.as_str()),
			Some(CacheKind::List)
		);
		assert_eq!(CacheKind::parse("weekly"), None);
	}
}
