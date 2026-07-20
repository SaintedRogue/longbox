//! Assemble a full organize preview (proposed moves + unmatched files).

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use models::entity::{library_config, media, series, series_metadata};
use sea_orm::{prelude::*, DatabaseConnection};

use crate::filesystem::metadata::ProviderClientCache;
use crate::CoreResult;

use super::candidates::find_candidate_files;
use super::confirm::{
	confirm_from_candidates, group_candidates, normalize_series_key,
	search_series_candidates, ConfirmedSeries, OrganizeBucket,
};
use super::paths::{destination_path, series_folder_name};

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ProposedMove {
	pub media_id: Option<String>,
	pub src: String,
	pub dst: String,
	pub group_key: String,
	pub canonical_name: String,
	pub year: Option<i32>,
	pub external_id: String,
	pub provider: String,
	pub confidence: f32,
	pub bucket: OrganizeBucket,
	pub existing_series_id: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct UnmatchedFile {
	pub media_id: Option<String>,
	pub src: String,
	pub parsed_series: Option<String>,
	pub reason: String,
}

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct OrganizePlan {
	pub proposed_moves: Vec<ProposedMove>,
	pub unmatched: Vec<UnmatchedFile>,
}

fn unmatched(
	media_by_path: &HashMap<String, String>,
	path: &Path,
	parsed_series: Option<String>,
	reason: &str,
) -> UnmatchedFile {
	UnmatchedFile {
		media_id: media_by_path
			.get(&path.to_string_lossy().to_string())
			.cloned(),
		src: path.to_string_lossy().to_string(),
		parsed_series,
		reason: reason.to_string(),
	}
}

/// Build a complete organize preview for a library.
///
/// `cached_only` skips live provider calls, confirming only groups that match a
/// previously-organized series already in the DB (used by the auto-on-scan path).
pub async fn build_plan(
	conn: &DatabaseConnection,
	library_id: &str,
	library_path: &str,
	config: &library_config::Model,
	provider_cache: &ProviderClientCache,
	cached_only: bool,
) -> CoreResult<OrganizePlan> {
	let ignore = config.ignore_rules().build()?;
	let root = Path::new(library_path);
	let candidate_paths: Vec<PathBuf> = find_candidate_files(root, &ignore)
		.into_iter()
		.map(|c| c.path)
		.collect();

	// path -> existing media id (to preserve identity on move)
	let media_by_path: HashMap<String, String> = media::Entity::find()
		.filter(media::Column::Path.starts_with(library_path))
		.all(conn)
		.await?
		.into_iter()
		.map(|m| (m.path, m.id))
		.collect();

	// existing series + their metadata, for the confirmation cache and merge targets
	let series_rows = series::Entity::find()
		.filter(series::Column::LibraryId.eq(library_id.to_owned()))
		.all(conn)
		.await?;
	let series_ids: Vec<String> = series_rows.iter().map(|s| s.id.clone()).collect();
	let meta_rows = series_metadata::Entity::find()
		.filter(series_metadata::Column::SeriesId.is_in(series_ids))
		.all(conn)
		.await?;
	let meta_by_series: HashMap<String, series_metadata::Model> = meta_rows
		.into_iter()
		.map(|m| (m.series_id.clone(), m))
		.collect();

	// normalized(title)+year -> (confirmed identity, existing series id)
	let mut cache: HashMap<(String, Option<i32>), (ConfirmedSeries, String)> =
		HashMap::new();
	// external_id -> series id (merge by canonical volume)
	let mut series_by_external: HashMap<String, String> = HashMap::new();
	// destination folder path string -> series id (merge by folder)
	let mut series_by_path: HashMap<String, String> = HashMap::new();
	for s in &series_rows {
		series_by_path.insert(s.path.clone(), s.id.clone());
		if let Some(meta) = meta_by_series.get(&s.id) {
			if let Some(ext) = &meta.metadata_external_id {
				series_by_external.insert(ext.clone(), s.id.clone());
			}
			if let Some(title) = &meta.title {
				let confirmed = ConfirmedSeries {
					canonical_name: title.clone(),
					year: meta.year,
					external_id: meta.metadata_external_id.clone().unwrap_or_default(),
					provider: meta.metadata_source.clone().unwrap_or_default(),
					confidence: 1.0,
					bucket: OrganizeBucket::Confident,
				};
				cache.insert(
					(normalize_series_key(title), meta.year),
					(confirmed, s.id.clone()),
				);
			}
		}
	}

	let mut plan = OrganizePlan::default();

	for group in group_candidates(&candidate_paths) {
		if group.key.is_empty() {
			for path in &group.files {
				plan.unmatched.push(unmatched(
					&media_by_path,
					path,
					None,
					"Could not parse a series from the filename",
				));
			}
			continue;
		}

		let confirmed_and_merge: Option<(ConfirmedSeries, Option<String>)> = if let Some(
			(c, sid),
		) =
			cache.get(&(group.key.clone(), group.year)).cloned()
		{
			Some((c, Some(sid)))
		} else if cached_only {
			None
		} else {
			let candidates = search_series_candidates(
				conn,
				&config.library_type,
				&group.series_query,
				group.year,
				provider_cache,
			)
			.await
			.unwrap_or_default();
			confirm_from_candidates(&candidates).map(|c| {
				let merge = series_by_external.get(&c.external_id).cloned();
				(c, merge)
			})
		};

		match confirmed_and_merge {
			Some((c, merge)) if c.bucket != OrganizeBucket::Unmatched => {
				let folder = series_folder_name(&c.canonical_name, c.year);
				let folder_path = root.join(&folder).to_string_lossy().to_string();
				let existing_series_id =
					merge.or_else(|| series_by_path.get(&folder_path).cloned());
				for path in &group.files {
					let Some(file_name) = path.file_name() else {
						continue;
					};
					let dst = destination_path(root, &folder, file_name);
					plan.proposed_moves.push(ProposedMove {
						media_id: media_by_path
							.get(&path.to_string_lossy().to_string())
							.cloned(),
						src: path.to_string_lossy().to_string(),
						dst: dst.to_string_lossy().to_string(),
						group_key: group.key.clone(),
						canonical_name: c.canonical_name.clone(),
						year: c.year,
						external_id: c.external_id.clone(),
						provider: c.provider.clone(),
						confidence: c.confidence,
						bucket: c.bucket,
						existing_series_id: existing_series_id.clone(),
					});
				}
			},
			_ => {
				let reason = if cached_only {
					"No cached provider match (deferred to a manual run)"
				} else {
					"No confident provider match"
				};
				for path in &group.files {
					plan.unmatched.push(unmatched(
						&media_by_path,
						path,
						Some(group.series_query.clone()),
						reason,
					));
				}
			},
		}
	}

	Ok(plan)
}

#[cfg(test)]
mod tests {
	use super::*;
	use sea_orm::{ActiveModelTrait, ColumnTrait, EntityTrait, QueryFilter, Set};
	// Absolute path: this module is itself named `tests`, so `use super::*` glob-imports
	// that self-reference and shadows the extern `tests` fixture crate under a bare name.
	use ::tests::{db, fake_data};

	async fn seeded_library(
		db: &sea_orm::DatabaseConnection,
		path: &str,
	) -> (String, library_config::Model) {
		let lib = fake_data::Library {
			id: None,
			name: Some("Comics".to_string()),
			path: Some(path.to_string()),
		}
		.insert(db)
		.await;
		let config = library_config::Entity::find()
			.filter(library_config::Column::LibraryId.eq(lib.id.clone()))
			.one(db)
			.await
			.unwrap()
			.expect("library config should exist");
		(lib.id, config)
	}

	#[tokio::test]
	async fn build_plan_defers_when_no_cache_and_cached_only() {
		let db = db::test_database().await;
		let root = tempfile::tempdir().unwrap();
		std::fs::write(root.path().join("Jays of Future Past 001.cbz"), b"x").unwrap();
		std::fs::write(root.path().join("Some Other Book 001.cbz"), b"x").unwrap();

		let (lib_id, config) = seeded_library(&db, root.path().to_str().unwrap()).await;
		let cache = ProviderClientCache::new("test-key".to_string());
		let plan = build_plan(
			&db,
			&lib_id,
			root.path().to_str().unwrap(),
			&config,
			&cache,
			true,
		)
		.await
		.unwrap();

		assert!(plan.proposed_moves.is_empty());
		assert_eq!(plan.unmatched.len(), 2);
		assert!(plan.unmatched.iter().all(|u| u.reason.contains("deferred")));
	}

	#[tokio::test]
	async fn build_plan_uses_cached_series_and_merges() {
		let db = db::test_database().await;
		let root = tempfile::tempdir().unwrap();
		std::fs::write(root.path().join("Batman 003 (2016).cbz"), b"x").unwrap();

		let (lib_id, config) = seeded_library(&db, root.path().to_str().unwrap()).await;

		let batman = fake_data::Series {
			id: None,
			name: Some("Batman".to_string()),
			path: Some(
				root.path()
					.join("Batman (2016)")
					.to_string_lossy()
					.to_string(),
			),
			library_id: Some(lib_id.clone()),
		}
		.insert(&db)
		.await;
		series_metadata::ActiveModel {
			series_id: Set(batman.id.clone()),
			title: Set(Some("Batman".to_string())),
			year: Set(Some(2016)),
			metadata_external_id: Set(Some("cv-4050-2127".to_string())),
			metadata_source: Set(Some("comicvine".to_string())),
			..Default::default()
		}
		.insert(&db)
		.await
		.unwrap();

		let cache = ProviderClientCache::new("test-key".to_string());
		let plan = build_plan(
			&db,
			&lib_id,
			root.path().to_str().unwrap(),
			&config,
			&cache,
			true,
		)
		.await
		.unwrap();

		assert_eq!(plan.proposed_moves.len(), 1);
		let mv = &plan.proposed_moves[0];
		assert_eq!(mv.bucket, OrganizeBucket::Confident);
		assert_eq!(mv.canonical_name, "Batman");
		assert_eq!(mv.year, Some(2016));
		assert_eq!(mv.existing_series_id.as_deref(), Some(batman.id.as_str()));
		assert!(mv.dst.ends_with("Batman (2016)/Batman 003 (2016).cbz"));
	}
}
