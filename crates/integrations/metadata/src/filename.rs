//! Best-effort parsing of a comic issue's series, number, and year from a raw
//! filename stem — e.g. `"Absolute Batman 001 (2024) (digital) (Son of Ultron-Empire)"`.
//!
//! Filename-only libraries (no embedded `ComicInfo.xml`) leave `media_metadata`
//! empty, so without this the metadata providers receive the entire messy filename
//! as the series/search term and match nothing. This feeds the provider
//! [`SearchQuery`](crate::SearchQuery) a usable series + number instead. It is the
//! input-side counterpart to [`compose_comic_title`](crate::compose_comic_title)
//! (which builds a display title from an already-matched series + number).
//!
//! This is heuristic, not authoritative — the parsed values are used only to build
//! a better search query and are never written back into `media_metadata` as facts.

/// The fields we can heuristically pull out of a comic filename.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct ParsedComicName {
	/// The series name, with trailing issue number and bracketed cruft removed.
	pub series: Option<String>,
	/// The issue number as a normalized string ("001" → "1", "1.MU" preserved).
	pub number: Option<String>,
	/// A 4-digit release year found in a bracketed group (1900–2099).
	pub year: Option<i32>,
}

/// Parse a comic filename stem into a best-effort `{series, number, year}`.
///
/// Strategy: strip every bracketed group (`(...)`/`[...]` — years, scanner tags,
/// "digital", release-group names), capturing the first year seen; then treat a
/// trailing number-like token as the issue number and everything before it as the
/// series.
pub fn parse_comic_filename(name: &str) -> ParsedComicName {
	let (stripped, year) = strip_bracketed_groups(name);
	let devolumed = strip_volume_tokens(stripped.trim());
	let (series, number) = split_series_and_number(devolumed.trim());
	ParsedComicName {
		series: series.filter(|s| !s.is_empty()),
		number,
		year,
	}
}

/// Remove volume markers (`v01`, `v1`, `vol 1`, `vol. 1`, `volume 1`, `vol01`) from a
/// bracket-stripped name. Volume is a separate axis from the series title, so folding
/// it out keeps multi-volume folders (`King Spawn v01/v02/v03`) from looking like
/// distinct series and gives providers a cleaner search term.
fn strip_volume_tokens(s: &str) -> String {
	let toks: Vec<&str> = s.split_whitespace().collect();
	let mut out: Vec<&str> = Vec::with_capacity(toks.len());
	let mut i = 0;
	while i < toks.len() {
		let tl = toks[i].to_ascii_lowercase();
		// "vol" / "vol." / "volume" as a standalone marker, optionally followed by a
		// bare number token (e.g. `Vol. 3`).
		if matches!(tl.as_str(), "vol" | "vol." | "volume") {
			if i + 1 < toks.len() && toks[i + 1].bytes().all(|b| b.is_ascii_digit()) {
				i += 2;
			} else {
				i += 1;
			}
			continue;
		}
		// Inline forms: v01, v1, vol01, vol.01, volume01.
		if is_volume_token(&tl) {
			i += 1;
			continue;
		}
		out.push(toks[i]);
		i += 1;
	}
	out.join(" ")
}

/// Whether a single lowercased token is an inline volume marker (`v01`, `vol.03`, …).
/// A bare `v` (as in `V for Vendetta`) is not a volume marker.
fn is_volume_token(t: &str) -> bool {
	for prefix in ["volume", "vol.", "vol", "v"] {
		if let Some(rest) = t.strip_prefix(prefix) {
			if !rest.is_empty() && rest.bytes().all(|b| b.is_ascii_digit()) {
				return true;
			}
		}
	}
	false
}

/// Remove all top-level `(...)` and `[...]` groups from `name`, returning the
/// cleaned remainder and the first 4-digit year (1900–2099) found inside a group.
fn strip_bracketed_groups(name: &str) -> (String, Option<i32>) {
	let mut out = String::with_capacity(name.len());
	let mut group = String::new();
	let mut year: Option<i32> = None;
	let mut depth: i32 = 0;

	for ch in name.chars() {
		match ch {
			'(' | '[' => {
				if depth == 0 {
					group.clear();
				}
				depth += 1;
			},
			')' | ']' => {
				depth = (depth - 1).max(0);
				if depth == 0 && year.is_none() {
					let g = group.trim();
					if g.len() == 4 && g.bytes().all(|b| b.is_ascii_digit()) {
						if let Ok(y) = g.parse::<i32>() {
							if (1900..=2099).contains(&y) {
								year = Some(y);
							}
						}
					}
				}
			},
			_ => {
				if depth == 0 {
					out.push(ch);
				} else {
					group.push(ch);
				}
			},
		}
	}

	(out, year)
}

/// Split a bracket-stripped name into `(series, number)`, treating a trailing
/// number-like token as the issue number.
fn split_series_and_number(s: &str) -> (Option<String>, Option<String>) {
	let tokens: Vec<&str> = s.split_whitespace().collect();
	let Some((last, head)) = tokens.split_last() else {
		return (None, None);
	};

	if let Some(number) = parse_issue_number(last) {
		let series = head
			.join(" ")
			.trim_end_matches(['-', '#', ' '])
			.trim()
			.to_string();
		(Some(series), Some(number))
	} else {
		(Some(tokens.join(" ")), None)
	}
}

/// Parse an issue-number token — `"001"`, `"12"`, `"#1"`, `"1.MU"`, `"1.5"` —
/// returning a normalized string (leading zeros dropped: `"001"` → `"1"`), or
/// `None` if the token isn't number-like.
fn parse_issue_number(token: &str) -> Option<String> {
	let t = token.trim_start_matches('#');
	if t.is_empty() {
		return None;
	}

	// Pure integer (possibly zero-padded): normalize away leading zeros.
	if t.bytes().all(|b| b.is_ascii_digit()) {
		return t.parse::<u64>().ok().map(|n| n.to_string());
	}

	// Decimal ("1.5") or comic special ("1.MU"): normalize the integer part only.
	if let Some((int_part, rest)) = t.split_once('.') {
		if !int_part.is_empty()
			&& !rest.is_empty()
			&& int_part.bytes().all(|b| b.is_ascii_digit())
		{
			if let Ok(n) = int_part.parse::<u64>() {
				return Some(format!("{n}.{rest}"));
			}
		}
	}

	None
}

#[cfg(test)]
mod tests {
	use super::*;

	fn parsed(series: &str, number: &str, year: i32) -> ParsedComicName {
		ParsedComicName {
			series: Some(series.to_string()),
			number: Some(number.to_string()),
			year: Some(year),
		}
	}

	#[test]
	fn parses_real_filenames() {
		assert_eq!(
			parse_comic_filename(
				"Absolute Batman 001 (2024) (digital) (Son of Ultron-Empire)"
			),
			parsed("Absolute Batman", "1", 2024)
		);
		assert_eq!(
			parse_comic_filename(
				"Absolute Batman - Ark M 001 (2026) (Digital) (Shan-Empire)"
			),
			parsed("Absolute Batman - Ark M", "1", 2026)
		);
		assert_eq!(
			parse_comic_filename(
				"Absolute Batman 002 (2025) (digital-mobile) (Son of Ultron-Empire)"
			),
			parsed("Absolute Batman", "2", 2025)
		);
	}

	#[test]
	fn handles_hash_and_no_year() {
		assert_eq!(
			parse_comic_filename("Batman #12"),
			ParsedComicName {
				series: Some("Batman".into()),
				number: Some("12".into()),
				year: None,
			}
		);
	}

	#[test]
	fn preserves_special_issue_numbers() {
		assert_eq!(
			parse_comic_filename("Deadpool 1.MU (2016)"),
			parsed("Deadpool", "1.MU", 2016)
		);
	}

	#[test]
	fn keeps_leading_numbers_in_series() {
		// The trailing token is the issue number; "100" stays in the series.
		assert_eq!(
			parse_comic_filename("100 Bullets 042 (2003)"),
			parsed("100 Bullets", "42", 2003)
		);
	}

	#[test]
	fn no_number_yields_series_only() {
		assert_eq!(
			parse_comic_filename("Some One-Shot (2020)"),
			ParsedComicName {
				series: Some("Some One-Shot".into()),
				number: None,
				year: Some(2020),
			}
		);
	}

	#[test]
	fn empty_or_junk_is_none() {
		assert_eq!(parse_comic_filename(""), ParsedComicName::default());
		assert_eq!(
			parse_comic_filename("(2024) (digital)"),
			ParsedComicName {
				series: None,
				number: None,
				year: Some(2024),
			}
		);
	}

	#[test]
	fn strips_volume_markers_from_series() {
		let cases = [
			("King Spawn v01 (2022)", "King Spawn"),
			("King Spawn v02 (2023)", "King Spawn"),
			("Saga Vol. 3 (2014)", "Saga"),
			("Y The Last Man Volume 1 (2003)", "Y The Last Man"),
			(
				"Batman by Grant Morrison Omnibus v01 (2018)",
				"Batman by Grant Morrison Omnibus",
			),
		];
		for (input, expected) in cases {
			assert_eq!(
				parse_comic_filename(input).series.as_deref(),
				Some(expected),
				"input: {input}"
			);
		}
	}

	#[test]
	fn keeps_volume_and_issue_number_together() {
		let p = parse_comic_filename("King Spawn v01 005 (2022)");
		assert_eq!(p.series.as_deref(), Some("King Spawn"));
		assert_eq!(p.number.as_deref(), Some("5"));
	}

	#[test]
	fn a_bare_v_is_not_a_volume_marker() {
		assert_eq!(
			parse_comic_filename("V for Vendetta 001 (2005)")
				.series
				.as_deref(),
			Some("V for Vendetta")
		);
	}
}
