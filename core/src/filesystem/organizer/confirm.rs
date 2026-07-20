//! Group loose files by parsed series, and confirm each group's canonical series
//! identity via the metadata providers.

use std::collections::BTreeMap;
use std::path::PathBuf;

use metadata_integrations::{parse_comic_filename, MatchCandidate, SearchQuery};
use models::entity::metadata_provider_config;
use models::shared::enums::LibraryType;
use sea_orm::{prelude::*, DatabaseConnection};

use crate::filesystem::metadata::ProviderClientCache;
use crate::CoreError;

/// Confidence at/above which a provider match is auto-actionable.
pub const CONFIDENCE_HIGH: f32 = 0.85;
/// Confidence below which a match is treated as no match.
pub const CONFIDENCE_LOW: f32 = 0.5;

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum OrganizeBucket {
	Confident,
	Ambiguous,
	Unmatched,
}

/// Bucket a confidence score: `>= HIGH` confident, `>= LOW` ambiguous, else unmatched.
pub fn bucket_for(confidence: f32) -> OrganizeBucket {
	if confidence >= CONFIDENCE_HIGH {
		OrganizeBucket::Confident
	} else if confidence >= CONFIDENCE_LOW {
		OrganizeBucket::Ambiguous
	} else {
		OrganizeBucket::Unmatched
	}
}

/// Normalize a series name into a grouping key: whitespace-collapsed, lowercased.
pub fn normalize_series_key(series: &str) -> String {
	series
		.split_whitespace()
		.collect::<Vec<_>>()
		.join(" ")
		.to_lowercase()
}

/// A coarse "series family" key used ONLY by catch-all subfolder detection to decide
/// whether a folder is a genuine jumble of unrelated series. It folds edition/format/
/// annual descriptors into the base title, so a folder of `Absolute Batman` +
/// `…Noir Edition` + `…2025 Annual` all resolve to family `absolute batman`.
///
/// It is deliberately NOT used for real grouping/search/foldering, where a Noir Edition
/// must keep its own identity — only for the "should I even touch this folder?" check.
pub fn series_family_key(series: &str) -> String {
	const SUFFIXES: &[&str] = &[
		"noir edition",
		"noir",
		"director's cut",
		"directors cut",
		"deluxe edition",
		"deluxe",
		"facsimile edition",
		"facsimile",
		"special edition",
		"absolute edition",
		"one-shot",
		"one shot",
	];
	let mut key = normalize_series_key(series);
	loop {
		let before = key.clone();
		for suffix in SUFFIXES {
			if let Some(stripped) = key.strip_suffix(suffix) {
				key = stripped.trim_end_matches([' ', '-']).trim().to_string();
			}
		}
		// "annual", optionally preceded by a 4-digit year ("… 2025 annual").
		if let Some(rest) = key.strip_suffix("annual") {
			let rest = rest.trim_end_matches([' ', '-']).trim();
			let toks: Vec<&str> = rest.split_whitespace().collect();
			key = if toks.len() > 1
				&& toks.last().is_some_and(|l| {
					l.len() == 4 && l.bytes().all(|b| b.is_ascii_digit())
				}) {
				toks[..toks.len() - 1].join(" ")
			} else {
				rest.to_string()
			};
		}
		if key == before {
			break;
		}
	}
	key
}

/// A provisional grouping of files that appear to belong to the same series,
/// keyed by normalized `{series, year}` parsed from filenames. This bounds the
/// number of provider calls; it is NOT the authoritative grouping.
#[derive(Debug, Clone)]
pub struct ProvisionalGroup {
	/// Normalized series key. Empty string when no series could be parsed.
	pub key: String,
	/// Representative original-cased series name, used to build the search query.
	pub series_query: String,
	pub year: Option<i32>,
	pub files: Vec<PathBuf>,
}

/// Group candidate files by normalized `{series, year}`. Files whose filename
/// yields no series land in a single group with `key == ""`, which callers route
/// straight to the Unmatched bucket.
pub fn group_candidates(files: &[PathBuf]) -> Vec<ProvisionalGroup> {
	let mut groups: BTreeMap<(String, Option<i32>), ProvisionalGroup> = BTreeMap::new();
	for path in files {
		let stem = path
			.file_stem()
			.and_then(|s| s.to_str())
			.unwrap_or_default();
		let parsed = parse_comic_filename(stem);
		let series = parsed.series.unwrap_or_default();
		let key = normalize_series_key(&series);
		let entry = groups.entry((key.clone(), parsed.year)).or_insert_with(|| {
			ProvisionalGroup {
				key,
				series_query: series.clone(),
				year: parsed.year,
				files: vec![],
			}
		});
		entry.files.push(path.clone());
	}
	groups.into_values().collect()
}

/// The canonical series identity confirmed from a provider search result.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ConfirmedSeries {
	pub canonical_name: String,
	pub year: Option<i32>,
	pub external_id: String,
	pub provider: String,
	pub confidence: f32,
	pub bucket: OrganizeBucket,
}

/// Derive the confirmed canonical series from the best (first, highest-confidence)
/// candidate. Returns `None` when there are no candidates or the top candidate is
/// not a series match.
pub fn confirm_from_candidates(candidates: &[MatchCandidate]) -> Option<ConfirmedSeries> {
	let top = candidates.first()?;
	let series = top.metadata.as_series()?;
	Some(ConfirmedSeries {
		canonical_name: series.title.clone(),
		year: series.year,
		external_id: top.external_id.clone(),
		provider: top.provider.clone(),
		confidence: top.confidence,
		bucket: bucket_for(top.confidence),
	})
}

/// Search every enabled provider that supports this library type for `series_query`
/// and return the combined candidates sorted descending by confidence.
///
/// This deliberately calls `provider.search_series` directly rather than
/// `fetch_series_metadata`, because the latter upserts a `metadata_fetch_record`
/// keyed by an existing `series_id` — which does not exist for a not-yet-created
/// series — and can write `series_metadata` as a side effect.
pub async fn search_series_candidates(
	conn: &DatabaseConnection,
	library_type: &LibraryType,
	series_query: &str,
	year: Option<i32>,
	provider_cache: &ProviderClientCache,
) -> Result<Vec<MatchCandidate>, CoreError> {
	let configs = metadata_provider_config::Entity::find()
		.filter(metadata_provider_config::Column::Enabled.eq(true))
		.all(conn)
		.await?
		.into_iter()
		.filter(|c| library_type.has_provider_overlap(&c.provider_type))
		.collect::<Vec<_>>();

	let query = SearchQuery {
		title: series_query.to_string(),
		series_year: year,
		limit: Some(10),
		..Default::default()
	};

	let mut all: Vec<MatchCandidate> = Vec::new();
	for config in &configs {
		match provider_cache.get_or_create(config).await {
			Ok(provider) => match provider.search_series(&query).await {
				Ok(mut candidates) => all.append(&mut candidates),
				Err(error) => {
					tracing::warn!(?error, provider = ?config.provider_type, "Provider search_series failed during organize");
				},
			},
			Err(error) => {
				tracing::warn!(?error, provider = ?config.provider_type, "Failed to build provider client during organize");
			},
		}
	}

	all.sort_by(|a, b| {
		b.confidence
			.partial_cmp(&a.confidence)
			.unwrap_or(std::cmp::Ordering::Equal)
	});
	Ok(all)
}

#[cfg(test)]
mod tests {
	use super::*;
	use metadata_integrations::{ExternalMetadata, ExternalSeriesMetadata};

	#[test]
	fn buckets_by_confidence_thresholds() {
		assert_eq!(bucket_for(0.90), OrganizeBucket::Confident);
		assert_eq!(bucket_for(0.85), OrganizeBucket::Confident);
		assert_eq!(bucket_for(0.60), OrganizeBucket::Ambiguous);
		assert_eq!(bucket_for(0.50), OrganizeBucket::Ambiguous);
		assert_eq!(bucket_for(0.10), OrganizeBucket::Unmatched);
	}

	#[test]
	fn normalizes_series_key() {
		assert_eq!(
			normalize_series_key("  Jays  Of Future  Past "),
			"jays of future past"
		);
	}

	#[test]
	fn series_family_folds_editions_and_annuals() {
		assert_eq!(series_family_key("Absolute Batman"), "absolute batman");
		assert_eq!(
			series_family_key("Absolute Batman Noir Edition"),
			"absolute batman"
		);
		assert_eq!(
			series_family_key("Absolute Batman 2025 Annual"),
			"absolute batman"
		);
		assert_eq!(series_family_key("Saga Deluxe Edition"), "saga");
		assert_eq!(series_family_key("Watchmen Facsimile"), "watchmen");
		// A genuinely different series is NOT folded into another.
		assert_eq!(series_family_key("Superman"), "superman");
	}

	#[test]
	fn groups_same_series_together_and_splits_by_year() {
		let files = vec![
			PathBuf::from("/l/Batman 001 (2016).cbz"),
			PathBuf::from("/l/Batman 002 (2016).cbz"),
			PathBuf::from("/l/Batman 001 (2011).cbz"),
			PathBuf::from("/l/mystery-blob.cbz"),
		];
		let groups = group_candidates(&files);
		// (batman,2016) -> 2 files; (batman,2011) -> 1 file; (mystery-blob? parses to series "mystery-blob", no year)
		let batman_2016 = groups
			.iter()
			.find(|g| g.key == "batman" && g.year == Some(2016))
			.unwrap();
		assert_eq!(batman_2016.files.len(), 2);
		let batman_2011 = groups
			.iter()
			.find(|g| g.key == "batman" && g.year == Some(2011))
			.unwrap();
		assert_eq!(batman_2011.files.len(), 1);
	}

	#[test]
	fn confirm_reads_canonical_series_from_top_candidate() {
		let candidate = MatchCandidate {
			provider: "comicvine".to_string(),
			external_id: "4050-2127".to_string(),
			metadata: ExternalMetadata::Series(ExternalSeriesMetadata {
				title: "Batman".to_string(),
				year: Some(2016),
				external_id: "4050-2127".to_string(),
				..Default::default()
			}),
			confidence: 0.90,
			confidence_factors: vec![],
		};
		let confirmed = confirm_from_candidates(&[candidate]).unwrap();
		assert_eq!(confirmed.canonical_name, "Batman");
		assert_eq!(confirmed.year, Some(2016));
		assert_eq!(confirmed.external_id, "4050-2127");
		assert_eq!(confirmed.bucket, OrganizeBucket::Confident);
	}

	#[test]
	fn confirm_returns_none_without_candidates() {
		assert!(confirm_from_candidates(&[]).is_none());
	}
}
