use sea_orm_migration::prelude::*;

/// Lets a book hold metadata from **several** providers at once, so a source can enrich
/// what another already matched instead of competing for one slot.
///
/// Before this, `media_metadata` had a single `metadata_source` /
/// `metadata_external_id` pair (plus the ad-hoc `comicvine_id` and `metron_id`
/// columns). The moment a book matched ComicVine it could not also remember its LOCG
/// id — which blocked enrichment *and* the LOCG release calendar, since that joins on a
/// stored provider id.
///
/// Two tables:
///
/// - `external_metadata_link` — one row per (entity, provider): the id, the captured
///   payload, and whether it is merely a candidate or the accepted link. This doubles as
///   the link table two-way sync will need.
/// - `metadata_field_source` — one row per (entity, field): which source won that field,
///   so a hand-picked value is attributable and re-fetch cannot quietly undo it.
///
/// Both are created with raw SQL rather than the schema builder. The `CHECK` that
/// exactly one of `media_id`/`series_id` is set cannot be added to an existing SQLite
/// table, and the unique indexes have to be *partial* (`WHERE media_id IS NOT NULL`)
/// because the other id is always NULL — a plain composite unique index over a nullable
/// column does not constrain anything in SQLite.
#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
	async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
		let db = manager.get_connection();

		// ---- the pool ------------------------------------------------------------
		db.execute_unprepared(
			r#"
			CREATE TABLE IF NOT EXISTS external_metadata_link (
				id            INTEGER PRIMARY KEY AUTOINCREMENT,
				media_id      TEXT REFERENCES media(id)  ON DELETE CASCADE,
				series_id     TEXT REFERENCES series(id) ON DELETE CASCADE,
				-- The provider's lowercase trait id ('comicvine', 'metron', 'locg'), or
				-- 'manual' for values the operator entered themselves.
				provider      TEXT NOT NULL,
				-- NULL for 'manual', which has no upstream record.
				external_id   TEXT,
				provider_url  TEXT,
				-- The provider's full field bag as JSON. NULL is meaningful: a row
				-- backfilled from the old single-source columns records that the link
				-- exists without claiming to hold the data, because the original
				-- response was never kept.
				payload       TEXT,
				confidence    REAL,
				-- 'candidate' = stored so it can be compared, not applied.
				-- 'linked'    = the accepted match for this provider.
				-- 'rejected'  = the operator said no; kept so it is not re-offered.
				state         TEXT NOT NULL DEFAULT 'candidate',
				-- 'auto' | 'user' | 'backfill'. 'backfill' marks a link recovered from
				-- the pre-existing columns, where who chose it is genuinely unknown.
				chosen_by     TEXT,
				fetched_at    TIMESTAMP NOT NULL,
				refreshed_at  TIMESTAMP,
				CHECK ((media_id IS NULL) <> (series_id IS NULL))
			);
			"#,
		)
		.await?;

		// One row per provider per entity. Partial, because the unused id is NULL and
		// SQLite treats NULLs as distinct — a non-partial index would allow duplicates.
		db.execute_unprepared(
			r#"
			CREATE UNIQUE INDEX IF NOT EXISTS ux_eml_media_provider
				ON external_metadata_link (media_id, provider)
				WHERE media_id IS NOT NULL;
			"#,
		)
		.await?;
		db.execute_unprepared(
			r#"
			CREATE UNIQUE INDEX IF NOT EXISTS ux_eml_series_provider
				ON external_metadata_link (series_id, provider)
				WHERE series_id IS NOT NULL;
			"#,
		)
		.await?;
		// The release calendar's join: given a provider's id for a series, find ours.
		db.execute_unprepared(
			r#"
			CREATE INDEX IF NOT EXISTS idx_eml_provider_external
				ON external_metadata_link (provider, external_id);
			"#,
		)
		.await?;

		// ---- field provenance ----------------------------------------------------
		db.execute_unprepared(
			r#"
			CREATE TABLE IF NOT EXISTS metadata_field_source (
				id                 INTEGER PRIMARY KEY AUTOINCREMENT,
				media_id           TEXT REFERENCES media(id)  ON DELETE CASCADE,
				series_id          TEXT REFERENCES series(id) ON DELETE CASCADE,
				-- A `MetadataField` in its serde form, e.g. 'PAGE_COUNT' -- the same
				-- spelling `media_metadata.locked_fields` stores.
				field              TEXT NOT NULL,
				-- Provider trait id, or 'manual'.
				source_provider    TEXT NOT NULL,
				source_external_id TEXT,
				-- 'auto' | 'user'. A user-chosen field is also added to
				-- `media_metadata.locked_fields` so a later fetch cannot overwrite it.
				chosen_by          TEXT NOT NULL,
				applied_at         TIMESTAMP NOT NULL,
				CHECK ((media_id IS NULL) <> (series_id IS NULL))
			);
			"#,
		)
		.await?;
		db.execute_unprepared(
			r#"
			CREATE UNIQUE INDEX IF NOT EXISTS ux_mfs_media_field
				ON metadata_field_source (media_id, field)
				WHERE media_id IS NOT NULL;
			"#,
		)
		.await?;
		db.execute_unprepared(
			r#"
			CREATE UNIQUE INDEX IF NOT EXISTS ux_mfs_series_field
				ON metadata_field_source (series_id, field)
				WHERE series_id IS NOT NULL;
			"#,
		)
		.await?;
		// "What has this provider contributed across the library?"
		db.execute_unprepared(
			r#"
			CREATE INDEX IF NOT EXISTS idx_mfs_source_provider
				ON metadata_field_source (source_provider);
			"#,
		)
		.await?;

		// ---- the library-level backfill switch -----------------------------------
		manager
			.alter_table(
				Table::alter()
					.table(LibraryConfigs::Table)
					.add_column(
						ColumnDef::new(LibraryConfigs::MetadataBackfillProviders)
							.boolean()
							.not_null()
							.default(false),
					)
					.to_owned(),
			)
			.await?;

		// ---- recover the links that already exist --------------------------------
		// Order matters: the generic `metadata_source` pair is the authoritative record
		// of what was applied, so it goes first and the ad-hoc id columns only fill
		// providers it did not already cover (INSERT OR IGNORE against the unique
		// index). `state = 'linked'` because these were applied; `chosen_by =
		// 'backfill'` because whether a human picked them was never recorded.
		db.execute_unprepared(
			r#"
			INSERT OR IGNORE INTO external_metadata_link
				(media_id, provider, external_id, state, chosen_by, fetched_at)
			SELECT media_id, LOWER(metadata_source), metadata_external_id,
			       'linked', 'backfill', CURRENT_TIMESTAMP
			  FROM media_metadata
			 WHERE media_id IS NOT NULL
			   AND metadata_source IS NOT NULL
			   AND metadata_external_id IS NOT NULL;
			"#,
		)
		.await?;
		db.execute_unprepared(
			r#"
			INSERT OR IGNORE INTO external_metadata_link
				(series_id, provider, external_id, state, chosen_by, fetched_at)
			SELECT series_id, LOWER(metadata_source), metadata_external_id,
			       'linked', 'backfill', CURRENT_TIMESTAMP
			  FROM series_metadata
			 WHERE metadata_source IS NOT NULL
			   AND metadata_external_id IS NOT NULL;
			"#,
		)
		.await?;
		db.execute_unprepared(
			r#"
			INSERT OR IGNORE INTO external_metadata_link
				(media_id, provider, external_id, state, chosen_by, fetched_at)
			SELECT media_id, 'comicvine', comicvine_id,
			       'linked', 'backfill', CURRENT_TIMESTAMP
			  FROM media_metadata
			 WHERE media_id IS NOT NULL AND comicvine_id IS NOT NULL;
			"#,
		)
		.await?;
		db.execute_unprepared(
			r#"
			INSERT OR IGNORE INTO external_metadata_link
				(media_id, provider, external_id, state, chosen_by, fetched_at)
			SELECT media_id, 'metron', metron_id,
			       'linked', 'backfill', CURRENT_TIMESTAMP
			  FROM media_metadata
			 WHERE media_id IS NOT NULL AND metron_id IS NOT NULL;
			"#,
		)
		.await?;

		Ok(())
	}

	async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
		let db = manager.get_connection();
		db.execute_unprepared("DROP TABLE IF EXISTS metadata_field_source;")
			.await?;
		db.execute_unprepared("DROP TABLE IF EXISTS external_metadata_link;")
			.await?;

		manager
			.alter_table(
				Table::alter()
					.table(LibraryConfigs::Table)
					.drop_column(LibraryConfigs::MetadataBackfillProviders)
					.to_owned(),
			)
			.await?;

		Ok(())
	}
}

#[derive(DeriveIden)]
enum LibraryConfigs {
	Table,
	MetadataBackfillProviders,
}
