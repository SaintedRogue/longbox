//! Execute an organize plan: move files and re-point media records atomically.

use std::path::{Path, PathBuf};

use models::entity::{media, series, series_metadata};
use models::shared::enums::FileStatus;
use sea_orm::{
	prelude::*, ActiveValue::Set, DatabaseConnection, IntoActiveModel, TransactionTrait,
};

use crate::CoreResult;

use super::paths::{destination_path, series_folder_name};

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub enum DecisionAction {
	Move {
		/// Existing series to merge into; when `None`, find-or-create by external id/folder.
		series_id: Option<String>,
		canonical_name: String,
		year: Option<i32>,
		external_id: Option<String>,
		provider: Option<String>,
	},
	Skip,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct OrganizeDecision {
	/// Absolute source path of the file to organize.
	pub src: String,
	pub action: DecisionAction,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AppliedMove {
	pub media_id: Option<String>,
	pub src: String,
	pub dst: String,
}

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct ApplyResult {
	pub moved: u64,
	pub skipped: u64,
	pub failed: u64,
	pub applied: Vec<AppliedMove>,
}

/// Move a file across filesystems when `rename` fails with `EXDEV` (cross-device).
fn move_file(src: &Path, dst: &Path) -> std::io::Result<()> {
	match std::fs::rename(src, dst) {
		Ok(()) => Ok(()),
		Err(error) => {
			// EXDEV (raw os error 18 on Linux) => copy then remove.
			if error.raw_os_error() == Some(18) {
				if let Err(copy_err) = std::fs::copy(src, dst) {
					let _ = std::fs::remove_file(dst); // clean up any partial copy
					return Err(copy_err);
				}
				if let Err(remove_err) = std::fs::remove_file(src) {
					let _ = std::fs::remove_file(dst); // don't leave an orphan copy
					return Err(remove_err);
				}
				Ok(())
			} else {
				Err(error)
			}
		},
	}
}

/// Resolve the target series id inside `txn`, creating the series (+ metadata) when
/// no existing series matches by explicit id, external id, or destination folder path.
#[allow(clippy::too_many_arguments)]
async fn resolve_series(
	txn: &sea_orm::DatabaseTransaction,
	library_id: &str,
	folder_path: &str,
	folder_name: &str,
	canonical_name: &str,
	year: Option<i32>,
	external_id: Option<&str>,
	provider: Option<&str>,
	explicit_series_id: Option<&str>,
) -> CoreResult<String> {
	if let Some(id) = explicit_series_id {
		return Ok(id.to_string());
	}
	// Merge by external id.
	if let Some(ext) = external_id {
		if let Some(meta) = series_metadata::Entity::find()
			.filter(series_metadata::Column::MetadataExternalId.eq(ext.to_owned()))
			.one(txn)
			.await?
		{
			return Ok(meta.series_id);
		}
	}
	// Merge by destination folder path within this library.
	if let Some(existing) = series::Entity::find()
		.filter(series::Column::LibraryId.eq(library_id.to_owned()))
		.filter(series::Column::Path.eq(folder_path.to_owned()))
		.one(txn)
		.await?
	{
		return Ok(existing.id);
	}
	// Create a new series (id auto-assigned in before_save) + metadata.
	let created = series::ActiveModel {
		name: Set(folder_name.to_string()),
		path: Set(folder_path.to_string()),
		library_id: Set(Some(library_id.to_string())),
		status: Set(FileStatus::Ready),
		..Default::default()
	}
	.insert(txn)
	.await?;

	series_metadata::ActiveModel {
		series_id: Set(created.id.clone()),
		title: Set(Some(canonical_name.to_string())),
		year: Set(year),
		metadata_external_id: Set(external_id.map(|s| s.to_string())),
		metadata_source: Set(provider.map(|s| s.to_string())),
		..Default::default()
	}
	.insert(txn)
	.await?;

	Ok(created.id)
}

/// Re-point the existing media row (by src path) to `dst` + `series_id` and commit.
/// Consumes the transaction so any error returns without committing.
async fn repoint_media(
	txn: sea_orm::DatabaseTransaction,
	src: &str,
	dst: &str,
	series_id: &str,
) -> Result<Option<String>, sea_orm::DbErr> {
	let media_id = match media::Entity::find()
		.filter(media::Column::Path.eq(src.to_owned()))
		.one(&txn)
		.await?
	{
		Some(model) => {
			let id = model.id.clone();
			let mut active = model.into_active_model();
			active.path = Set(dst.to_owned());
			active.series_id = Set(Some(series_id.to_owned()));
			active.update(&txn).await?;
			Some(id)
		},
		None => None,
	};
	txn.commit().await?;
	Ok(media_id)
}

/// Execute the decided moves. Each move is a single transaction that (1) resolves or
/// creates the target series, (2) moves the file on disk, and (3) re-points the
/// existing media record — so a failure at any step leaves the file and DB unchanged.
pub async fn apply_plan(
	conn: &DatabaseConnection,
	library_id: &str,
	library_path: &str,
	decisions: Vec<OrganizeDecision>,
) -> CoreResult<ApplyResult> {
	let root = Path::new(library_path);
	let mut result = ApplyResult::default();

	for decision in decisions {
		let DecisionAction::Move {
			series_id,
			canonical_name,
			year,
			external_id,
			provider,
		} = decision.action
		else {
			result.skipped += 1;
			continue;
		};

		let src = PathBuf::from(&decision.src);
		let Some(file_name) = src.file_name() else {
			result.failed += 1;
			continue;
		};
		let folder_name = series_folder_name(&canonical_name, year);
		let folder_path = root.join(&folder_name);
		let dst = destination_path(root, &folder_name, file_name);

		// Never overwrite an existing destination.
		if dst.exists() {
			tracing::warn!(?dst, "Organize destination already exists; skipping");
			result.skipped += 1;
			continue;
		}
		if let Err(error) = std::fs::create_dir_all(&folder_path) {
			tracing::error!(?error, ?folder_path, "Failed to create series folder");
			result.failed += 1;
			continue;
		}

		let txn = conn.begin().await?;

		let series_id = match resolve_series(
			&txn,
			library_id,
			&folder_path.to_string_lossy(),
			&folder_name,
			&canonical_name,
			year,
			external_id.as_deref(),
			provider.as_deref(),
			series_id.as_deref(),
		)
		.await
		{
			Ok(id) => id,
			Err(error) => {
				tracing::error!(
					?error,
					?src,
					"Failed to resolve series during organize; skipping"
				);
				result.failed += 1;
				continue; // nothing moved yet; txn dropped -> rolled back
			},
		};

		// Re-check right before the move to narrow the collision TOCTOU window.
		if dst.exists() {
			tracing::warn!(?dst, "Organize destination appeared before move; skipping");
			result.skipped += 1;
			continue;
		}

		if let Err(error) = move_file(&src, &dst) {
			tracing::error!(?error, ?src, ?dst, "Failed to move file during organize");
			result.failed += 1;
			continue; // txn dropped -> rolled back; file not moved
		}

		// The file is now at `dst`. Any failure past this point must move it back
		// so the rolled-back DB and the filesystem stay consistent.
		match repoint_media(txn, &decision.src, &dst.to_string_lossy(), &series_id).await
		{
			Ok(media_id) => {
				result.moved += 1;
				result.applied.push(AppliedMove {
					media_id,
					src: decision.src,
					dst: dst.to_string_lossy().to_string(),
				});
			},
			Err(error) => {
				tracing::error!(
					?error,
					?src,
					?dst,
					"DB re-point failed after move; reverting file"
				);
				if let Err(revert) = move_file(&dst, &src) {
					tracing::error!(?revert, ?src, ?dst, "CRITICAL: failed to revert moved file after DB error; file at dst is orphaned");
				}
				result.failed += 1;
				continue;
			},
		}
	}

	Ok(result)
}

#[cfg(test)]
mod tests {
	use super::*;
	use models::entity::media;
	use models::entity::series;
	use models::shared::enums::FileStatus;
	use sea_orm::{ActiveModelTrait, EntityTrait, PaginatorTrait, Set};

	#[tokio::test]
	async fn apply_moves_file_and_repoints_media_preserving_identity() {
		let db = ::tests::db::test_database().await;
		let root = tempfile::tempdir().unwrap();
		let src = root.path().join("Batman 003 (2016).cbz");
		std::fs::write(&src, b"x").unwrap();

		let lib = ::tests::fake_data::Library {
			id: None,
			name: Some("Comics".to_string()),
			path: Some(root.path().to_string_lossy().to_string()),
		}
		.insert(&db)
		.await;
		let junk = ::tests::fake_data::Series {
			id: None,
			name: Some("data".to_string()),
			path: Some(root.path().to_string_lossy().to_string()),
			library_id: Some(lib.id.clone()),
		}
		.insert(&db)
		.await;
		let book = media::ActiveModel {
			name: Set("Batman 003 (2016)".to_string()),
			path: Set(src.to_string_lossy().to_string()),
			extension: Set("cbz".to_string()),
			size: Set(1),
			pages: Set(1),
			series_id: Set(Some(junk.id.clone())),
			status: Set(FileStatus::Ready),
			..Default::default()
		}
		.insert(&db)
		.await
		.unwrap();

		let result = apply_plan(
			&db,
			&lib.id,
			root.path().to_str().unwrap(),
			vec![OrganizeDecision {
				src: src.to_string_lossy().to_string(),
				action: DecisionAction::Move {
					series_id: None,
					canonical_name: "Batman".to_string(),
					year: Some(2016),
					external_id: Some("cv-4050-2127".to_string()),
					provider: Some("comicvine".to_string()),
				},
			}],
		)
		.await
		.unwrap();

		assert_eq!(result.moved, 1);
		assert!(!src.exists());
		assert!(root
			.path()
			.join("Batman (2016)/Batman 003 (2016).cbz")
			.exists());

		let reloaded = media::Entity::find_by_id(book.id.clone())
			.one(&db)
			.await
			.unwrap()
			.unwrap();
		assert!(reloaded
			.path
			.ends_with("Batman (2016)/Batman 003 (2016).cbz"));
		assert_ne!(reloaded.series_id.as_deref(), Some(junk.id.as_str()));
		assert!(reloaded.series_id.is_some());
	}

	#[tokio::test]
	async fn apply_skips_on_destination_collision() {
		let db = ::tests::db::test_database().await;
		let root = tempfile::tempdir().unwrap();
		let src = root.path().join("Batman 003 (2016).cbz");
		std::fs::write(&src, b"x").unwrap();
		let dst_dir = root.path().join("Batman (2016)");
		std::fs::create_dir_all(&dst_dir).unwrap();
		std::fs::write(dst_dir.join("Batman 003 (2016).cbz"), b"existing").unwrap();

		let result = apply_plan(
			&db,
			"lib-1",
			root.path().to_str().unwrap(),
			vec![OrganizeDecision {
				src: src.to_string_lossy().to_string(),
				action: DecisionAction::Move {
					series_id: None,
					canonical_name: "Batman".to_string(),
					year: Some(2016),
					external_id: None,
					provider: None,
				},
			}],
		)
		.await
		.unwrap();

		assert_eq!(result.skipped, 1);
		assert_eq!(result.moved, 0);
		assert!(src.exists());
	}

	#[tokio::test]
	async fn apply_merges_into_explicit_existing_series() {
		let db = ::tests::db::test_database().await;
		let root = tempfile::tempdir().unwrap();
		let src = root.path().join("Batman 004 (2016).cbz");
		std::fs::write(&src, b"x").unwrap();

		let lib = ::tests::fake_data::Library {
			id: None,
			name: Some("Comics".to_string()),
			path: Some(root.path().to_string_lossy().to_string()),
		}
		.insert(&db)
		.await;
		let target = ::tests::fake_data::Series {
			id: None,
			name: Some("Batman".to_string()),
			path: Some(
				root.path()
					.join("Existing Batman Series")
					.to_string_lossy()
					.to_string(),
			),
			library_id: Some(lib.id.clone()),
		}
		.insert(&db)
		.await;
		let book = media::ActiveModel {
			name: Set("Batman 004 (2016)".to_string()),
			path: Set(src.to_string_lossy().to_string()),
			extension: Set("cbz".to_string()),
			size: Set(1),
			pages: Set(1),
			series_id: Set(None),
			status: Set(FileStatus::Ready),
			..Default::default()
		}
		.insert(&db)
		.await
		.unwrap();

		let before = series::Entity::find().count(&db).await.unwrap();
		let result = apply_plan(
			&db,
			&lib.id,
			root.path().to_str().unwrap(),
			vec![OrganizeDecision {
				src: src.to_string_lossy().to_string(),
				action: DecisionAction::Move {
					series_id: Some(target.id.clone()),
					canonical_name: "Batman".to_string(),
					year: Some(2016),
					external_id: None,
					provider: None,
				},
			}],
		)
		.await
		.unwrap();

		assert_eq!(result.moved, 1);
		let after = series::Entity::find().count(&db).await.unwrap();
		assert_eq!(
			before, after,
			"no new series should be created when merging into an explicit series"
		);
		let reloaded = media::Entity::find_by_id(book.id.clone())
			.one(&db)
			.await
			.unwrap()
			.unwrap();
		assert_eq!(reloaded.series_id.as_deref(), Some(target.id.as_str()));
	}
}
