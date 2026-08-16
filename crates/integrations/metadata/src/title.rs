//! Display-title composition for comic issues.
//!
//! Comic providers (ComicVine, Metron) expose an issue's *story* title (often
//! empty for single issues) plus a structured series name and issue number. The
//! name users actually want to see is the audiobookshelf-style label
//! `"{Series} #{number}"` — e.g. `"Absolute Batman #1"` — composed from that
//! structured metadata rather than the raw filename. This is the single source of
//! that format; the core apply layer calls it when a comic provider match is
//! applied.

/// Split a library series name into the title a provider would recognise and the start
/// year embedded in it: `"Absolute Green Lantern (2025)"` → `("Absolute Green Lantern",
/// Some(2025))`, and `"Absolute Carnage (Marvel, 2020)"` → `("Absolute Carnage",
/// Some(2020))`.
///
/// Scanned libraries name series after their folder, and those folders conventionally
/// carry a disambiguating `(year)` or `(publisher, year)` suffix. Searching a provider for
/// the raw name is doubly self-defeating: the suffix stops the exact-title comparison from
/// firing *and* the year that would have corroborated the match is thrown away, which is
/// exactly the pair of signals the scorer needs to clear its auto-apply threshold.
///
/// Returns the name unchanged with `None` when there is no such suffix, so a series named
/// without one is left alone.
pub fn split_series_name_year(name: &str) -> (&str, Option<i32>) {
	let trimmed = name.trim();
	let Some(open) = trimmed.rfind('(') else {
		return (trimmed, None);
	};
	if !trimmed.ends_with(')') {
		return (trimmed, None);
	}

	let inside = &trimmed[open + 1..trimmed.len() - 1];
	// The year is the last comma-separated part, so `(Marvel, 2020)` and `(2020)` are the
	// same shape with and without a leading publisher.
	let year_part = inside.rsplit(',').next().unwrap_or(inside).trim();

	let Ok(year) = year_part.parse::<i32>() else {
		return (trimmed, None);
	};
	// Four digits in a plausible range: `(2)` is a volume marker, not a year.
	if year_part.len() != 4 || !(1900..=2999).contains(&year) {
		return (trimmed, None);
	}

	let title = trimmed[..open].trim();
	// A name that is *only* a year has no title left to search with.
	if title.is_empty() {
		return (trimmed, None);
	}

	(title, Some(year))
}

/// Compose a clean comic display title of the form `"{Series} #{number}"`.
///
/// Returns `None` when either the series name or the issue number is missing or
/// blank — the caller should then fall back to the provider's story title (or,
/// ultimately, the filename-derived `media.name`). The raw, unparsed issue number
/// is used verbatim so non-integer numbers ("1.MU", "½") are preserved.
pub fn compose_comic_title(
	series_name: &str,
	number_raw: Option<&str>,
) -> Option<String> {
	let series = series_name.trim();
	if series.is_empty() {
		return None;
	}
	let number = number_raw.map(str::trim).filter(|n| !n.is_empty())?;
	Some(format!("{series} #{number}"))
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn composes_series_and_number() {
		assert_eq!(
			compose_comic_title("Absolute Batman", Some("1")),
			Some("Absolute Batman #1".to_string())
		);
	}

	#[test]
	fn preserves_non_integer_issue_numbers() {
		assert_eq!(
			compose_comic_title("Deadpool", Some("1.MU")),
			Some("Deadpool #1.MU".to_string())
		);
	}

	#[test]
	fn splits_a_bare_year_suffix() {
		assert_eq!(
			split_series_name_year("Absolute Green Lantern (2025)"),
			("Absolute Green Lantern", Some(2025))
		);
	}

	#[test]
	fn splits_a_publisher_and_year_suffix() {
		assert_eq!(
			split_series_name_year("Absolute Carnage (Marvel, 2020)"),
			("Absolute Carnage", Some(2020))
		);
	}

	/// A series named without a suffix must be searched exactly as it stands.
	#[test]
	fn leaves_a_name_without_a_suffix_alone() {
		assert_eq!(
			split_series_name_year("Absolute Green Arrow"),
			("Absolute Green Arrow", None)
		);
	}

	/// Parentheses that are part of the title, or hold something that is not a year, are
	/// not a suffix — stripping them would search for the wrong thing.
	#[test]
	fn ignores_parentheses_that_do_not_hold_a_year() {
		for name in [
			"Giant-Size X-Men (Vol. 2)",
			"Hellboy (Omnibus)",
			"Some Series (12)",
			"Weird (99999)",
		] {
			assert_eq!(split_series_name_year(name), (name, None), "{name}");
		}
	}

	/// The year alone leaves nothing to search with, so the name is kept whole.
	#[test]
	fn keeps_a_name_that_is_only_a_year() {
		assert_eq!(split_series_name_year("(2025)"), ("(2025)", None));
	}

	#[test]
	fn trims_surrounding_whitespace() {
		assert_eq!(
			split_series_name_year("  Saga (2012)  "),
			("Saga", Some(2012))
		);
	}

	#[test]
	fn trims_whitespace() {
		assert_eq!(
			compose_comic_title("  Saga  ", Some(" 12 ")),
			Some("Saga #12".to_string())
		);
	}

	#[test]
	fn none_without_number() {
		assert_eq!(compose_comic_title("Absolute Batman", None), None);
		assert_eq!(compose_comic_title("Absolute Batman", Some("  ")), None);
	}

	#[test]
	fn none_without_series() {
		assert_eq!(compose_comic_title("   ", Some("1")), None);
	}
}
