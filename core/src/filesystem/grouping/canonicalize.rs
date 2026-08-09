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
			base: trim_dangling_volume_word(&series_family_key(&normalized)),
			is_collection: false,
		},
	}
}

/// Drop a trailing bare `book`/`vol`/`volume` left behind when the number that followed
/// it was parsed off as an issue number.
///
/// `The Complete Fantastic Four by Jonathan Hickman Book 1` loses its `1` to the issue
/// parser and would otherwise name a shelf `… Hickman Book`. A title genuinely ending in
/// a bare "book" is vanishingly rare; a dangling one is a parse artifact.
fn trim_dangling_volume_word(key: &str) -> String {
	let trimmed = key.trim_end_matches([' ', '-']).to_string();
	for word in ["book", "vol", "volume"] {
		if let Some(rest) = trimmed.strip_suffix(word) {
			// Only when it stands alone as the final word, not as part of one
			// ("Sandbook", "Notebook").
			if rest.is_empty() || rest.ends_with([' ', '-']) {
				return rest.trim_end_matches([' ', '-']).trim().to_string();
			}
		}
	}
	trimmed
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
/// untagged collected runs that carry no marker word but are still one shelf spanning
/// several years.
///
/// An issue number alone is not sufficient either, which production proved:
/// `Saga of the Swamp Thing v01..v04` carry numbers 1–4, because a collected edition's
/// *volume* number lands in the same field an issue number would. All four looked
/// issue-shaped, year entered the key, and the run split 2/1/1 with the two singletons
/// dropped. `has_volume_token` is the signal that separates them — a `v01` in the
/// filename means collected volume, never floppy issue.
pub fn group_key(
	raw_title: &str,
	number: Option<&str>,
	year: Option<i32>,
	has_volume_token: bool,
) -> (GroupKey, bool) {
	let CanonicalTitle {
		base,
		is_collection,
	} = canonicalize_title(raw_title);

	let is_issue_shaped = !is_collection && !has_volume_token && number.is_some();

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
		// Mirrors the key: a shelf should not be named "... Hickman Book".
		let trimmed = raw.trim();
		let without = trim_dangling_volume_word(&trimmed.to_lowercase());
		return trimmed
			.get(..without.len())
			.map(|s| s.trim().to_string())
			.unwrap_or_else(|| trimmed.to_string());
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
		let (a, _) = group_key("Batman", Some("1"), Some(2011), false);
		let (b, _) = group_key("Batman", Some("1"), Some(2016), false);

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
			false,
		);
		let (v09, _) = group_key(
			"Fantastic Four Epic Collection: The Crusader Syndrome",
			None,
			Some(2023),
			false,
		);

		assert_eq!(v08, v09);
		assert_eq!(v08.year, None);
	}

	#[test]
	fn untagged_collected_runs_without_a_marker_still_stay_together() {
		// `Saga of the Swamp Thing` carries no marker word and spans 2009-2011.
		let (a, _) = group_key("Saga of the Swamp Thing", None, Some(2009), false);
		let (b, _) = group_key("Saga of the Swamp Thing", None, Some(2010), false);
		let (c, _) = group_key("Saga of the Swamp Thing", None, Some(2011), false);

		assert_eq!(a, b);
		assert_eq!(b, c);
		assert_eq!(a.year, None);
	}

	#[test]
	fn numbered_volumes_of_one_run_stay_together_across_years() {
		// Production regression. These four are `Saga of the Swamp Thing v01..v04`, and
		// they defeated the earlier "has a number => it's an issue" rule: a collected
		// edition's *volume* number lands in the same field an issue number would, so all
		// four looked issue-shaped, year entered the key, and the run split 2/1/1 with the
		// singletons dropped. The `v01` token in the filename is what tells them apart.
		let keys: Vec<_> = [(1, 2009), (2, 2009), (3, 2010), (4, 2011)]
			.iter()
			.map(|(n, y)| {
				group_key(
					"Saga of the Swamp Thing",
					Some(&n.to_string()),
					Some(*y),
					true, // v01..v04
				)
				.0
			})
			.collect();

		assert!(
			keys.windows(2).all(|w| w[0] == w[1]),
			"all four volumes must share one key, got {keys:?}"
		);
		assert_eq!(keys[0].year, None);
	}

	#[test]
	fn a_volume_token_never_makes_a_book_issue_shaped() {
		// Guards the inverse: a real issue run keeps its year and stays split.
		let (collected, _) = group_key("Batman", Some("1"), Some(2011), true);
		let (issue, _) = group_key("Batman", Some("1"), Some(2011), false);

		assert_eq!(collected.year, None);
		assert_eq!(issue.year, Some(2011));
	}

	#[test]
	fn a_missing_year_does_not_split_a_pair() {
		// Two books, one tagged with a year and one not, must not become two singletons
		// and then vanish under the minimum-group-size rule.
		let (tagged, _) = group_key(
			"Fantastic Four by Jonathan Hickman Omnibus",
			None,
			Some(2022),
			false,
		);
		let (untagged, _) = group_key(
			"Fantastic Four by Jonathan Hickman Omnibus",
			None,
			None,
			false,
		);

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
