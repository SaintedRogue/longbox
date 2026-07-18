//! One-time, on-boot migration of legacy Stump-named data to their Longbox-branded
//! equivalents.
//!
//! Every operation here is guarded on "source exists AND target does not" so the
//! migration is safe to run on every boot: it is idempotent (a second run is a no-op)
//! and non-clobbering (an existing target directory/file is never overwritten). The
//! live data this runs against is disposable/test data, but the migration itself must
//! still never destroy anything.
//!
//! This module runs during [`super::bootstrap_config_dir`], which executes *before*
//! `init_tracing()` is ever called (and the `stump` CLI binary never initializes
//! tracing at all). `tracing::*` calls made here are therefore silently dropped -
//! there is no subscriber installed yet to observe them. All operator-facing output
//! (migration success, and - critically - migration *failure*, which would otherwise
//! look like silent data loss) is emitted with `eprintln!` instead.

use std::path::Path;

/// Renames `from` to `to` only when `from` exists and `to` does not. No-op otherwise
/// (including when `from` is missing, or `to` already exists).
fn rename_if_exists(from: &Path, to: &Path) {
	if from.exists() && !to.exists() {
		if let Err(error) = std::fs::rename(from, to) {
			eprintln!(
				"Longbox: WARNING failed to migrate {from:?} -> {to:?}: {error}. This \
				 item was left in place and will be retried on next boot."
			);
		}
	}
}

/// Migrates a legacy Stump data directory to its new Longbox location.
///
/// The directory-level rename only runs when `legacy` exists AND `target` does NOT —
/// this is what makes it non-clobbering: if `target` already exists (e.g. from a prior
/// migration, or a fresh Longbox install sitting next to an old Stump one), it is
/// never touched or overwritten, and `legacy` is left in place untouched too. When it
/// does apply, the directory is moved with a single atomic `fs::rename` (atomic as long
/// as `legacy` and `target` share a filesystem, which they do here since both live
/// under the same home directory).
///
/// Independently, whenever `target` exists (whether it existed already, or was just
/// created by the rename above), the well-known legacy-named files inside it
/// (`Stump.toml`, `Stump.log`, `stump.db` + WAL/SHM sidecars) are (re-)renamed in
/// place to their Longbox-branded names via [`migrate_legacy_files`]. This is what
/// makes the migration retry-safe: if a previous boot's outer `fs::rename` succeeded
/// but an inner file rename then failed (e.g. a permissions issue on just that file),
/// `target` already exists on the next boot, so the old `legacy.exists() &&
/// !target.exists()` guard alone would skip retrying the stranded inner file forever.
/// Running `migrate_legacy_files` unconditionally whenever `target` exists closes that
/// gap; it is itself idempotent and non-clobbering via [`rename_if_exists`], so
/// re-running it on an already-fully-migrated directory is always a safe no-op.
pub fn migrate_legacy_dir(legacy: &Path, target: &Path) -> std::io::Result<()> {
	if legacy.exists() && !target.exists() {
		std::fs::rename(legacy, target)?;
		eprintln!("Longbox: migrated legacy data dir {legacy:?} -> {target:?}");
	}

	if target.exists() {
		migrate_legacy_files(target);
	}

	Ok(())
}

/// Renames the well-known legacy-named files inside an already-migrated directory
/// (config file, log file, and the database + its WAL/SHM sidecars) to their
/// Longbox-branded equivalents, in place. Each rename is individually guarded via
/// [`rename_if_exists`], so this is safe to call even if only some of the legacy files
/// are present (or some Longbox-named files already exist from a previous partial
/// migration).
fn migrate_legacy_files(dir: &Path) {
	rename_if_exists(&dir.join("Stump.toml"), &dir.join("Longbox.toml"));
	rename_if_exists(&dir.join("Stump.log"), &dir.join("Longbox.log"));
	migrate_legacy_db(dir);
}

/// Renames `stump.db` (and its `-wal`/`-shm` sidecars, if present) to `longbox.db` in
/// the given directory. Non-clobbering: if a `longbox.db*` file already exists, the
/// corresponding legacy file is left in place untouched. This covers both the default
/// config directory (via [`migrate_legacy_dir`]) and a custom db directory configured
/// via `LONGBOX_DB_PATH`/`STUMP_DB_PATH` that lives outside the config directory.
pub fn migrate_legacy_db(db_dir: &Path) {
	rename_if_exists(&db_dir.join("stump.db"), &db_dir.join("longbox.db"));
	rename_if_exists(&db_dir.join("stump.db-wal"), &db_dir.join("longbox.db-wal"));
	rename_if_exists(&db_dir.join("stump.db-shm"), &db_dir.join("longbox.db-shm"));
}

#[cfg(test)]
mod tests {
	use super::*;
	use tempfile::tempdir;

	#[test]
	fn migrates_legacy_stump_dir_only_when_target_absent() {
		let tmp = tempdir().unwrap();
		let legacy = tmp.path().join(".stump");
		let target = tmp.path().join(".longbox");
		std::fs::create_dir_all(&legacy).unwrap();
		std::fs::write(legacy.join("Stump.toml"), "x").unwrap();
		std::fs::write(legacy.join("Stump.log"), "log").unwrap();
		std::fs::write(legacy.join("stump.db"), "db").unwrap();
		std::fs::write(legacy.join("stump.db-wal"), "wal").unwrap();

		migrate_legacy_dir(&legacy, &target).unwrap();

		assert!(target.join("Longbox.toml").exists()); // renamed dir + file
		assert!(target.join("Longbox.log").exists());
		assert!(target.join("longbox.db").exists());
		assert!(target.join("longbox.db-wal").exists());
		assert!(!legacy.exists());

		// idempotent + non-clobbering: re-run with target present is a no-op
		std::fs::create_dir_all(&legacy).unwrap();
		std::fs::write(legacy.join("Stump.toml"), "should-not-move").unwrap();
		migrate_legacy_dir(&legacy, &target).unwrap();
		assert!(legacy.exists()); // NOT moved over an existing target
		assert_eq!(
			std::fs::read_to_string(legacy.join("Stump.toml")).unwrap(),
			"should-not-move"
		);
		// target from the first migration is untouched
		assert_eq!(
			std::fs::read_to_string(target.join("Longbox.toml")).unwrap(),
			"x"
		);
	}

	#[test]
	fn retries_stranded_inner_file_migration_when_target_already_exists() {
		// Simulates a previous boot where the outer dir rename succeeded but an inner
		// file rename then failed (or was interrupted), leaving a Stump-named file
		// stranded inside an already-migrated target directory. The legacy dir itself
		// is gone (already renamed away), so the old `legacy.exists()` guard alone
		// would never retry this - it must be picked up whenever `target` exists.
		let tmp = tempdir().unwrap();
		let legacy = tmp.path().join(".stump");
		let target = tmp.path().join(".longbox");
		std::fs::create_dir_all(&target).unwrap();
		std::fs::write(target.join("Stump.toml"), "stranded").unwrap();

		migrate_legacy_dir(&legacy, &target).unwrap();

		assert!(target.join("Longbox.toml").exists());
		assert!(!target.join("Stump.toml").exists());
		assert_eq!(
			std::fs::read_to_string(target.join("Longbox.toml")).unwrap(),
			"stranded"
		);
	}

	#[test]
	fn migrate_legacy_dir_is_noop_when_legacy_absent() {
		let tmp = tempdir().unwrap();
		let legacy = tmp.path().join(".stump");
		let target = tmp.path().join(".longbox");

		migrate_legacy_dir(&legacy, &target).unwrap();

		assert!(!target.exists());
	}

	#[test]
	fn migrate_legacy_db_renames_db_and_wal_shm_sidecars() {
		// Exercises a plain directory, standing in for a custom `db_path` dir that
		// lives outside the config directory (the same function is used for both).
		let tmp = tempdir().unwrap();
		std::fs::write(tmp.path().join("stump.db"), "db").unwrap();
		std::fs::write(tmp.path().join("stump.db-wal"), "wal").unwrap();
		std::fs::write(tmp.path().join("stump.db-shm"), "shm").unwrap();

		migrate_legacy_db(tmp.path());

		assert!(tmp.path().join("longbox.db").exists());
		assert!(tmp.path().join("longbox.db-wal").exists());
		assert!(tmp.path().join("longbox.db-shm").exists());
		assert!(!tmp.path().join("stump.db").exists());
		assert!(!tmp.path().join("stump.db-wal").exists());
		assert!(!tmp.path().join("stump.db-shm").exists());
	}

	#[test]
	fn migrate_legacy_db_does_not_clobber_existing_longbox_db() {
		let tmp = tempdir().unwrap();
		std::fs::write(tmp.path().join("stump.db"), "legacy-data").unwrap();
		std::fs::write(tmp.path().join("longbox.db"), "existing-data").unwrap();

		migrate_legacy_db(tmp.path());

		// legacy left in place, target untouched
		assert!(tmp.path().join("stump.db").exists());
		assert_eq!(
			std::fs::read_to_string(tmp.path().join("longbox.db")).unwrap(),
			"existing-data"
		);
		assert_eq!(
			std::fs::read_to_string(tmp.path().join("stump.db")).unwrap(),
			"legacy-data"
		);
	}
}
