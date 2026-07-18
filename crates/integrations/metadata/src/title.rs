//! Display-title composition for comic issues.
//!
//! Comic providers (ComicVine, Metron) expose an issue's *story* title (often
//! empty for single issues) plus a structured series name and issue number. The
//! name users actually want to see is the audiobookshelf-style label
//! `"{Series} #{number}"` — e.g. `"Absolute Batman #1"` — composed from that
//! structured metadata rather than the raw filename. This is the single source of
//! that format; the core apply layer calls it when a comic provider match is
//! applied.

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
