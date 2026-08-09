//! Turning a library's loose books into virtual shelves.
//!
//! Pure and offline: hand it the signals, get back the clusters. No I/O lives here, so
//! the whole thing is unit-testable against a real library's shape.

use std::collections::HashMap;

use models::shared::enums::BookGroupSource;

use super::canonicalize::{display_name, group_key, GroupKey};

/// A shelf must have at least this many books to be worth making.
///
/// Below it, grouping actively harms browsing. Measured on a real 139-book library,
/// grouping every loose book by its metadata series (falling back to a filename parse)
/// produced 8 groups of 2+ covering 24 books, and **115 groups of exactly one**. Turning
/// one junk bucket into 115 junk shelves is a worse library, not a fixed one, so a book
/// with no siblings simply stays standalone.
pub const MIN_GROUP_SIZE: usize = 2;

/// What we know about one book, already reduced to the fields grouping cares about.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GroupSignal {
	pub media_id: String,
	/// The series title, from embedded metadata if present or a filename parse if not.
	pub raw_title: String,
	/// Which of those two it came from.
	pub source: BookGroupSource,
	/// The issue number, when known. Not sufficient on its own to mark a book
	/// issue-shaped — a collected edition's volume number lands in the same field.
	pub number: Option<String>,
	pub year: Option<i32>,
	/// Whether the filename carried a volume marker (`v01`, `Vol. 3`). A book that has
	/// one is a collected volume, never a floppy issue.
	pub has_volume_token: bool,
}

/// A proposed shelf.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BookCluster {
	/// Stable identity for this shelf, so a re-run matches it instead of duplicating it.
	pub source_key: String,
	pub name: String,
	pub source: BookGroupSource,
	pub media_ids: Vec<String>,
}

/// Render a key back to the stable string stored on `book_groups.source_key`.
fn source_key_of(key: &GroupKey) -> String {
	match key.year {
		Some(year) => format!("{}|{year}", key.base),
		None => key.base.clone(),
	}
}

/// Group books into shelves, dropping anything that would be a shelf of one.
///
/// Returned clusters are sorted by name, and each cluster's `media_ids` by id, so the
/// output is deterministic and a re-run over unchanged input produces an identical
/// result.
pub fn cluster(signals: &[GroupSignal]) -> Vec<BookCluster> {
	let mut buckets: HashMap<GroupKey, Vec<&GroupSignal>> = HashMap::new();
	let mut is_collection_by_key: HashMap<GroupKey, bool> = HashMap::new();

	for signal in signals {
		if signal.raw_title.trim().is_empty() {
			continue;
		}

		let (key, is_collection) = group_key(
			&signal.raw_title,
			signal.number.as_deref(),
			signal.year,
			signal.has_volume_token,
		);

		is_collection_by_key.insert(key.clone(), is_collection);
		buckets.entry(key).or_default().push(signal);
	}

	let mut clusters = buckets
		.into_iter()
		.filter(|(_, members)| members.len() >= MIN_GROUP_SIZE)
		.map(|(key, members)| {
			let is_collection = is_collection_by_key.get(&key).copied().unwrap_or(false);

			// The shortest raw title is the least subtitle-laden spelling, which makes it
			// the best label for the shelf as a whole.
			let name = members
				.iter()
				.map(|member| display_name(&member.raw_title, is_collection))
				.min_by_key(|candidate| (candidate.len(), candidate.clone()))
				.unwrap_or_else(|| key.base.clone());

			// A shelf counts as metadata-derived if any member was tagged; a filename
			// parse is the weaker signal and only wins when nothing else is available.
			let source = if members
				.iter()
				.any(|member| member.source == BookGroupSource::Metadata)
			{
				BookGroupSource::Metadata
			} else {
				BookGroupSource::Filename
			};

			let mut media_ids = members
				.iter()
				.map(|member| member.media_id.clone())
				.collect::<Vec<_>>();
			media_ids.sort();

			BookCluster {
				source_key: source_key_of(&key),
				name,
				source,
				media_ids,
			}
		})
		.collect::<Vec<_>>();

	clusters.sort_by(|a, b| a.name.cmp(&b.name).then(a.source_key.cmp(&b.source_key)));
	clusters
}

#[cfg(test)]
mod tests {
	use super::*;

	fn signal(id: &str, title: &str, year: Option<i32>) -> GroupSignal {
		GroupSignal {
			media_id: id.to_string(),
			raw_title: title.to_string(),
			source: BookGroupSource::Metadata,
			number: None,
			year,
			has_volume_token: false,
		}
	}

	fn issue(id: &str, title: &str, number: &str, year: Option<i32>) -> GroupSignal {
		GroupSignal {
			media_id: id.to_string(),
			raw_title: title.to_string(),
			source: BookGroupSource::Filename,
			number: Some(number.to_string()),
			year,
			has_volume_token: false,
		}
	}

	#[test]
	fn singletons_never_become_shelves() {
		let clusters = cluster(&[
			signal("1", "The Complete Maus", Some(1991)),
			signal("2", "Batman - Arkham Asylum", Some(2004)),
			signal("3", "Fantastic Four - Full Circle", Some(2022)),
		]);

		assert!(clusters.is_empty());
	}

	#[test]
	fn scattered_epic_collection_volumes_become_one_shelf() {
		let clusters = cluster(&[
			signal("1", "Fantastic Four Epic Collection", None),
			signal(
				"2",
				"Fantastic Four Epic Collection: Annihilus Revealed",
				Some(2022),
			),
			signal(
				"3",
				"Fantastic Four Epic Collection 10: Counter-Earth Must Die",
				Some(2024),
			),
		]);

		assert_eq!(clusters.len(), 1);
		assert_eq!(clusters[0].name, "Fantastic Four Epic Collection");
		assert_eq!(clusters[0].media_ids, vec!["1", "2", "3"]);
	}

	#[test]
	fn distinct_volume_years_do_not_split_an_issue_run() {
		let clusters = cluster(&[
			issue("1", "Batman", "1", Some(2011)),
			issue("2", "Batman", "2", Some(2011)),
			issue("3", "Batman", "1", Some(2016)),
			issue("4", "Batman", "2", Some(2016)),
		]);

		assert_eq!(clusters.len(), 2, "2011 and 2016 are different series");
		assert!(clusters.iter().all(|c| c.media_ids.len() == 2));
	}

	#[test]
	fn a_multi_year_collected_run_stays_whole() {
		let clusters = cluster(&[
			signal("1", "Saga of the Swamp Thing", Some(2009)),
			signal("2", "Saga of the Swamp Thing", Some(2009)),
			signal("3", "Saga of the Swamp Thing", Some(2010)),
			signal("4", "Saga of the Swamp Thing", Some(2011)),
		]);

		assert_eq!(clusters.len(), 1);
		assert_eq!(clusters[0].media_ids.len(), 4);
	}

	#[test]
	fn blank_titles_are_ignored_rather_than_grouped_together() {
		let clusters = cluster(&[
			signal("1", "", None),
			signal("2", "   ", None),
			signal("3", "", Some(2020)),
		]);

		assert!(clusters.is_empty());
	}

	#[test]
	fn output_is_stable_across_runs() {
		let signals = vec![
			signal("b", "Fantastic Four Omnibus", Some(2018)),
			signal("a", "Fantastic Four Omnibus", Some(2021)),
			signal("c", "Spawn: New Beginnings", None),
			signal("d", "Spawn: New Beginnings", None),
		];

		assert_eq!(cluster(&signals), cluster(&signals));

		let mut reversed = signals.clone();
		reversed.reverse();
		assert_eq!(
			cluster(&signals),
			cluster(&reversed),
			"input order must not change the result"
		);
	}

	#[test]
	fn a_tagged_member_makes_the_shelf_metadata_derived() {
		let clusters = cluster(&[
			GroupSignal {
				source: BookGroupSource::Filename,
				..signal("1", "Spawn Origins Collection", None)
			},
			signal("2", "Spawn Origins Collection", None),
		]);

		assert_eq!(clusters.len(), 1);
		assert_eq!(clusters[0].source, BookGroupSource::Metadata);
	}

	/// The measured shape of the production library this feature was built for: of 139
	/// loose books, only a handful form real shelves and the rest stand alone.
	#[test]
	fn production_shape_yields_few_shelves_and_many_standalones() {
		let mut signals = Vec::new();

		// Six spellings of one Epic Collection line.
		for (i, subtitle) in [
			"",
			": Annihilus Revealed",
			": At War With Atlantis",
			": The Name Is Doom",
			": Strange Days",
			" 10: Counter-Earth Must Die",
		]
		.iter()
		.enumerate()
		{
			signals.push(signal(
				&format!("epic-{i}"),
				&format!("Fantastic Four Epic Collection{subtitle}"),
				Some(2014 + i as i32),
			));
		}

		// A four-book run spanning three years, with no marker word.
		for (i, year) in [2009, 2009, 2010, 2011].iter().enumerate() {
			signals.push(signal(
				&format!("swamp-{i}"),
				"Saga of the Swamp Thing",
				Some(*year),
			));
		}

		// Twenty genuinely standalone works.
		for i in 0..20 {
			signals.push(signal(
				&format!("solo-{i}"),
				&format!("Standalone Work {i}"),
				Some(2020),
			));
		}

		let clusters = cluster(&signals);

		assert_eq!(clusters.len(), 2, "only the two real runs become shelves");
		let grouped: usize = clusters.iter().map(|c| c.media_ids.len()).sum();
		assert_eq!(grouped, 10, "6 Epic Collection + 4 Swamp Thing");
		assert_eq!(
			signals.len() - grouped,
			20,
			"every standalone work stays standalone"
		);
	}
}
