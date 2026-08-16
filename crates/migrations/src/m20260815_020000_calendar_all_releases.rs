use sea_orm_migration::prelude::*;

/// Let `expected_issues` hold **every** release a provider reports, not only the ones that
/// bind to a series already in the library.
///
/// The calendar answers two different questions and previously could only answer one. "What
/// is coming out?" is not a question about your library — you cannot discover a series you
/// do not own from a calendar that only lists series you do — yet the sweep dropped every
/// release it could not resolve to a local series, so the second question had no data
/// behind it at all. Matching is now an *enrichment* of a release rather than the price of
/// admission for storing one.
///
/// Three changes, all of which force a table rebuild because SQLite cannot relax a
/// `NOT NULL`, change a unique index, or drop a foreign key in place:
///
/// - `series_id` becomes nullable — NULL means "no series in this library corresponds to
///   this release", which is the normal case for most of what a provider reports.
/// - `series_name` / `series_external_id` are added, so an unbound release still has
///   something to display and something to bind *by* on a later sweep, once the series is
///   matched or added.
/// - The unique key moves from `(series_id, provider, external_id)` to
///   `(provider, external_id)`. This is not cosmetic: SQLite treats NULLs as distinct in a
///   unique index, so keeping `series_id` in the key would let one provider issue exist
///   once unbound and again bound, and the row could never upgrade in place. `(provider,
///   external_id)` is also the issue's true identity — the series was only ever in the key
///   because it happened to be mandatory.
#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
	async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
		let db = manager.get_connection();

		// Already rebuilt — nothing to do.
		//
		// A table rebuild is re-entered far more often than the happy path suggests: a run
		// that dies partway leaves the DDL committed (SQLite does not roll these back for
		// us here), and two processes can open the same database at once. A rebuild that
		// is not idempotent wedges the schema half-way with no way forward, which for a
		// forward-only migration chain means an unbootable server. So every step below is
		// written to be safe to repeat, and to repair the half-finished state rather than
		// trip over it.
		let already_rebuilt = manager.has_table("expected_issues").await?
			&& manager.has_column("expected_issues", "series_name").await?;
		if already_rebuilt {
			return Ok(());
		}

		// Discard any half-finished attempt, along with its indexes, so the create below
		// starts from a known state.
		db.execute_unprepared("DROP TABLE IF EXISTS expected_issues_new;")
			.await?;

		db.execute_unprepared(
			r#"
			CREATE TABLE expected_issues_new (
				id                 INTEGER PRIMARY KEY AUTOINCREMENT,
				-- NULL when no series in this library corresponds to the release.
				series_id          TEXT REFERENCES series(id) ON DELETE CASCADE,
				-- The provider's own name for the series. The only label an unbound
				-- release has; ignored for display once series_id is set, because the
				-- library's name for a series is the one the user chose.
				series_name        TEXT,
				-- The provider's series id, kept so a later sweep can bind this row once
				-- the series is matched, without having to re-fetch the window.
				series_external_id TEXT,
				provider           TEXT NOT NULL,
				external_id        TEXT NOT NULL,
				number             TEXT,
				title              TEXT,
				cover_url          TEXT,
				release_date       TEXT,
				created_at         TIMESTAMP NOT NULL
			);
			"#,
		)
		.await?;

		// Created before the copy so `INSERT OR IGNORE` below resolves any pre-existing
		// rows that shared a (provider, external_id) across two series — impossible to rule
		// out under the old key, and a hard failure if it surfaced mid-migration.
		db.execute_unprepared(
			r#"
			CREATE UNIQUE INDEX IF NOT EXISTS ux_ei_identity
				ON expected_issues_new (provider, external_id);
			"#,
		)
		.await?;

		// Guarded, because a half-finished earlier attempt may already have dropped the
		// source table. Its absence means the copy is done, not that something is wrong.
		if manager.has_table("expected_issues").await? {
			// `ORDER BY id` makes the survivor of any such collision the oldest row, so
			// the choice is deterministic rather than dependent on scan order.
			db.execute_unprepared(
				r#"
				INSERT OR IGNORE INTO expected_issues_new
					(id, series_id, provider, external_id, number, title, cover_url,
					 release_date, created_at)
				SELECT id, series_id, provider, external_id, number, title, cover_url,
				       release_date, created_at
				  FROM expected_issues
				 ORDER BY id;
				"#,
			)
			.await?;

			// Drops the old table's indexes with it, freeing `idx_ei_release_date` to be
			// recreated below under the same name, and freeing the name for the rename.
			db.execute_unprepared("DROP TABLE expected_issues;").await?;
		}

		db.execute_unprepared(
			"ALTER TABLE expected_issues_new RENAME TO expected_issues;",
		)
		.await?;

		db.execute_unprepared(
			r#"
			CREATE INDEX IF NOT EXISTS idx_ei_release_date
				ON expected_issues (release_date);
			"#,
		)
		.await?;
		// The calendar's library-scoped reads filter on series_id; partial because the
		// column is now mostly NULL and those rows are never looked up this way.
		db.execute_unprepared(
			r#"
			CREATE INDEX IF NOT EXISTS idx_ei_series ON expected_issues (series_id)
				WHERE series_id IS NOT NULL;
			"#,
		)
		.await?;
		// The bind-on-later-sweep join: given a provider's series id, find its releases.
		db.execute_unprepared(
			r#"
			CREATE INDEX IF NOT EXISTS idx_ei_provider_series ON expected_issues
				(provider, series_external_id);
			"#,
		)
		.await?;

		Ok(())
	}

	async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
		let db = manager.get_connection();

		db.execute_unprepared(
			r#"
			CREATE TABLE expected_issues_old (
				id           INTEGER PRIMARY KEY AUTOINCREMENT,
				series_id    TEXT NOT NULL REFERENCES series(id) ON DELETE CASCADE,
				provider     TEXT NOT NULL,
				external_id  TEXT NOT NULL,
				number       TEXT,
				title        TEXT,
				cover_url    TEXT,
				release_date TEXT,
				created_at   TIMESTAMP NOT NULL
			);
			"#,
		)
		.await?;
		// Unbound releases have no representation in the old shape and are dropped. The
		// next sweep re-fetches them, so this loses cache rather than knowledge.
		db.execute_unprepared(
			r#"
			INSERT INTO expected_issues_old
				(id, series_id, provider, external_id, number, title, cover_url,
				 release_date, created_at)
			SELECT id, series_id, provider, external_id, number, title, cover_url,
			       release_date, created_at
			  FROM expected_issues
			 WHERE series_id IS NOT NULL;
			"#,
		)
		.await?;
		db.execute_unprepared("DROP TABLE expected_issues;").await?;
		db.execute_unprepared(
			"ALTER TABLE expected_issues_old RENAME TO expected_issues;",
		)
		.await?;
		db.execute_unprepared(
			r#"
			CREATE UNIQUE INDEX idx_ei_identity
				ON expected_issues (series_id, provider, external_id);
			"#,
		)
		.await?;
		db.execute_unprepared(
			"CREATE INDEX idx_ei_release_date ON expected_issues (release_date);",
		)
		.await?;

		Ok(())
	}
}
