//! Conditional request handling for responses that carry cache validators.

use std::time::SystemTime;

use axum::{
	body::Body,
	extract::Request,
	http::{header, HeaderMap, HeaderValue, Method, StatusCode},
	middleware::Next,
	response::Response,
};

use crate::utils::http::parse_http_date;

/// Turn a request whose preconditions are already satisfied into a `304 Not Modified`.
///
/// This only ever engages for responses that opted into validators by setting an `ETag` -- in
/// practice, [`crate::utils::http::ImageResponse`]. Everything else (GraphQL, the SPA's
/// `ServeDir`, book downloads via `ServeFile`, SSE) passes straight through untouched, which also
/// means this can safely wrap the entire router rather than being wired into each image route.
///
/// Note that a 304 here does not save the server the work of producing the image -- the handler
/// has already run, because the validator is derived from the bytes it produced. What it saves is
/// the transfer, which is the expensive half: a library page's worth of covers is megabytes on the
/// wire versus a few hundred bytes per 304.
pub async fn conditional_get(req: Request, next: Next) -> Response {
	// Preconditions on anything other than a read are a different feature (optimistic
	// concurrency), and not one we implement.
	let preconditions = matches!(*req.method(), Method::GET | Method::HEAD)
		.then(|| Preconditions::from_headers(req.headers()))
		.filter(Preconditions::is_present);

	let response = next.run(req).await;

	let Some(preconditions) = preconditions else {
		return response;
	};

	// Only a plain 200 has a representation we could be revalidating. Redirects, errors and
	// partial content all mean something else.
	if response.status() != StatusCode::OK
		|| !response.headers().contains_key(header::ETAG)
		|| !preconditions.satisfied_by(response.headers())
	{
		return response;
	}

	not_modified(response)
}

/// The cache validators a client sent along with its request.
struct Preconditions {
	if_none_match: Option<String>,
	if_modified_since: Option<SystemTime>,
}

impl Preconditions {
	fn from_headers(headers: &HeaderMap) -> Self {
		Self {
			if_none_match: header_str(headers, header::IF_NONE_MATCH).map(str::to_owned),
			if_modified_since: header_str(headers, header::IF_MODIFIED_SINCE)
				.and_then(parse_http_date),
		}
	}

	fn is_present(&self) -> bool {
		self.if_none_match.is_some() || self.if_modified_since.is_some()
	}

	/// Whether the client's copy is still current, given the headers we were about to respond
	/// with.
	fn satisfied_by(&self, headers: &HeaderMap) -> bool {
		// RFC 9110 § 13.2.2: when both are present `If-None-Match` wins outright and
		// `If-Modified-Since` must be ignored. That ordering matters for us specifically -- a
		// regeneration that happens to preserve the file's mtime is exactly the case the ETag
		// catches and the timestamp does not.
		if let Some(if_none_match) = self.if_none_match.as_deref() {
			return etag_matches(if_none_match, headers.get(header::ETAG));
		}

		match (
			self.if_modified_since,
			header_str(headers, header::LAST_MODIFIED).and_then(parse_http_date),
		) {
			(Some(if_modified_since), Some(last_modified)) => {
				last_modified <= if_modified_since
			},
			// No `Last-Modified` to compare against means we can't claim the client is current.
			_ => false,
		}
	}
}

/// Whether any entity tag in an `If-None-Match` list matches `etag`.
///
/// `If-None-Match` uses the *weak* comparison function (RFC 9110 § 13.1.2), so `W/"abc"` and
/// `"abc"` are a match. Splitting the list on commas is safe here because the tags we mint are
/// hex, and a client's list is built from tags we minted.
fn etag_matches(if_none_match: &str, etag: Option<&HeaderValue>) -> bool {
	let Some(etag) = etag.and_then(|value| value.to_str().ok()).map(strip_weak) else {
		return false;
	};

	if_none_match
		.split(',')
		.map(str::trim)
		.any(|candidate| candidate == "*" || strip_weak(candidate) == etag)
}

fn strip_weak(etag: &str) -> &str {
	let etag = etag.trim();
	etag.strip_prefix("W/").unwrap_or(etag)
}

fn header_str(headers: &HeaderMap, name: header::HeaderName) -> Option<&str> {
	headers.get(name).and_then(|value| value.to_str().ok())
}

/// Strip the body, keeping the headers a 304 is allowed to carry.
///
/// Everything describing the representation we are *not* sending goes (RFC 9110 § 15.4.5); the
/// caching-relevant headers -- `Cache-Control`, `ETag`, `Last-Modified`, and the `Vary` the CORS
/// layer adds further out -- stay, so the client can refresh its stored response.
fn not_modified(response: Response) -> Response {
	let (mut parts, _body) = response.into_parts();

	parts.status = StatusCode::NOT_MODIFIED;
	parts.headers.remove(header::CONTENT_TYPE);
	parts.headers.remove(header::CONTENT_LENGTH);
	parts.headers.remove(header::CONTENT_ENCODING);

	Response::from_parts(parts, Body::empty())
}

#[cfg(test)]
mod tests {
	use super::*;

	fn headers_with_etag(etag: &str) -> HeaderMap {
		let mut headers = HeaderMap::new();
		headers.insert(header::ETAG, HeaderValue::from_str(etag).unwrap());
		headers
	}

	#[test]
	fn matching_etag_is_satisfied() {
		let preconditions = Preconditions {
			if_none_match: Some("\"abc\"".to_string()),
			if_modified_since: None,
		};
		assert!(preconditions.satisfied_by(&headers_with_etag("\"abc\"")));
	}

	#[test]
	fn stale_etag_is_not_satisfied() {
		let preconditions = Preconditions {
			if_none_match: Some("\"stale\"".to_string()),
			if_modified_since: None,
		};
		assert!(!preconditions.satisfied_by(&headers_with_etag("\"fresh\"")));
	}

	#[test]
	fn etag_comparison_is_weak_and_list_aware() {
		let preconditions = Preconditions {
			if_none_match: Some("\"other\", W/\"abc\"".to_string()),
			if_modified_since: None,
		};
		assert!(preconditions.satisfied_by(&headers_with_etag("\"abc\"")));
	}

	#[test]
	fn wildcard_matches_any_etag() {
		let preconditions = Preconditions {
			if_none_match: Some("*".to_string()),
			if_modified_since: None,
		};
		assert!(preconditions.satisfied_by(&headers_with_etag("\"anything\"")));
	}

	#[test]
	fn if_none_match_takes_precedence_over_if_modified_since() {
		let mut headers = headers_with_etag("\"regenerated\"");
		headers.insert(
			header::LAST_MODIFIED,
			HeaderValue::from_static("Sun, 06 Nov 1994 08:49:37 GMT"),
		);

		// The mtime survived a regeneration but the bytes did not: the timestamp says "current",
		// the ETag says otherwise, and the ETag must win.
		let preconditions = Preconditions {
			if_none_match: Some("\"stale\"".to_string()),
			if_modified_since: parse_http_date("Sun, 06 Nov 1994 08:49:37 GMT"),
		};
		assert!(!preconditions.satisfied_by(&headers));
	}

	#[test]
	fn unmodified_since_is_satisfied() {
		let mut headers = headers_with_etag("\"abc\"");
		headers.insert(
			header::LAST_MODIFIED,
			HeaderValue::from_static("Sun, 06 Nov 1994 08:49:37 GMT"),
		);

		let preconditions = Preconditions {
			if_none_match: None,
			if_modified_since: parse_http_date("Mon, 07 Nov 1994 08:49:37 GMT"),
		};
		assert!(preconditions.satisfied_by(&headers));
	}

	#[test]
	fn modified_since_is_not_satisfied() {
		let mut headers = headers_with_etag("\"abc\"");
		headers.insert(
			header::LAST_MODIFIED,
			HeaderValue::from_static("Mon, 07 Nov 1994 08:49:37 GMT"),
		);

		let preconditions = Preconditions {
			if_none_match: None,
			if_modified_since: parse_http_date("Sun, 06 Nov 1994 08:49:37 GMT"),
		};
		assert!(!preconditions.satisfied_by(&headers));
	}

	#[test]
	fn if_modified_since_without_last_modified_is_not_satisfied() {
		let preconditions = Preconditions {
			if_none_match: None,
			if_modified_since: parse_http_date("Sun, 06 Nov 1994 08:49:37 GMT"),
		};
		assert!(!preconditions.satisfied_by(&headers_with_etag("\"abc\"")));
	}
}
