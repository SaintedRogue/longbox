use sea_orm_migration::prelude::*;

/// Hold **every** release a provider reports, not only the ones that bind to a series
/// already in the library.
///
/// The calendar answers two different questions and previously could only answer one. "What
/// is coming out?" is not a question about your library — you cannot discover a series you
/// do not own from a calendar that only lists series you do — yet the sweep dropped every
/// release it could not resolve to a local series, so the second question had no data
/// behind it at all. Matching is now an *enrichment* of a release rather than the price of
/// admission for storing one.
///
/// That requires a nullable `series_id`, which SQLite cannot produce by altering the old
/// `expected_issues` table in place. The obvious move — build a replacement, drop the
/// original, rename over it — is the one thing this migration must not do, and the reason
/// is worth recording because it is not obvious:
///
/// **Migrations here can run concurrently.** rustdoc executes doctests as parallel
/// processes and several of them open the same development database, so two runners can
/// enter the same migration at once. Every other migration in this tree survives that
/// because `CREATE ... IF NOT EXISTS` is *convergent*: whatever the interleaving, all
/// orderings arrive at the same state. A drop-and-rename rebuild is not convergent — two
/// runners cannot both rename onto one name, and cleaning up a "leftover" scratch table
/// may delete the other runner's work in progress. An earlier version of this migration
/// did exactly that and wedged the schema half-way, which on a forward-only chain means a
/// server that cannot boot.
///
/// So this creates a differently-named table and drains the old ones into it. Every
/// statement is individually idempotent and the whole is convergent under concurrency:
/// `CREATE TABLE/INDEX IF NOT EXISTS`, `INSERT OR IGNORE` against a unique key, and
/// `DROP TABLE IF EXISTS`. No name is ever momentarily missing, so there is no window for
/// a second runner to fall into.
#[derive(DeriveMigrationName)]
pub struct Migration;

/// The legacy tables drained into `release_calendar_entries`.
///
/// `expected_issues` is the original. `expected_issues_new` is the scratch table left
/// behind by the withdrawn rebuild described above — it only exists on databases that ran
/// that version, and draining it is what repairs them.
const LEGACY_TABLES: [&str; 2] = ["expected_issues", "expected_issues_new"];

#[async_trait::async_trait]
impl MigrationTrait for Migration {
	async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
		let db = manager.get_connection();

		db.execute_unprepared(
			r#"
			CREATE TABLE IF NOT EXISTS release_calendar_entries (
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

		// (provider, external_id) is the issue's true identity. The old table keyed on
		// (series_id, provider, external_id), which only made sense while series_id was
		// mandatory: SQLite treats NULLs as distinct in a unique index, so keeping it in
		// the key would let one issue exist once unbound and again bound, and the row
		// could never upgrade in place as its series became known.
		db.execute_unprepared(
			r#"
			CREATE UNIQUE INDEX IF NOT EXISTS ux_rce_identity
				ON release_calendar_entries (provider, external_id);
			"#,
		)
		.await?;
		db.execute_unprepared(
			r#"
			CREATE INDEX IF NOT EXISTS idx_rce_release_date
				ON release_calendar_entries (release_date);
			"#,
		)
		.await?;
		// The calendar's library-scoped reads filter on series_id; partial because the
		// column is mostly NULL and those rows are never looked up this way.
		db.execute_unprepared(
			r#"
			CREATE INDEX IF NOT EXISTS idx_rce_series
				ON release_calendar_entries (series_id)
				WHERE series_id IS NOT NULL;
			"#,
		)
		.await?;
		// The bind-on-later-sweep join: given a provider's series id, find its releases.
		db.execute_unprepared(
			r#"
			CREATE INDEX IF NOT EXISTS idx_rce_provider_series
				ON release_calendar_entries (provider, series_external_id);
			"#,
		)
		.await?;

		for table in LEGACY_TABLES {
			drain_legacy_table(manager, table).await?;
		}

		Ok(())
	}

	async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
		let db = manager.get_connection();

		db.execute_unprepared(
			r#"
			CREATE TABLE IF NOT EXISTS expected_issues (
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
		db.execute_unprepared(
			r#"
			CREATE UNIQUE INDEX IF NOT EXISTS idx_ei_identity
				ON expected_issues (series_id, provider, external_id);
			"#,
		)
		.await?;
		db.execute_unprepared(
			r#"
			CREATE INDEX IF NOT EXISTS idx_ei_release_date
				ON expected_issues (release_date);
			"#,
		)
		.await?;
		// Unbound releases have no representation in the old shape and are dropped. The
		// next sweep re-fetches them, so this loses cache rather than knowledge.
		db.execute_unprepared(
			r#"
			INSERT OR IGNORE INTO expected_issues
				(series_id, provider, external_id, number, title, cover_url,
				 release_date, created_at)
			SELECT series_id, provider, external_id, number, title, cover_url,
			       release_date, created_at
			  FROM release_calendar_entries
			 WHERE series_id IS NOT NULL;
			"#,
		)
		.await?;
		db.execute_unprepared("DROP TABLE IF EXISTS release_calendar_entries;")
			.await?;

		Ok(())
	}
}

/// Move one legacy table's rows into `release_calendar_entries` and drop it.
///
/// A no-op when the table is absent, which is the normal case for a fresh database and
/// also what a concurrent runner leaves behind once it has finished the same work.
///
/// `id` is deliberately not carried over: two source tables can hold the same id, and the
/// row's identity is `(provider, external_id)` rather than its rowid. Letting the new table
/// assign ids keeps the drain order-independent.
async fn drain_legacy_table(
	manager: &SchemaManager<'_>,
	table: &str,
) -> Result<(), DbErr> {
	if !manager.has_table(table).await? {
		return Ok(());
	}

	// A series_id that no longer resolves is carried over as NULL rather than as-is.
	//
	// The old column was `NOT NULL REFERENCES series(id)`, so an orphan should be
	// impossible — but foreign keys are enforced per-connection in SQLite and are not
	// checked retroactively, so "should be impossible" is not something a migration may
	// rely on. Inserting one would abort the drain, leave this migration unrecorded, and
	// fail again identically on every retry: a server permanently unable to start over a
	// row nobody can see. Downgrading it costs nothing, because a release whose series is
	// gone is precisely what the new nullable column exists to represent.
	let series_id = "CASE WHEN series_id IN (SELECT id FROM series) THEN series_id END";

	// The withdrawn rebuild's scratch table already carries the new columns; the original
	// does not. Reading the schema rather than assuming keeps one drain correct for both.
	let rest = if manager.has_column(table, "series_name").await? {
		"series_name, series_external_id, provider, external_id, number, title, \
		 cover_url, release_date, created_at"
	} else {
		"provider, external_id, number, title, cover_url, release_date, created_at"
	};

	manager
		.get_connection()
		.execute_unprepared(&format!(
			"INSERT OR IGNORE INTO release_calendar_entries (series_id, {rest}) \
			 SELECT {series_id}, {rest} FROM {table} ORDER BY id;"
		))
		.await?;
	manager
		.get_connection()
		.execute_unprepared(&format!("DROP TABLE IF EXISTS {table};"))
		.await?;

	Ok(())
}
