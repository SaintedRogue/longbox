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
	/// Whether the name carried a volume marker (`v01`, `Vol. 3`, `Volume 1`).
	///
	/// Reported because it distinguishes a *collected volume* from a *floppy issue*, and
	/// nothing else does. `number` cannot: a collected edition's volume number lands in
	/// the same field an issue number would. Callers grouping books need that difference
	/// — for an issue run the year is a volume designation constant across the run, but
	/// for a collected edition it is the publication year of one volume and varies.
	pub has_volume_token: bool,
	/// Whether the name carried a chapter marker (`ch. 1044`, `Chapter 364`,
	/// `ch077`) — the manga counterpart to `has_volume_token`. When set, `number`
	/// is a chapter number, not an issue number.
	pub has_chapter_token: bool,
}

/// Parse a comic filename stem into a best-effort `{series, number, year}`.
///
/// Strategy: strip every bracketed group (`(...)`/`[...]` — years, scanner tags,
/// "digital", release-group names), capturing the first year seen; then treat a
/// trailing number-like token as the issue number and everything before it as the
/// series.
pub fn parse_comic_filename(name: &str) -> ParsedComicName {
	let (stripped, year) = strip_bracketed_groups(name);
	let trimmed = stripped.trim();
	let devolumed = strip_volume_tokens(trimmed);
	// A token count that dropped means strip_volume_tokens removed a volume marker.
	let has_volume_token =
		devolumed.split_whitespace().count() != trimmed.split_whitespace().count();
	let (dechaptered, has_chapter_token) = strip_chapter_tokens(&devolumed);
	let (series, number) = split_series_and_number(dechaptered.trim());
	ParsedComicName {
		series: series.filter(|s| !s.is_empty()),
		number,
		year,
		has_volume_token,
		has_chapter_token,
	}
}

/// Fold chapter markers out of a bracket-stripped name, leaving the chapter
/// number in place as a bare token so the trailing-number split still finds it:
/// `"One Piece ch. 1044"` → `"One Piece 1044"`, `"Kagurabachi ch077"` →
/// `"Kagurabachi 077"`. A marker word without digits (`"The Final Chapter"`) is
/// title text and is kept. Returns the cleaned name and whether any marker was
/// folded.
fn strip_chapter_tokens(s: &str) -> (String, bool) {
	const MARKERS: [&str; 5] = ["chapter", "chap.", "chap", "ch.", "ch"];

	let toks: Vec<&str> = s.split_whitespace().collect();
	let mut out: Vec<&str> = Vec::with_capacity(toks.len());
	let mut folded = false;
	let mut i = 0;
	while i < toks.len() {
		let tl = toks[i].to_ascii_lowercase();
		// Standalone marker followed by digits: drop the marker, keep the number.
		if MARKERS.contains(&tl.as_str())
			&& i + 1 < toks.len()
			&& !toks[i + 1].is_empty()
			&& toks[i + 1].bytes().all(|b| b.is_ascii_digit())
		{
			out.push(toks[i + 1]);
			folded = true;
			i += 2;
			continue;
		}
		// Glued forms: ch077, chapter12. A bare `c###` is deliberately NOT a
		// chapter marker — too many titles contain c-prefixed codes.
		if let Some(rest) = MARKERS
			.iter()
			.find_map(|m| tl.strip_prefix(m))
			.filter(|rest| !rest.is_empty() && rest.bytes().all(|b| b.is_ascii_digit()))
		{
			// Push the digit slice out of the original token to keep lifetimes
			// simple: the digits sit at the token's tail.
			out.push(&toks[i][toks[i].len() - rest.len()..]);
			folded = true;
			i += 1;
			continue;
		}
		out.push(toks[i]);
		i += 1;
	}
	(out.join(" "), folded)
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
		// "vol" / "vol." / "volume" as a standalone marker followed by a volume
		// number (e.g. `Vol. 3`). Without a plausible number the word is treated
		// as part of the title, not a marker.
		if matches!(tl.as_str(), "vol" | "vol." | "volume")
			&& i + 1 < toks.len()
			&& is_volume_digits(toks[i + 1])
		{
			i += 2;
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

/// A plausible volume number: 1–3 digits. Four digits is a year (`v2024`), not
/// a volume — no real run reaches volume 1000.
fn is_volume_digits(t: &str) -> bool {
	(1..=3).contains(&t.len()) && t.bytes().all(|b| b.is_ascii_digit())
}

/// Whether a single lowercased token is an inline volume marker (`v01`, `vol.03`, …).
/// A bare `v` (as in `V for Vendetta`) is not a volume marker.
fn is_volume_token(t: &str) -> bool {
	for prefix in ["volume", "vol.", "vol", "v"] {
		if let Some(rest) = t.strip_prefix(prefix) {
			if is_volume_digits(rest) {
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
					year = parse_group_year(group.trim());
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

/// A bracketed group's year: a bare 4-digit year (`(2024)`) or the first year of
/// a range (`(1994-1996)`), both bounded to 1900–2099.
fn parse_group_year(group: &str) -> Option<i32> {
	let candidate = match group.split_once('-') {
		Some((start, end))
			if start.len() == 4
				&& end.len() == 4
				&& start.bytes().all(|b| b.is_ascii_digit())
				&& end.bytes().all(|b| b.is_ascii_digit()) =>
		{
			start
		},
		None if group.len() == 4 && group.bytes().all(|b| b.is_ascii_digit()) => group,
		_ => return None,
	};
	candidate
		.parse::<i32>()
		.ok()
		.filter(|y| (1900..=2099).contains(y))
}

/// Split a bracket-stripped name into `(series, number)`, treating a trailing
/// number-like token as the issue number. An unbracketed cross-reference tail —
/// `"Kingdom Come 3 of 4"` — yields the FIRST number (the issue), never the
/// count.
fn split_series_and_number(s: &str) -> (Option<String>, Option<String>) {
	let tokens: Vec<&str> = s.split_whitespace().collect();
	let Some((last, head)) = tokens.split_last() else {
		return (None, None);
	};

	// Trailing "<issue> of <count>" (both number-like): the issue is the first.
	if tokens.len() >= 3 && tokens[tokens.len() - 2].eq_ignore_ascii_case("of") {
		if let (Some(issue), Some(_count)) = (
			parse_issue_number(tokens[tokens.len() - 3]),
			parse_issue_number(last),
		) {
			let series = tokens[..tokens.len() - 3]
				.join(" ")
				.trim_end_matches(['-', '#', ' '])
				.trim()
				.to_string();
			return (Some(series), Some(issue));
		}
	}

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

/// Parse an issue-number token — `"001"`, `"12"`, `"#1"`, `"1.MU"`, `"1.5"`,
/// `"-1"` (negative issues: Zero Hour, the New 52 #-1 events) — returning a
/// normalized string (leading zeros dropped: `"001"` → `"1"`, `"-01"` → `"-1"`),
/// or `None` if the token isn't number-like.
fn parse_issue_number(token: &str) -> Option<String> {
	let t = token.trim_start_matches('#');
	if t.is_empty() {
		return None;
	}

	// Negative issue: '-' + digits. Normalized like the positive form.
	if let Some(rest) = t.strip_prefix('-') {
		if !rest.is_empty() && rest.bytes().all(|b| b.is_ascii_digit()) {
			return rest.parse::<u64>().ok().map(|n| format!("-{n}"));
		}
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
			has_volume_token: false,
			has_chapter_token: false,
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
				has_volume_token: false,
				has_chapter_token: false,
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
				has_volume_token: false,
				has_chapter_token: false,
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
				has_volume_token: false,
				has_chapter_token: false,
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
	fn negative_issue_numbers_parse() {
		let p = parse_comic_filename("Zero Hour #-1 (1994)");
		assert_eq!(p.series.as_deref(), Some("Zero Hour"));
		assert_eq!(p.number.as_deref(), Some("-1"));

		let p = parse_comic_filename("Adventures of Superman -01 (1994)");
		assert_eq!(p.series.as_deref(), Some("Adventures of Superman"));
		assert_eq!(p.number.as_deref(), Some("-1"));

		// A spaced hyphen is still a separator, not a sign.
		let p = parse_comic_filename("Batman - 1");
		assert_eq!(p.series.as_deref(), Some("Batman"));
		assert_eq!(p.number.as_deref(), Some("1"));
	}

	#[test]
	fn n_of_m_tails_yield_the_issue_not_the_count() {
		let p = parse_comic_filename("Kingdom Come 3 of 4 (1996)");
		assert_eq!(p.series.as_deref(), Some("Kingdom Come"));
		assert_eq!(p.number.as_deref(), Some("3"));
		assert_eq!(p.year, Some(1996));

		// "of" between non-numbers is just a title word.
		let p = parse_comic_filename("Tales of Suspense 039 (1963)");
		assert_eq!(p.series.as_deref(), Some("Tales of Suspense"));
		assert_eq!(p.number.as_deref(), Some("39"));
	}

	#[test]
	fn chapter_markers_yield_chapter_numbers() {
		let p = parse_comic_filename("One Piece ch. 1044");
		assert_eq!(p.series.as_deref(), Some("One Piece"));
		assert_eq!(p.number.as_deref(), Some("1044"));
		assert!(p.has_chapter_token);

		let p = parse_comic_filename("Berserk Chapter 364 (2021)");
		assert_eq!(p.series.as_deref(), Some("Berserk"));
		assert_eq!(p.number.as_deref(), Some("364"));
		assert_eq!(p.year, Some(2021));
		assert!(p.has_chapter_token);

		// Glued form.
		let p = parse_comic_filename("Kagurabachi ch077");
		assert_eq!(p.series.as_deref(), Some("Kagurabachi"));
		assert_eq!(p.number.as_deref(), Some("77"));
		assert!(p.has_chapter_token);
	}

	#[test]
	fn plain_numbers_and_title_words_are_not_chapters() {
		let p = parse_comic_filename("Chainsaw Man 097 (2021)");
		assert_eq!(p.number.as_deref(), Some("97"));
		assert!(!p.has_chapter_token);

		// A marker word with no digits is title text.
		let p = parse_comic_filename("The Final Chapter 003");
		assert_eq!(p.series.as_deref(), Some("The Final"));
		assert_eq!(p.number.as_deref(), Some("3"));
		assert!(p.has_chapter_token, "Chapter 003 IS a chapter marker pair");

		let p = parse_comic_filename("Spawn Chapter One");
		assert_eq!(p.series.as_deref(), Some("Spawn Chapter One"));
		assert!(!p.has_chapter_token);
	}

	#[test]
	fn year_ranges_yield_the_first_year() {
		assert_eq!(
			parse_comic_filename("The X-Files (1994-1996) 003"),
			ParsedComicName {
				series: Some("The X-Files".into()),
				number: Some("3".into()),
				year: Some(1994),
				has_volume_token: false,
				has_chapter_token: false,
			}
		);
		// A plain year still wins when it comes first.
		assert_eq!(
			parse_comic_filename("Saga 001 (2012) (1994-1996 reprint)").year,
			Some(2012)
		);
	}

	#[test]
	fn four_digit_volume_tokens_are_not_volumes() {
		// v2024 is a year tag, not volume 2024 — the digit cap is 3.
		let p = parse_comic_filename("Gold Digger v2024 001 (2024)");
		assert!(!p.has_volume_token);
		assert_eq!(p.series.as_deref(), Some("Gold Digger v2024"));
		// The cap applies to the standalone form too.
		let p = parse_comic_filename("Saga Volume 2024 001");
		assert_eq!(p.series.as_deref(), Some("Saga Volume 2024"));
		// Three digits is still a volume.
		assert!(parse_comic_filename("King Spawn v001 (2022)").has_volume_token);
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
