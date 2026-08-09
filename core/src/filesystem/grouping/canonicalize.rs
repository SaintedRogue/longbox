//! Turning a messy series title into a stable grouping key, entirely offline.
//!
//! Two books belong on the same virtual shelf when this module maps them to the same
//! [`GroupKey`]. Everything here is pure string work — no database, no filesystem, no
//! network — so grouping a library is instant and cannot stall on a metadata provider.

use crate::filesystem::organizer::confirm::{normalize_series_key, series_family_key};

/// Vocabulary that marks a title as naming a *collected-edition line* rather than a
/// single work: many volumes published over many years under one banner.
///
/// Longest-first, so `"modern era epic collection"` wins over `"epic collection"` and a
/// title is never truncated at a partial phrase.
const COLLECTION_FORMAT_MARKERS: &[&str] = &[
	"modern era epic collection",
	"complete collection",
	"artist's edition",
	"treasury edition",
	"gallery edition",
	"epic collection",
	"masterworks",
	"compendium",
	"omnibus",
	"box set",
];

/// A grouping key. Two books group together iff their keys are equal.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct GroupKey {
	/// The normalized title the group is built on.
	pub base: String,
	/// Only ever `Some` for issue-shaped books — see [`group_key`] for why.
	pub year: Option<i32>,
}

/// The normalized title plus whether it named a collected-edition line.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CanonicalTitle {
	pub base: String,
	pub is_collection: bool,
}

/// Find where a collection marker ends inside an already-normalized title.
fn marker_end(normalized: &str) -> Option<usize> {
	COLLECTION_FORMAT_MARKERS
		.iter()
		.find_map(|marker| normalized.find(marker).map(|at| at + marker.len()))
}

/// Reduce a raw series title to the key its whole collected line shares.
///
/// When the title names a collected-edition line, everything after the marker is
/// dropped. That is what folds `Fantastic Four Epic Collection`,
/// `Fantastic Four Epic Collection: Annihilus Revealed`, and
/// `Fantastic Four Epic Collection 10: Counter-Earth Must Die` — three spellings of one
/// shelf — onto a single key, whether the subtitle arrives after a colon, after a dash,
/// or after a volume number.
///
/// Otherwise it falls back to [`series_family_key`], which folds edition adjectives
/// (`Noir Edition`, `Deluxe`) into the base title.
pub fn canonicalize_title(raw: &str) -> CanonicalTitle {
	let normalized = normalize_series_key(raw);

	match marker_end(&normalized) {
		Some(end) => CanonicalTitle {
			base: normalized[..end].trim().to_string(),
			is_collection: true,
		},
		None => CanonicalTitle {
			base: series_family_key(&normalized),
			is_collection: false,
		},
	}
}

/// Build the full grouping key for one book.
///
/// **Year is included only for issue-shaped books** — those carrying an issue number and
/// no collected-edition marker. This asymmetry is the single most important rule here,
/// and it exists because `year` means two different things depending on what the book is:
///
/// - On a floppy issue, the year is a *volume designation* — constant across the whole
///   run, and exactly what separates `Batman (2011)` from `Batman (2016)`. Dropping it
///   would merge two genuinely different series.
/// - On a collected edition, the year is the *publication year of that one volume* —
///   `Epic Collection v08` is 2022, `v09` is 2023. Including it shatters a single shelf
///   into one group per volume.
///
/// Measured against a real 139-book library, keying every book on `(title, year)`
/// destroyed four of the six real clusters: `Saga of the Swamp Thing` (years 2009, 2010,
/// 2011) split three ways, and two-book groups whose second book merely lacked a year
/// vanished entirely once singletons were dropped.
///
/// Requiring an issue number — not merely the absence of a marker — is what protects
/// untagged collected runs like `Saga of the Swamp Thing`, which carry no marker word
/// but are still one shelf spanning several years.
pub fn group_key(
	raw_title: &str,
	number: Option<&str>,
	year: Option<i32>,
) -> (GroupKey, bool) {
	let CanonicalTitle {
		base,
		is_collection,
	} = canonicalize_title(raw_title);

	let is_issue_shaped = !is_collection && number.is_some();

	(
		GroupKey {
			base,
			year: is_issue_shaped.then_some(year).flatten(),
		},
		is_collection,
	)
}

/// A human-facing name for a group, derived from one member's raw title.
///
/// Truncates at the collection marker while preserving the original casing, so the shelf
/// reads `Fantastic Four Epic Collection` rather than the lowercased key.
pub fn display_name(raw: &str, is_collection: bool) -> String {
	if !is_collection {
		return raw.trim().to_string();
	}

	let lowered = raw.to_lowercase();
	match marker_end(&lowered) {
		// Byte offsets from the lowercased copy are safe here: `to_lowercase` preserves
		// length for ASCII, and the markers are ASCII, so a match can only land on an
		// ASCII run. Guard with `is_char_boundary` anyway rather than risk a panic on a
		// title where a non-ASCII character shifted the mapping.
		Some(end) if raw.is_char_boundary(end) => raw[..end].trim().to_string(),
		_ => raw.trim().to_string(),
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	fn base_of(raw: &str) -> String {
		canonicalize_title(raw).base
	}

	#[test]
	fn collapses_every_epic_collection_spelling_onto_one_key() {
		let expected = "fantastic four epic collection";

		assert_eq!(base_of("Fantastic Four Epic Collection"), expected);
		assert_eq!(
			base_of("Fantastic Four Epic Collection: Annihilus Revealed"),
			expected
		);
		assert_eq!(
			base_of("Fantastic Four Epic Collection 10: Counter-Earth Must Die"),
			expected
		);
		assert_eq!(
			base_of("Fantastic Four Epic Collection - At War With Atlantis"),
			expected
		);
	}

	#[test]
	fn longest_marker_wins_so_titles_are_not_cut_at_a_partial_phrase() {
		assert_eq!(
			base_of("X-Men Modern Era Epic Collection: The Sentinels"),
			"x-men modern era epic collection"
		);
	}

	#[test]
	fn keeps_distinct_collected_lines_apart() {
		assert_eq!(base_of("Fantastic Four Omnibus"), "fantastic four omnibus");
		assert_eq!(
			base_of("Fantastic Four by Jonathan Hickman Omnibus"),
			"fantastic four by jonathan hickman omnibus"
		);
		assert_ne!(
			base_of("Fantastic Four Omnibus"),
			base_of("Fantastic Four by Jonathan Hickman Omnibus")
		);
	}

	#[test]
	fn non_collection_titles_fall_back_to_the_family_key() {
		assert_eq!(base_of("Absolute Batman Noir Edition"), "absolute batman");
		assert_eq!(base_of("Batman"), "batman");
	}

	#[test]
	fn issue_shaped_books_keep_year_so_batman_2011_and_2016_stay_apart() {
		let (a, _) = group_key("Batman", Some("1"), Some(2011));
		let (b, _) = group_key("Batman", Some("1"), Some(2016));

		assert_ne!(a, b);
		assert_eq!(a.year, Some(2011));
	}

	#[test]
	fn collected_editions_drop_year_so_one_line_stays_one_shelf() {
		// The real failure this rule exists to prevent: same line, different volume
		// publication years.
		let (v08, _) = group_key(
			"Fantastic Four Epic Collection: Annihilus Revealed",
			None,
			Some(2022),
		);
		let (v09, _) = group_key(
			"Fantastic Four Epic Collection: The Crusader Syndrome",
			None,
			Some(2023),
		);

		assert_eq!(v08, v09);
		assert_eq!(v08.year, None);
	}

	#[test]
	fn untagged_collected_runs_without_a_marker_still_stay_together() {
		// `Saga of the Swamp Thing` carries no marker word, spans 2009-2011, and has no
		// issue numbers. Requiring a number -- not just the absence of a marker -- is
		// what keeps these four books on one shelf.
		let (a, _) = group_key("Saga of the Swamp Thing", None, Some(2009));
		let (b, _) = group_key("Saga of the Swamp Thing", None, Some(2010));
		let (c, _) = group_key("Saga of the Swamp Thing", None, Some(2011));

		assert_eq!(a, b);
		assert_eq!(b, c);
		assert_eq!(a.year, None);
	}

	#[test]
	fn a_missing_year_does_not_split_a_pair() {
		// Two books, one tagged with a year and one not, must not become two singletons
		// and then vanish under the minimum-group-size rule.
		let (tagged, _) = group_key(
			"Fantastic Four by Jonathan Hickman Omnibus",
			None,
			Some(2022),
		);
		let (untagged, _) =
			group_key("Fantastic Four by Jonathan Hickman Omnibus", None, None);

		assert_eq!(tagged, untagged);
	}

	#[test]
	fn display_name_preserves_casing_and_drops_the_subtitle() {
		assert_eq!(
			display_name("Fantastic Four Epic Collection: Annihilus Revealed", true),
			"Fantastic Four Epic Collection"
		);
		assert_eq!(
			display_name("The Complete Maus", false),
			"The Complete Maus"
		);
	}
}
