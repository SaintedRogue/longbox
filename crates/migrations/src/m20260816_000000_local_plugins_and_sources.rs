use sea_orm_migration::prelude::*;

/// Let a plugin live in a directory on the server and be run by Longbox itself, and let
/// plugins be discovered from a catalogue rather than typed in by hand.
///
/// v1 assumed the operator ran the plugin as a separate service and pasted its URL in. That
/// is a lot of ceremony for a single-container deployment, so a plugin may now instead be a
/// directory under `{config_dir}/plugins/<slug>/` that Longbox launches as a child process
/// and talks to over loopback. `/config` is the persistent bind, so an installed plugin
/// survives a container update and can be dropped in over the same share as everything else.
///
/// **The wire protocol is untouched.** A local plugin serves exactly the same v1 endpoints;
/// only the address changes, and it is Longbox that assigns it. Everything downstream —
/// capability discovery, the config form, the token, the sweep — is unaware of the
/// difference. That is what keeps this additive rather than a second plugin system.
///
/// Every statement is additive and repeat-safe: `ADD COLUMN` guarded by a `has_column`
/// check, `CREATE TABLE IF NOT EXISTS`. No table is rebuilt, for the reason recorded in
/// `m20260815_020000_calendar_all_releases`.
#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
	async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
		let db = manager.get_connection();

		// How Longbox reaches this plugin: `remote` = a service the operator runs and gave
		// us a URL for; `local` = a directory here that we launch. Defaulting to `remote`
		// is what makes this a no-op for plugins registered before the column existed.
		if !manager.has_column("plugins", "kind").await? {
			db.execute_unprepared(
				"ALTER TABLE plugins ADD COLUMN kind TEXT NOT NULL DEFAULT 'remote';",
			)
			.await?;
		}

		// Directory name under `{config_dir}/plugins`, for `local` plugins only. Stored
		// rather than derived from the slug so a future rename cannot strand the files.
		if !manager.has_column("plugins", "install_dir").await? {
			db.execute_unprepared("ALTER TABLE plugins ADD COLUMN install_dir TEXT;")
				.await?;
		}

		// Where the installed files came from, so the UI can offer a reinstall and say what
		// it would be reinstalling. NULL for a plugin the operator placed by hand.
		if !manager.has_column("plugins", "source_url").await? {
			db.execute_unprepared("ALTER TABLE plugins ADD COLUMN source_url TEXT;")
				.await?;
		}

		// A catalogue of installable plugins: one row per index the operator trusts.
		db.execute_unprepared(
			r#"
			CREATE TABLE IF NOT EXISTS plugin_sources (
				id              INTEGER PRIMARY KEY AUTOINCREMENT,
				-- URL of a JSON index listing plugins. Fetched on demand, never on a timer:
				-- a catalogue refresh is a thing the operator asks for.
				url             TEXT NOT NULL,
				-- Display name, taken from the index once fetched and falling back to the
				-- host so a source that has never been reached is still identifiable.
				name            TEXT,
				enabled         BOOLEAN NOT NULL DEFAULT true,
				-- Snapshot of the last successful fetch, so the catalogue renders without
				-- reaching out again and still works while the source is down.
				catalogue       TEXT,
				last_fetched_at TIMESTAMP,
				last_error      TEXT,
				created_at      TIMESTAMP NOT NULL
			);
			"#,
		)
		.await?;

		db.execute_unprepared(
			r#"
			CREATE UNIQUE INDEX IF NOT EXISTS ux_plugin_sources_url
				ON plugin_sources (url);
			"#,
		)
		.await?;

		Ok(())
	}

	async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
		let db = manager.get_connection();
		db.execute_unprepared("DROP TABLE IF EXISTS plugin_sources;")
			.await?;
		// The added columns are left in place: dropping a column is a table rebuild, which
		// is the one thing these migrations do not do, and an unused column costs nothing.
		Ok(())
	}
}
