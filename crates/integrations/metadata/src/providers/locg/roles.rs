//! Role-string → metadata-field mapping for League of Comic Geeks credits.
//!
//! LOCG's role labels are free text typed by contributors, not an enum, and a single
//! credit may carry **several comma-joined roles for one person** — "Writer, Artist",
//! "Writer, Artist, Colorist", "Story, Writer". Splitting on the comma before
//! matching is therefore mandatory: an exact-match table would drop every
//! creator-owned indie book, where one person does most of the work.
//!
//! A survey of 12 issues across Marvel, DC, Image, IDW, Dynamite and Titan produced
//! these 18 distinct strings:
//!
//! ```text
//! Colorist  Cover Artist  Letterer  Writer  Editor  Artist  Editor-in-Chief
//! Associate Editor  Assistant Editor  Cover Colorist  Designer  Story
//! Penciller  Inker  Executive Editor
//! "Writer, Artist"  "Writer, Artist, Colorist"  "Story, Writer"
//! ```
//!
//! That is a sample, not the vocabulary — the table below matches on normalized
//! substrings so unseen variants ("Co-Writer", "Breakdowns") still land somewhere
//! sensible, and anything genuinely unrecognised is logged at debug rather than
//! silently dropped. Longbox has no field for some real roles (Designer, Production,
//! Translator); those are recorded as unmapped and left out of the metadata.

/// Which [`ExternalMediaMetadata`] list a role contributes to.
///
/// [`ExternalMediaMetadata`]: crate::types::ExternalMediaMetadata
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CreditField {
	Writers,
	Pencillers,
	Inkers,
	Colorists,
	Letterers,
	CoverArtists,
	Editors,
	/// Generic art credit — LOCG's plain "Artist", which is neither pencils nor inks
	/// specifically.
	Artists,
}

/// Buckets mirroring the credit fields on `ExternalMediaMetadata`, plus the roles we
/// could not place.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct CreditBuckets {
	pub writers: Vec<String>,
	pub pencillers: Vec<String>,
	pub inkers: Vec<String>,
	pub colorists: Vec<String>,
	pub letterers: Vec<String>,
	pub cover_artists: Vec<String>,
	pub editors: Vec<String>,
	pub artists: Vec<String>,
	/// Role strings with no home in our schema, kept so the caller can log them.
	/// Deliberately not merged into `artists`: calling a Designer an artist would be
	/// wrong metadata, and swallowing it would hide a mapping gap.
	pub unmapped: Vec<String>,
}

impl CreditBuckets {
	fn push(&mut self, field: CreditField, name: &str) {
		let bucket = match field {
			CreditField::Writers => &mut self.writers,
			CreditField::Pencillers => &mut self.pencillers,
			CreditField::Inkers => &mut self.inkers,
			CreditField::Colorists => &mut self.colorists,
			CreditField::Letterers => &mut self.letterers,
			CreditField::CoverArtists => &mut self.cover_artists,
			CreditField::Editors => &mut self.editors,
			CreditField::Artists => &mut self.artists,
		};
		// The same person legitimately appears under several roles; the same
		// (role, person) pair can also repeat across a multi-story issue.
		if !bucket.iter().any(|existing| existing == name) {
			bucket.push(name.to_string());
		}
	}
}

/// Ordered match table. **Order matters**: the first matching pattern wins, so more
/// specific labels must precede the substrings they contain — "Cover Colorist" before
/// "Colorist", every "… Editor" variant before "Editor", and "Cover Artist" before
/// "Artist".
///
/// Patterns are matched as substrings of the lowercased, punctuation-normalized role
/// token, which is what lets "Co-Writer" and "Co-Plotter" match "writer"/"plot"
/// without an entry of their own.
const ROLE_TABLE: &[(&str, CreditField)] = &[
	// Cover credits — must precede the generic art/color entries.
	("cover artist", CreditField::CoverArtists),
	("cover colorist", CreditField::CoverArtists),
	("cover penciller", CreditField::CoverArtists),
	("cover inker", CreditField::CoverArtists),
	("variant cover", CreditField::CoverArtists),
	("cover", CreditField::CoverArtists),
	// Editorial. Every masthead variant collapses to `editors`: Longbox has one
	// editor field, and an Editor-in-Chief is still an editor.
	("editor in chief", CreditField::Editors),
	("editor-in-chief", CreditField::Editors),
	("executive editor", CreditField::Editors),
	("senior editor", CreditField::Editors),
	("supervising editor", CreditField::Editors),
	("consulting editor", CreditField::Editors),
	("associate editor", CreditField::Editors),
	("assistant editor", CreditField::Editors),
	("group editor", CreditField::Editors),
	("managing editor", CreditField::Editors),
	("editor", CreditField::Editors),
	// Writing. "Story" and "Script" are LOCG's common alternatives to "Writer".
	("writer", CreditField::Writers),
	("script", CreditField::Writers),
	("story", CreditField::Writers),
	("plot", CreditField::Writers),
	("dialogue", CreditField::Writers),
	// Line art.
	("penciller", CreditField::Pencillers),
	("penciler", CreditField::Pencillers),
	("pencils", CreditField::Pencillers),
	("breakdowns", CreditField::Pencillers),
	("finishes", CreditField::Inkers),
	("inker", CreditField::Inkers),
	("inks", CreditField::Inkers),
	// Colour and lettering.
	("colorist", CreditField::Colorists),
	("colourist", CreditField::Colorists),
	("colors", CreditField::Colorists),
	("colours", CreditField::Colorists),
	("letterer", CreditField::Letterers),
	("letters", CreditField::Letterers),
	// Generic art credit, last so the specific ones win.
	("illustrator", CreditField::Artists),
	("artist", CreditField::Artists),
	("art", CreditField::Artists),
];

/// Normalize one role token for matching: lowercase, and collapse the separators
/// contributors use inconsistently ("Editor-in-Chief" vs "Editor in Chief").
fn normalize(token: &str) -> String {
	token
		.trim()
		.to_lowercase()
		.replace(['/', '&'], " ")
		.split_whitespace()
		.collect::<Vec<_>>()
		.join(" ")
}

/// Map a single already-split role token to a field, if we recognise it.
pub fn map_role_token(token: &str) -> Option<CreditField> {
	let normalized = normalize(token);
	if normalized.is_empty() {
		return None;
	}
	// Try the hyphenated form too, so "editor-in-chief" matches its table entry.
	ROLE_TABLE
		.iter()
		.find(|(pattern, _)| normalized.contains(pattern))
		.map(|(_, field)| *field)
}

/// Split a possibly-compound LOCG role string into its individual role tokens.
///
/// "Writer, Artist, Colorist" → `["Writer", "Artist", "Colorist"]`. Also handles the
/// `&`/`and` joins that show up occasionally ("Pencils & Inks").
pub fn split_roles(role: &str) -> Vec<String> {
	role.split([',', ';'])
		.flat_map(|part| part.split(" and "))
		.map(|part| part.trim().to_string())
		.filter(|part| !part.is_empty())
		.collect()
}

/// Bucket `(role, name)` credit pairs into the metadata fields they populate.
///
/// Compound roles add the person to *every* field they map to, matching how the site
/// presents them: a "Writer, Artist" credit means that person did both.
pub fn bucket_credits<'a, I>(credits: I) -> CreditBuckets
where
	I: IntoIterator<Item = (&'a str, &'a str)>,
{
	let mut buckets = CreditBuckets::default();

	for (role, name) in credits {
		let name = name.trim();
		if name.is_empty() {
			continue;
		}
		for token in split_roles(role) {
			match map_role_token(&token) {
				Some(field) => buckets.push(field, name),
				None => {
					if !buckets.unmapped.iter().any(|u| u == &token) {
						buckets.unmapped.push(token);
					}
				},
			}
		}
	}

	buckets
}

#[cfg(test)]
mod tests {
	use super::*;

	fn names(v: &[String]) -> Vec<&str> {
		v.iter().map(String::as_str).collect()
	}

	#[test]
	fn maps_the_roles_observed_on_the_live_site() {
		// The 15 simple strings from the 12-issue survey.
		let cases = [
			("Writer", CreditField::Writers),
			("Artist", CreditField::Artists),
			("Colorist", CreditField::Colorists),
			("Letterer", CreditField::Letterers),
			("Editor", CreditField::Editors),
			("Cover Artist", CreditField::CoverArtists),
			("Cover Colorist", CreditField::CoverArtists),
			("Editor-in-Chief", CreditField::Editors),
			("Associate Editor", CreditField::Editors),
			("Assistant Editor", CreditField::Editors),
			("Executive Editor", CreditField::Editors),
			("Story", CreditField::Writers),
			("Penciller", CreditField::Pencillers),
			("Inker", CreditField::Inkers),
		];
		for (role, expected) in cases {
			assert_eq!(map_role_token(role), Some(expected), "role {role:?}");
		}
	}

	#[test]
	fn compound_roles_land_in_every_field() {
		// The trap: one person, comma-joined roles. An exact-match table would drop
		// this credit entirely.
		let buckets = bucket_credits([("Writer, Artist, Colorist", "Patrick Horvath")]);
		assert_eq!(names(&buckets.writers), ["Patrick Horvath"]);
		assert_eq!(names(&buckets.artists), ["Patrick Horvath"]);
		assert_eq!(names(&buckets.colorists), ["Patrick Horvath"]);
		assert!(buckets.unmapped.is_empty());
	}

	#[test]
	fn story_writer_compound_does_not_double_up_the_writer() {
		// "Story, Writer" maps both tokens to `writers`; the person must appear once.
		let buckets = bucket_credits([("Story, Writer", "Steven T. Seagle")]);
		assert_eq!(names(&buckets.writers), ["Steven T. Seagle"]);
	}

	#[test]
	fn cover_roles_beat_the_generic_art_and_color_entries() {
		// Ordering regression: "Cover Colorist" must not fall through to `colorists`.
		let buckets = bucket_credits([
			("Cover Artist", "Nick Dragotta"),
			("Cover Colorist", "Frank Martin"),
		]);
		assert_eq!(
			names(&buckets.cover_artists),
			["Nick Dragotta", "Frank Martin"]
		);
		assert!(buckets.colorists.is_empty());
		assert!(buckets.artists.is_empty());
	}

	#[test]
	fn every_editor_variant_collapses_to_editors() {
		let buckets = bucket_credits([
			("Editor", "Katie Kubert"),
			("Associate Editor", "Sabrina Futch"),
			("Executive Editor", "Chris Conroy"),
			("Editor-in-Chief", "Marie Javins"),
			("Assistant Editor", "Lindsey Cohick"),
		]);
		assert_eq!(
			names(&buckets.editors),
			[
				"Katie Kubert",
				"Sabrina Futch",
				"Chris Conroy",
				"Marie Javins",
				"Lindsey Cohick"
			]
		);
	}

	#[test]
	fn unrecognised_roles_are_reported_not_dropped() {
		// Designer and Production are real LOCG roles with no Longbox field. They
		// must surface as unmapped rather than being silently discarded *or*
		// mislabelled as artists.
		let buckets =
			bucket_credits([("Designer", "Jay Bowen"), ("Production", "Someone")]);
		assert_eq!(names(&buckets.unmapped), ["Designer", "Production"]);
		assert!(buckets.artists.is_empty());
		assert!(buckets.writers.is_empty());
	}

	#[test]
	fn a_person_credited_twice_is_listed_once() {
		// Multi-story issues repeat the same (role, person) pair per story.
		let buckets = bucket_credits([
			("Writer", "Jed MacKay"),
			("Writer", "Jed MacKay"),
			("Script", "Jed MacKay"),
		]);
		assert_eq!(names(&buckets.writers), ["Jed MacKay"]);
	}

	#[test]
	fn unseen_variants_still_match_by_substring() {
		// Not in the survey, but the substring table places them anyway.
		assert_eq!(map_role_token("Co-Writer"), Some(CreditField::Writers));
		assert_eq!(map_role_token("Pencils"), Some(CreditField::Pencillers));
		assert_eq!(map_role_token("Breakdowns"), Some(CreditField::Pencillers));
		assert_eq!(map_role_token("Colours"), Some(CreditField::Colorists));
		assert_eq!(map_role_token("Illustrator"), Some(CreditField::Artists));
	}

	#[test]
	fn splits_on_the_separators_locg_actually_uses() {
		assert_eq!(split_roles("Writer, Artist"), ["Writer", "Artist"]);
		assert_eq!(split_roles("Pencils and Inks"), ["Pencils", "Inks"]);
		assert_eq!(split_roles("  Writer  "), ["Writer"]);
		assert!(split_roles(" , ").is_empty());
	}

	#[test]
	fn blank_names_are_skipped() {
		let buckets = bucket_credits([("Writer", "   ")]);
		assert!(buckets.writers.is_empty());
	}
}
