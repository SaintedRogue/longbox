use sea_orm_migration::prelude::*;

/// The download queue: what Longbox has been asked to fetch, and how far it got.
///
/// A row is created when a candidate is chosen — by a person in the UI, or by the
/// pull-list pass when auto-grab is on — and it outlives the process, which is the point.
/// Downloads are long, a server restart is ordinary, and a queue held in memory would lose
/// its contents exactly when it matters.
///
/// `status` is stored as text rather than a `DeriveActiveEnum` so an unrecognised value
/// read from a newer build degrades to "not one I act on" instead of failing the query
/// that loaded it.
///
/// Additive only — `CREATE TABLE IF NOT EXISTS`, no rebuild — for the reason recorded in
/// `m20260815_020000_calendar_all_releases`.
#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
	async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
		let db = manager.get_connection();

		db.execute_unprepared(
			r#"
			CREATE TABLE IF NOT EXISTS download_queue (
				id             INTEGER PRIMARY KEY AUTOINCREMENT,
				-- The series this is wanted for. Nullable because a download can be for
				-- something the library does not have yet, which is the case that makes
				-- searching worth doing at all.
				series_id      TEXT REFERENCES series(id) ON DELETE SET NULL,
				-- Set once the finished file has been imported, so a queue row can be
				-- traced to the book it became.
				media_id       TEXT REFERENCES media(id) ON DELETE SET NULL,
				-- Which plugin offered this, and its own opaque handle for the file.
				-- Resolving has to go back to the same plugin: the id means nothing to us
				-- and nothing to any other plugin.
				plugin_slug    TEXT NOT NULL,
				download_id    TEXT NOT NULL,
				-- Display fields, captured at search time so the queue still reads sensibly
				-- when the plugin that produced it is disabled or gone.
				title          TEXT NOT NULL,
				source         TEXT,
				number         TEXT,
				format         TEXT,
				size_bytes     INTEGER,
				-- pending | approved | downloading | completed | failed | cancelled.
				-- `pending` is the default because approving a download is a decision, and
				-- auto-grab is the opt-in that skips it.
				status         TEXT NOT NULL DEFAULT 'pending',
				progress_bytes INTEGER NOT NULL DEFAULT 0,
				-- Where the partial file is being written. Kept so an interrupted download
				-- can be cleaned up on the next boot rather than left to occupy the disk.
				staging_path   TEXT,
				error          TEXT,
				created_at     TIMESTAMP NOT NULL,
				updated_at     TIMESTAMP
			);
			"#,
		)
		.await?;

		// One row per offered file. Re-running a search must update what it already knows
		// about a candidate rather than stack up duplicates of it.
		db.execute_unprepared(
			r#"
			CREATE UNIQUE INDEX IF NOT EXISTS ux_dq_identity
				ON download_queue (plugin_slug, download_id);
			"#,
		)
		.await?;
		// The worker's own question: what is waiting to be done?
		db.execute_unprepared(
			r#"
			CREATE INDEX IF NOT EXISTS idx_dq_status ON download_queue (status);
			"#,
		)
		.await?;
		// "What is queued for this series?", for the series page and the wanted check.
		db.execute_unprepared(
			r#"
			CREATE INDEX IF NOT EXISTS idx_dq_series ON download_queue (series_id)
				WHERE series_id IS NOT NULL;
			"#,
		)
		.await?;

		Ok(())
	}

	async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
		manager
			.get_connection()
			.execute_unprepared("DROP TABLE IF EXISTS download_queue;")
			.await?;
		Ok(())
	}
}
