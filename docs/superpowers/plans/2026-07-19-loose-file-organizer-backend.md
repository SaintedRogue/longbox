# Loose-File Organizer (Backend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect misfiled loose comic files, confirm each file's canonical series via the metadata provider (volume ID), move it into a `Name (Year)/` folder, and re-point its media record while preserving read progress — exposed as a manual plan/apply flow plus an opt-in auto-on-scan path.

**Architecture:** A new `core/src/filesystem/organizer/` module holds pure, unit-testable logic (path sanitization, candidate detection, filename grouping, confidence bucketing) plus DB/provider-aware `build_plan`/`apply_plan` functions. A new `LongboxJob::OrganizeLooseFiles` job (modes: `Plan`, `Apply`, `AutoScan`) runs that logic in the background, persisting the preview to an `organize_plan_record` row that the UI queries. The library scan job enqueues an `AutoScan` run when the library opts in.

**Tech Stack:** Rust, SeaORM 1.1 + SQLite, apalis jobs, async-graphql 7.2, `metadata_integrations` crate, `walkdir`, `globset`, `tempfile` (tests).

**Spec:** `docs/superpowers/specs/2026-07-19-loose-file-organizer-design.md`

**Scope:** This is the backend plan (Plan 1 of 2). Frontend preview/apply UI is a separate plan written after this GraphQL surface exists.

## Global Constraints

- **Deps come from the root `[workspace.dependencies]`** in `Cargo.toml` (alphabetical). Reuse `walkdir`, `globset`, `tempfile`, `serde`, `sea-orm`, `async-graphql`, `metadata_integrations` — all already present; do not add new crates.
- **`cargo clippy -- -D warnings` is a CI gate** — no warnings. **`cargo fmt --all -- --check`** — tabs, run `cargo fmt --all` before every commit.
- **GraphQL schema drift is a CI gate.** After any GraphQL change: `cargo dump-schema` (regenerates `crates/graphql/schema.graphql`) then `yarn workspace @longbox/graphql codegen` (regenerates `packages/graphql/src/client/`); commit both.
- **Series/media IDs are UUID v4 strings** auto-assigned in `ActiveModelBehavior::before_save` on insert — never set them manually.
- **`media.series_id` is `Option<String>`**; `media.path` is a non-null `String`.
- **Provider match `confidence` is 0.0–1.0**; realistic series-search values: exact title `0.90`, alt-title `0.80`, fuzzy `0.0–0.75`.
- **Never move a file we can't confidently place; never overwrite; update `media.path`+`series_id` transactionally with any series creation** (blind rescan would orphan read progress).
- Run the `ci-preflight` skill (`.claude/skills/ci-preflight/scripts/preflight.sh`) before the final push.

## File Structure

**Create:**

- `crates/migrations/src/m20260719_000000_add_auto_organize_loose_files.rs` — config column
- `crates/migrations/src/m20260719_000100_add_organize_plan_record.rs` — preview record table
- `crates/models/src/entity/organize_plan_record.rs` — record entity
- `core/src/filesystem/organizer/mod.rs` — module root + re-exports
- `core/src/filesystem/organizer/paths.rs` — folder-name sanitization + destination path
- `core/src/filesystem/organizer/confirm.rs` — normalize/group/bucket + provider search + confirm
- `core/src/filesystem/organizer/candidates.rs` — pattern-aware candidate detection
- `core/src/filesystem/organizer/plan.rs` — `OrganizePlan` types + `build_plan`
- `core/src/filesystem/organizer/apply.rs` — `apply_plan` (move + reconcile)
- `core/src/filesystem/organizer/organize_job.rs` — `OrganizeLooseFilesJob`
- `crates/graphql/src/input/organize.rs` — `OrganizeDecisionInput`
- `crates/graphql/src/object/organize.rs` — GraphQL output objects for the preview
- `crates/graphql/src/mutation/organize.rs` — plan/apply mutations
- `crates/graphql/src/query/organize.rs` — `organizePreview` query

**Modify:**

- `crates/models/src/entity/library_config.rs` — add `auto_organize_loose_files` field + default
- `crates/models/src/entity/mod.rs` — register `organize_plan_record`
- `crates/migrations/src/lib.rs` — register both migrations
- `core/src/filesystem/mod.rs` — `pub mod organizer;`
- `core/src/job/longbox_job.rs` — new variant + name/description + constructor
- `core/src/job/output.rs` — `CoreJobOutput::OrganizeLooseFiles` variant
- `core/src/job/run.rs` — dispatch arm + import
- `core/src/filesystem/scanner/library_scan_job.rs` — auto-on-scan enqueue
- `crates/graphql/src/input/mod.rs`, `object/mod.rs`, `mutation/mod.rs`, `query/mod.rs` — register modules
- `crates/graphql/src/input/library.rs` — expose `auto_organize_loose_files` in config input/output

---

### Task 1: Config column `auto_organize_loose_files`

**Files:**

- Create: `crates/migrations/src/m20260719_000000_add_auto_organize_loose_files.rs`
- Modify: `crates/migrations/src/lib.rs`
- Modify: `crates/models/src/entity/library_config.rs`

**Interfaces:**

- Produces: `library_config::Model.auto_organize_loose_files: bool` (default `false`), read by `build_plan`, the scan job, and the GraphQL config types.

- [ ] **Step 1: Write the migration file**

Create `crates/migrations/src/m20260719_000000_add_auto_organize_loose_files.rs`:

```rust
use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
	async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
		manager
			.alter_table(
				Table::alter()
					.table(LibraryConfigs::Table)
					.add_column(
						ColumnDef::new(LibraryConfigs::AutoOrganizeLooseFiles)
							.boolean()
							.not_null()
							.default(false),
					)
					.to_owned(),
			)
			.await
	}

	async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
		manager
			.alter_table(
				Table::alter()
					.table(LibraryConfigs::Table)
					.drop_column(LibraryConfigs::AutoOrganizeLooseFiles)
					.to_owned(),
			)
			.await
	}
}

#[derive(DeriveIden)]
enum LibraryConfigs {
	Table,
	AutoOrganizeLooseFiles,
}
```

- [ ] **Step 2: Register the migration in `lib.rs`**

In `crates/migrations/src/lib.rs`, add the module declaration after the last existing `mod m20260718_...;` line:

```rust
mod m20260719_000000_add_auto_organize_loose_files;
```

And append to the `vec![...]` in `migrations()` as the last element:

```rust
			Box::new(m20260719_000000_add_auto_organize_loose_files::Migration),
```

- [ ] **Step 3: Add the entity field + default**

In `crates/models/src/entity/library_config.rs`, add to the `Model` struct after the `process_thumbnail_colors_even_without_config` field (follow the existing `#[sea_orm(default_value = "false")]` boolean pattern):

```rust
	#[sea_orm(default_value = "false")]
	pub auto_organize_loose_files: bool,
```

And in `ActiveModelBehavior::before_save`, add alongside the other `is_not_set()` guards:

```rust
		if self.auto_organize_loose_files.is_not_set() {
			self.auto_organize_loose_files = Set(false);
		}
```

- [ ] **Step 4: Verify it builds and migrates**

Run: `cargo build -p migrations -p models`
Expected: compiles.

Run: `cargo migrate`
Expected: applies the new migration with no error (adds the column to `library_configs`).

- [ ] **Step 5: Commit**

```bash
cargo fmt --all
git add crates/migrations crates/models
git commit -m "feat(organizer): add auto_organize_loose_files library config column"
```

---

### Task 2: `organize_plan_record` table + entity

Stores the latest computed preview per library so the async Plan job's result is queryable by the UI (mirrors the `metadata_fetch_record` pattern).

**Files:**

- Create: `crates/migrations/src/m20260719_000100_add_organize_plan_record.rs`
- Create: `crates/models/src/entity/organize_plan_record.rs`
- Modify: `crates/migrations/src/lib.rs`
- Modify: `crates/models/src/entity/mod.rs`

**Interfaces:**

- Produces: `organize_plan_record::{Entity, Model, ActiveModel, Column}` with columns `id: String (uuid pk)`, `library_id: String`, `status: String`, `plan_json: String (JSON)`, `created_at`, `updated_at`. Read by the `organizePreview` query; written by the Plan job.

- [ ] **Step 1: Write the migration**

Create `crates/migrations/src/m20260719_000100_add_organize_plan_record.rs`:

```rust
use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
	async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
		manager
			.create_table(
				Table::create()
					.table(OrganizePlanRecord::Table)
					.if_not_exists()
					.col(
						ColumnDef::new(OrganizePlanRecord::Id)
							.text()
							.not_null()
							.primary_key(),
					)
					.col(ColumnDef::new(OrganizePlanRecord::LibraryId).text().not_null())
					.col(ColumnDef::new(OrganizePlanRecord::Status).text().not_null())
					.col(ColumnDef::new(OrganizePlanRecord::PlanJson).text().not_null())
					.col(
						ColumnDef::new(OrganizePlanRecord::CreatedAt)
							.date_time()
							.not_null(),
					)
					.col(
						ColumnDef::new(OrganizePlanRecord::UpdatedAt)
							.date_time()
							.not_null(),
					)
					.foreign_key(
						ForeignKey::create()
							.name("fk_organize_plan_record_library")
							.from(OrganizePlanRecord::Table, OrganizePlanRecord::LibraryId)
							.to(Library::Table, Library::Id)
							.on_delete(ForeignKeyAction::Cascade),
					)
					.to_owned(),
			)
			.await?;

		manager
			.create_index(
				Index::create()
					.if_not_exists()
					.name("idx_organize_plan_record_library")
					.table(OrganizePlanRecord::Table)
					.col(OrganizePlanRecord::LibraryId)
					.to_owned(),
			)
			.await
	}

	async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
		manager
			.drop_table(Table::drop().table(OrganizePlanRecord::Table).to_owned())
			.await
	}
}

#[derive(DeriveIden)]
enum OrganizePlanRecord {
	Table,
	Id,
	LibraryId,
	Status,
	PlanJson,
	CreatedAt,
	UpdatedAt,
}

#[derive(DeriveIden)]
enum Library {
	Table,
	Id,
}
```

- [ ] **Step 2: Write the entity**

Create `crates/models/src/entity/organize_plan_record.rs`:

```rust
use sea_orm::entity::prelude::*;
use sea_orm::ActiveValue::Set;
use sea_orm::entity::prelude::async_trait::async_trait;
use uuid::Uuid;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "organize_plan_record")]
pub struct Model {
	#[sea_orm(primary_key, auto_increment = false, column_type = "Text")]
	pub id: String,
	#[sea_orm(column_type = "Text")]
	pub library_id: String,
	#[sea_orm(column_type = "Text")]
	pub status: String,
	#[sea_orm(column_type = "Text")]
	pub plan_json: String,
	#[sea_orm(column_type = "custom(\"DATETIME\")")]
	pub created_at: DateTimeWithTimeZone,
	#[sea_orm(column_type = "custom(\"DATETIME\")")]
	pub updated_at: DateTimeWithTimeZone,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
	#[sea_orm(
		belongs_to = "super::library::Entity",
		from = "Column::LibraryId",
		to = "super::library::Column::Id",
		on_delete = "Cascade"
	)]
	Library,
}

impl Related<super::library::Entity> for Entity {
	fn to() -> RelationDef {
		Relation::Library.def()
	}
}

#[async_trait]
impl ActiveModelBehavior for ActiveModel {
	async fn before_save<C>(mut self, _db: &C, insert: bool) -> Result<Self, DbErr>
	where
		C: ConnectionTrait,
	{
		let now = DateTimeWithTimeZone::from(chrono::Utc::now());
		if insert {
			if self.id.is_not_set() {
				self.id = Set(Uuid::new_v4().to_string());
			}
			self.created_at = Set(now);
		}
		self.updated_at = Set(now);
		Ok(self)
	}
}
```

Note: confirm `uuid` and `chrono` are already used by sibling entities (e.g. `series.rs` uses `Uuid::new_v4()`, `media.rs` uses `Utc::now()`); match their exact import paths if these differ.

- [ ] **Step 3: Register entity + migration**

In `crates/models/src/entity/mod.rs`, add (alphabetically, near other `pub mod` lines):

```rust
pub mod organize_plan_record;
```

In `crates/migrations/src/lib.rs`, add the module declaration:

```rust
mod m20260719_000100_add_organize_plan_record;
```

And append to the `vec![...]` after the Task 1 entry:

```rust
			Box::new(m20260719_000100_add_organize_plan_record::Migration),
```

- [ ] **Step 4: Verify**

Run: `cargo build -p migrations -p models`
Expected: compiles.

Run: `cargo migrate`
Expected: creates the `organize_plan_record` table.

- [ ] **Step 5: Commit**

```bash
cargo fmt --all
git add crates/migrations crates/models
git commit -m "feat(organizer): add organize_plan_record table + entity"
```

---

### Task 3: `organizer/paths.rs` — folder-name sanitization + destination path

**Files:**

- Create: `core/src/filesystem/organizer/paths.rs`
- Create: `core/src/filesystem/organizer/mod.rs` (initial)
- Modify: `core/src/filesystem/mod.rs`

**Interfaces:**

- Produces:
  - `sanitize_folder_name(name: &str) -> String`
  - `series_folder_name(canonical: &str, year: Option<i32>) -> String`
  - `destination_path(library_root: &Path, folder_name: &str, original_filename: &OsStr) -> PathBuf`

- [ ] **Step 1: Register the module**

In `core/src/filesystem/mod.rs`, add alongside the other `pub mod` lines:

```rust
pub mod organizer;
```

Create `core/src/filesystem/organizer/mod.rs`:

```rust
pub mod paths;
```

- [ ] **Step 2: Write the failing tests**

Create `core/src/filesystem/organizer/paths.rs`:

```rust
//! Filesystem-safe destination paths for organized comic files.

use std::ffi::OsStr;
use std::path::{Path, PathBuf};

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn sanitizes_illegal_characters_and_whitespace() {
		assert_eq!(sanitize_folder_name("Batman: Year   One"), "Batman Year One");
		assert_eq!(sanitize_folder_name("A/B\\C*?"), "A B C");
	}

	#[test]
	fn empty_name_falls_back() {
		assert_eq!(sanitize_folder_name("   "), "Unknown Series");
		assert_eq!(sanitize_folder_name("///"), "Unknown Series");
	}

	#[test]
	fn folder_name_includes_year_when_present() {
		assert_eq!(series_folder_name("Batman", Some(2016)), "Batman (2016)");
		assert_eq!(series_folder_name("Batman", None), "Batman");
	}

	#[test]
	fn destination_joins_root_folder_and_filename() {
		let dst = destination_path(
			Path::new("/lib/data"),
			"Batman (2016)",
			OsStr::new("Batman 001.cbz"),
		);
		assert_eq!(dst, PathBuf::from("/lib/data/Batman (2016)/Batman 001.cbz"));
	}
}
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cargo test -p longbox_core organizer::paths`
Expected: FAIL — `sanitize_folder_name`/`series_folder_name`/`destination_path` not found.

- [ ] **Step 4: Implement**

Add above the `#[cfg(test)]` block in `paths.rs`:

```rust
/// Characters disallowed in folder names across common filesystems.
const ILLEGAL: &[char] = &['/', '\\', ':', '*', '?', '"', '<', '>', '|'];

/// Turn a provider-supplied series title into a filesystem-safe folder name:
/// replace illegal/control chars with spaces, collapse whitespace, trim, and cap
/// length. Never returns empty (falls back to "Unknown Series").
pub fn sanitize_folder_name(name: &str) -> String {
	let replaced: String = name
		.chars()
		.map(|c| {
			if ILLEGAL.contains(&c) || c.is_control() {
				' '
			} else {
				c
			}
		})
		.collect();
	let collapsed = replaced.split_whitespace().collect::<Vec<_>>().join(" ");
	let capped: String = collapsed
		.trim_end_matches('.')
		.trim()
		.chars()
		.take(120)
		.collect();
	let capped = capped.trim().to_string();
	if capped.is_empty() {
		"Unknown Series".to_string()
	} else {
		capped
	}
}

/// Build the series folder name: `"Name (Year)"` when a year is present, else `"Name"`.
pub fn series_folder_name(canonical: &str, year: Option<i32>) -> String {
	let base = sanitize_folder_name(canonical);
	match year {
		Some(y) => format!("{base} ({y})"),
		None => base,
	}
}

/// Destination for a file organized into `folder_name` under the library root,
/// preserving the original filename.
pub fn destination_path(
	library_root: &Path,
	folder_name: &str,
	original_filename: &OsStr,
) -> PathBuf {
	library_root.join(folder_name).join(original_filename)
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cargo test -p longbox_core organizer::paths`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
cargo fmt --all
git add core/src/filesystem/organizer core/src/filesystem/mod.rs
git commit -m "feat(organizer): filesystem-safe destination path helpers"
```

---

### Task 4: `organizer/confirm.rs` — normalize / group / bucket / provider search / confirm

**Files:**

- Create: `core/src/filesystem/organizer/confirm.rs`
- Modify: `core/src/filesystem/organizer/mod.rs`

**Interfaces:**

- Consumes: `metadata_integrations::{parse_comic_filename, MatchCandidate, SearchQuery}`, `crate::filesystem::metadata::ProviderClientCache`, `models::{entity::metadata_provider_config, shared::enums::LibraryType}`.
- Produces:
  - `const CONFIDENCE_HIGH: f32 = 0.85; const CONFIDENCE_LOW: f32 = 0.5;`
  - `enum OrganizeBucket { Confident, Ambiguous, Unmatched }` (Serialize/Deserialize/Copy/Eq)
  - `fn bucket_for(confidence: f32) -> OrganizeBucket`
  - `fn normalize_series_key(series: &str) -> String`
  - `struct ProvisionalGroup { key: String, series_query: String, year: Option<i32>, files: Vec<PathBuf> }`
  - `fn group_candidates(files: &[PathBuf]) -> Vec<ProvisionalGroup>`
  - `struct ConfirmedSeries { canonical_name: String, year: Option<i32>, external_id: String, provider: String, confidence: f32, bucket: OrganizeBucket }` (Serialize/Deserialize/Clone)
  - `fn confirm_from_candidates(candidates: &[MatchCandidate]) -> Option<ConfirmedSeries>`
  - `async fn search_series_candidates(conn, library_type: &LibraryType, series_query: &str, year: Option<i32>, provider_cache: &ProviderClientCache) -> Result<Vec<MatchCandidate>, CoreError>`

- [ ] **Step 1: Register the module**

In `core/src/filesystem/organizer/mod.rs` add:

```rust
pub mod confirm;
```

- [ ] **Step 2: Write the failing tests**

Create `core/src/filesystem/organizer/confirm.rs` with only the imports + tests first:

```rust
//! Group loose files by parsed series, and confirm each group's canonical series
//! identity via the metadata providers.

use std::collections::BTreeMap;
use std::path::PathBuf;

use metadata_integrations::{
	parse_comic_filename, ExternalMetadata, MatchCandidate, SearchQuery,
};
use models::entity::metadata_provider_config;
use models::shared::enums::LibraryType;
use sea_orm::{prelude::*, DatabaseConnection};

use crate::filesystem::metadata::ProviderClientCache;
use crate::CoreError;

#[cfg(test)]
mod tests {
	use super::*;
	use metadata_integrations::ExternalSeriesMetadata;

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
		assert_eq!(normalize_series_key("  Jays  Of Future  Past "), "jays of future past");
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
		let batman_2016 = groups.iter().find(|g| g.key == "batman" && g.year == Some(2016)).unwrap();
		assert_eq!(batman_2016.files.len(), 2);
		let batman_2011 = groups.iter().find(|g| g.key == "batman" && g.year == Some(2011)).unwrap();
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
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cargo test -p longbox_core organizer::confirm`
Expected: FAIL — symbols not found.

- [ ] **Step 4: Implement**

Insert between the imports and the `#[cfg(test)]` block:

```rust
/// Confidence at/above which a provider match is auto-actionable.
pub const CONFIDENCE_HIGH: f32 = 0.85;
/// Confidence below which a match is treated as no match.
pub const CONFIDENCE_LOW: f32 = 0.5;

#[derive(
	Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize,
)]
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
		let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or_default();
		let parsed = parse_comic_filename(stem);
		let series = parsed.series.unwrap_or_default();
		let key = normalize_series_key(&series);
		let entry = groups
			.entry((key.clone(), parsed.year))
			.or_insert_with(|| ProvisionalGroup {
				key,
				series_query: series.clone(),
				year: parsed.year,
				files: vec![],
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
```

Note: verify `library_type.has_provider_overlap(&c.provider_type)` matches the call at `core/src/filesystem/metadata/fetch.rs:61`; verify `provider_cache.get_or_create(config)` returns a provider exposing `async fn search_series(&SearchQuery)` (see `fetch.rs:132-142`).

- [ ] **Step 5: Run tests to verify they pass**

Run: `cargo test -p longbox_core organizer::confirm`
Expected: PASS (5 tests). The `search_series_candidates` fn is compiled but exercised later via integration.

- [ ] **Step 6: Commit**

```bash
cargo fmt --all
git add core/src/filesystem/organizer
git commit -m "feat(organizer): filename grouping, confidence bucketing, provider confirm"
```

---

### Task 5: `organizer/candidates.rs` — pattern-aware candidate detection

**Files:**

- Create: `core/src/filesystem/organizer/candidates.rs`
- Modify: `core/src/filesystem/organizer/mod.rs`

**Interfaces:**

- Consumes: `walkdir::WalkDir`, `globset::GlobSet`, `crate::filesystem::PathUtils` (`is_default_ignored`), `super::confirm::normalize_series_key`, `metadata_integrations::parse_comic_filename`.
- Produces:
  - `struct CandidateFile { path: PathBuf }`
  - `fn find_candidate_files(library_root: &Path, is_collection_based: bool, ignore: &GlobSet) -> Vec<CandidateFile>`

- [ ] **Step 1: Register the module**

In `core/src/filesystem/organizer/mod.rs` add:

```rust
pub mod candidates;
```

- [ ] **Step 2: Write the failing tests**

Create `core/src/filesystem/organizer/candidates.rs`:

```rust
//! Pattern-aware detection of misfiled loose files that should be organized.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use globset::GlobSet;
use walkdir::WalkDir;

use metadata_integrations::parse_comic_filename;

use super::confirm::normalize_series_key;
use crate::filesystem::PathUtils;

#[cfg(test)]
mod tests {
	use super::*;
	use std::fs;
	use tempfile::tempdir;

	fn touch(dir: &Path, name: &str) {
		fs::write(dir.join(name), b"x").unwrap();
	}

	fn paths(candidates: &[CandidateFile]) -> HashSet<String> {
		candidates
			.iter()
			.map(|c| c.path.file_name().unwrap().to_string_lossy().to_string())
			.collect()
	}

	#[test]
	fn root_loose_files_are_candidates() {
		let root = tempdir().unwrap();
		touch(root.path(), "Jays of Future Past 001.cbz");
		touch(root.path(), "Some Other Comic 001.cbz");
		let found = find_candidate_files(root.path(), false, &GlobSet::empty());
		assert_eq!(paths(&found).len(), 2);
	}

	#[test]
	fn series_based_catchall_folder_is_candidate() {
		let root = tempdir().unwrap();
		let sub = root.path().join("downloads");
		fs::create_dir(&sub).unwrap();
		touch(&sub, "Batman 001.cbz");
		touch(&sub, "Superman 001.cbz"); // 2 distinct series -> catch-all
		let found = find_candidate_files(root.path(), false, &GlobSet::empty());
		assert_eq!(paths(&found).len(), 2);
	}

	#[test]
	fn series_based_clean_folder_is_left_alone() {
		let root = tempdir().unwrap();
		let sub = root.path().join("Batman");
		fs::create_dir(&sub).unwrap();
		touch(&sub, "Batman 001.cbz");
		touch(&sub, "Batman 002.cbz"); // 1 distinct series -> already correct
		let found = find_candidate_files(root.path(), false, &GlobSet::empty());
		assert!(found.is_empty());
	}

	#[test]
	fn collection_based_subfolders_are_never_split_but_root_is() {
		let root = tempdir().unwrap();
		touch(root.path(), "Loose At Root 001.cbz"); // root is always eligible
		let collection = root.path().join("Marvel");
		fs::create_dir(&collection).unwrap();
		touch(&collection, "Batman 001.cbz");
		touch(&collection, "Superman 001.cbz"); // intended collection, do NOT split
		let found = find_candidate_files(root.path(), true, &GlobSet::empty());
		assert_eq!(paths(&found), HashSet::from(["Loose At Root 001.cbz".to_string()]));
	}
}
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cargo test -p longbox_core organizer::candidates`
Expected: FAIL — `find_candidate_files`/`CandidateFile` not found.

- [ ] **Step 4: Implement**

Insert above the `#[cfg(test)]` block:

```rust
/// A loose file selected for organizing.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CandidateFile {
	pub path: PathBuf,
}

/// The direct (non-recursive), non-ignored media files in `dir`.
fn direct_media(dir: &Path, ignore: &GlobSet) -> Vec<PathBuf> {
	let read = match std::fs::read_dir(dir) {
		Ok(read) => read,
		Err(error) => {
			tracing::warn!(?error, ?dir, "Failed to read directory during organize scan");
			return vec![];
		},
	};
	read.filter_map(Result::ok)
		.map(|entry| entry.path())
		.filter(|path| {
			path.is_file() && !path.is_default_ignored() && !ignore.is_match(path)
		})
		.collect()
}

/// Count the distinct normalized series parsed from a set of files.
fn distinct_series_count(files: &[PathBuf]) -> usize {
	files
		.iter()
		.filter_map(|path| path.file_stem().and_then(|s| s.to_str()))
		.filter_map(|stem| parse_comic_filename(stem).series)
		.map(|series| normalize_series_key(&series))
		.collect::<HashSet<_>>()
		.len()
}

/// Find files to organize:
/// - **library root**: all direct media are candidates (the root must never be a series);
/// - **SeriesBased non-root folder**: candidates only if its direct media resolve to
///   >= 2 distinct series (a catch-all dump); a clean single-series folder is left alone;
/// - **CollectionBased non-root folder**: never candidates (respected as an intended
///   collection).
pub fn find_candidate_files(
	library_root: &Path,
	is_collection_based: bool,
	ignore: &GlobSet,
) -> Vec<CandidateFile> {
	let root_str = library_root.to_string_lossy().to_string();
	let mut candidates = Vec::new();

	for entry in WalkDir::new(library_root)
		.min_depth(0)
		.into_iter()
		.filter_map(Result::ok)
	{
		let dir = entry.path();
		if !dir.is_dir() {
			continue;
		}
		let media = direct_media(dir, ignore);
		if media.is_empty() {
			continue;
		}

		let is_root = dir.to_string_lossy() == root_str;
		let take = if is_root {
			true
		} else if is_collection_based {
			false
		} else {
			distinct_series_count(&media) >= 2
		};

		if take {
			candidates.extend(media.into_iter().map(|path| CandidateFile { path }));
		}
	}

	candidates
}
```

Note: confirm `PathUtils` (from `crate::filesystem`) provides `is_default_ignored(&self) -> bool` on `Path` — used the same way in `core/src/filesystem/scanner/walk.rs:384`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cargo test -p longbox_core organizer::candidates`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
cargo fmt --all
git add core/src/filesystem/organizer
git commit -m "feat(organizer): pattern-aware loose-file candidate detection"
```

---

### Task 6: `organizer/plan.rs` — `OrganizePlan` types + `build_plan`

> **CORRECTION (2026-07-19, during execution):** the original test approach
> below assumed `core/integration-tests` was a live harness. It is **not** — that
> crate is orphaned (not a workspace member; its Prisma-era tests don't compile).
> DB-backed tests for `build_plan`/`apply_plan` instead go **inside `core` as
> `#[cfg(test)] mod tests`** in `plan.rs`/`apply.rs`, using the real fixture crate
> `tests` (already a `core` dev-dependency): `tests::db::test_database()` builds an
> in-memory SQLite with all entity tables, and `tests::fake_data::{Library, Series}`
> insert rows. Do NOT touch `core/integration-tests` or the workspace manifest.
> Test command becomes `cargo test -p longbox_core organizer::plan` (Task 6) /
> `organizer::apply` (Task 7). The `plan.rs`/`apply.rs` implementations below are
> unchanged and correct.

Assembles a full preview: for each candidate group, confirm a canonical series (cache first, then provider unless `cached_only`), compute destination + merge target, and sort files into proposed moves vs unmatched.

**Files:**

- Create: `core/src/filesystem/organizer/plan.rs`
- Create: `core/integration-tests/tests/organizer.rs`
- Modify: `core/src/filesystem/organizer/mod.rs`
- Modify: `core/integration-tests/Cargo.toml` (only if `migrations`/`tempfile` are not already dev-deps)

**Interfaces:**

- Consumes: `build_plan`'s inputs and `confirm`/`paths`/`candidates` functions from Tasks 3–5.
- Produces (all `Serialize + Deserialize + Clone`, so they can be stored in `organize_plan_record.plan_json`):
  - `struct ProposedMove { media_id: Option<String>, src: String, dst: String, group_key: String, canonical_name: String, year: Option<i32>, external_id: String, provider: String, confidence: f32, bucket: OrganizeBucket, existing_series_id: Option<String> }`
  - `struct UnmatchedFile { media_id: Option<String>, src: String, parsed_series: Option<String>, reason: String }`
  - `struct OrganizePlan { proposed_moves: Vec<ProposedMove>, unmatched: Vec<UnmatchedFile> }` (derives `Default`)
  - `async fn build_plan(conn: &DatabaseConnection, library_id: &str, library_path: &str, config: &library_config::Model, provider_cache: &ProviderClientCache, cached_only: bool) -> CoreResult<OrganizePlan>`

- [ ] **Step 1: Register the module**

In `core/src/filesystem/organizer/mod.rs` add:

```rust
pub mod plan;
```

- [ ] **Step 2: Write `plan.rs`**

Create `core/src/filesystem/organizer/plan.rs`:

```rust
//! Assemble a full organize preview (proposed moves + unmatched files).

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use models::entity::{library_config, media, series, series_metadata};
use sea_orm::{prelude::*, DatabaseConnection};

use crate::filesystem::metadata::ProviderClientCache;
use crate::CoreResult;

use super::candidates::find_candidate_files;
use super::confirm::{
	confirm_from_candidates, group_candidates, normalize_series_key, search_series_candidates,
	ConfirmedSeries, OrganizeBucket,
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
		media_id: media_by_path.get(&path.to_string_lossy().to_string()).cloned(),
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
	let candidate_paths: Vec<PathBuf> =
		find_candidate_files(root, config.is_collection_based(), &ignore)
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
	let meta_by_series: HashMap<String, series_metadata::Model> =
		meta_rows.into_iter().map(|m| (m.series_id.clone(), m)).collect();

	// normalized(title)+year -> (confirmed identity, existing series id)
	let mut cache: HashMap<(String, Option<i32>), (ConfirmedSeries, String)> = HashMap::new();
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
				cache.insert((normalize_series_key(title), meta.year), (confirmed, s.id.clone()));
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

		let confirmed_and_merge: Option<(ConfirmedSeries, Option<String>)> =
			if let Some((c, sid)) = cache.get(&(group.key.clone(), group.year)).cloned() {
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
```

Note: verify `config.ignore_rules().build()?` returns `Result<GlobSet, _>` (same call at `core/src/filesystem/scanner/library_scan_job.rs:173`) and that `library_config::Model` exposes the public `library_type` field and `is_collection_based()`/`ignore_rules()` methods (Task 1 read confirms all three).

- [ ] **Step 3: Write the integration tests**

Create `core/integration-tests/tests/organizer.rs`. First read `core/integration-tests/tests/scanner.rs` to confirm the crate already depends on `longbox_core`, `models`, `migrations`, `sea-orm`, and `tempfile`; add any missing dev-deps to `core/integration-tests/Cargo.toml` from `[workspace.dependencies]`.

```rust
use std::fs;

use longbox_core::filesystem::metadata::ProviderClientCache;
use longbox_core::filesystem::organizer::confirm::OrganizeBucket;
use longbox_core::filesystem::organizer::plan::build_plan;
use migrations::Migrator;
use models::entity::{library, library_config, series, series_metadata};
use models::shared::enums::{FileStatus, LibraryPattern, LibraryType};
use sea_orm::{ActiveModelTrait, ActiveValue::Set, Database, DatabaseConnection};
use sea_orm_migration::MigratorTrait;
use tempfile::tempdir;

async fn test_db() -> DatabaseConnection {
	let db = Database::connect("sqlite::memory:").await.unwrap();
	Migrator::up(&db, None).await.unwrap();
	db
}

/// Build a library_config::Model in memory (no DB row needed by build_plan).
fn test_config(pattern: LibraryPattern) -> library_config::Model {
	library_config::Model {
		id: 1,
		convert_rar_to_zip: false,
		hard_delete_conversions: false,
		default_reading_dir: Default::default(),
		default_reading_mode: Default::default(),
		default_reading_image_scale_fit: Default::default(),
		generate_file_hashes: false,
		generate_koreader_hashes: false,
		process_metadata: false,
		write_comicinfo: false,
		watch: false,
		library_pattern: pattern,
		default_library_view_mode: Default::default(),
		hide_series_view: false,
		library_type: LibraryType::Comic,
		skip_book_overview: false,
		thumbnail_config: None,
		process_thumbnail_colors_even_without_config: false,
		ignore_rules: None,
		library_id: None,
		auto_organize_loose_files: false,
	}
}

#[tokio::test]
async fn build_plan_defers_when_no_cache_and_cached_only() {
	let db = test_db().await;
	let root = tempdir().unwrap();
	fs::write(root.path().join("Jays of Future Past 001.cbz"), b"x").unwrap();
	fs::write(root.path().join("Some Other Book 001.cbz"), b"x").unwrap();

	let cache = ProviderClientCache::new("test-key".to_string());
	let config = test_config(LibraryPattern::SeriesBased);
	let plan = build_plan(
		&db,
		"lib-1",
		root.path().to_str().unwrap(),
		&config,
		&cache,
		true, // cached_only -> no live provider calls
	)
	.await
	.unwrap();

	assert!(plan.proposed_moves.is_empty());
	assert_eq!(plan.unmatched.len(), 2);
	assert!(plan.unmatched.iter().all(|u| u.reason.contains("deferred")));
}

#[tokio::test]
async fn build_plan_uses_cached_series_and_merges() {
	let db = test_db().await;

	// Seed a library + an already-organized Batman (2016) series with metadata.
	library::ActiveModel {
		id: Set("lib-1".to_string()),
		name: Set("Comics".to_string()),
		path: Set("/unused".to_string()),
		status: Set(FileStatus::Ready),
		..Default::default()
	}
	.insert(&db)
	.await
	.unwrap();

	let batman = series::ActiveModel {
		name: Set("Batman".to_string()),
		path: Set("/unused/Batman (2016)".to_string()),
		library_id: Set(Some("lib-1".to_string())),
		status: Set(FileStatus::Ready),
		..Default::default()
	}
	.insert(&db)
	.await
	.unwrap();

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

	let root = tempdir().unwrap();
	fs::write(root.path().join("Batman 003 (2016).cbz"), b"x").unwrap();

	let cache = ProviderClientCache::new("test-key".to_string());
	let config = test_config(LibraryPattern::SeriesBased);
	let plan = build_plan(&db, "lib-1", root.path().to_str().unwrap(), &config, &cache, true)
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
```

Note: confirm the exact `library::ActiveModel` required fields by reading `crates/models/src/entity/library.rs`; adjust the seed literal to match (add any non-null columns).

- [ ] **Step 4: Run the tests**

Run: `cargo test -p integration-tests --test organizer`
Expected: FAIL first (before `plan.rs` compiles) then PASS (2 tests) after Step 2 is in place. If the `library` seed is missing a required column, the panic message names it — add it and re-run.

- [ ] **Step 5: Commit**

```bash
cargo fmt --all
git add core/src/filesystem/organizer core/integration-tests
git commit -m "feat(organizer): build_plan preview assembly with provider + cache confirm"
```

---

### Task 7: `organizer/apply.rs` — move + DB reconcile (safety-critical)

> **CORRECTION (2026-07-19):** same as Task 6 — the apply integration tests go
> **inside `core` as `#[cfg(test)] mod tests` in `apply.rs`**, using
> `tests::db::test_database()` + `tests::fake_data` (+ `models::entity::media`
> `ActiveModel` inserts for catalogued media). NOT in `core/integration-tests`.
> Test command: `cargo test -p longbox_core organizer::apply`.

**Files:**

- Create: `core/src/filesystem/organizer/apply.rs`
- Modify: `core/src/filesystem/organizer/mod.rs`
- Modify: `core/integration-tests/tests/organizer.rs` (add apply tests)

**Interfaces:**

- Consumes: `super::paths::{series_folder_name, destination_path}`, entities `media`/`series`/`series_metadata`.
- Produces (decision types `Serialize + Deserialize + Clone` so the job can carry them):
  - `enum DecisionAction { Move { series_id: Option<String>, canonical_name: String, year: Option<i32>, external_id: Option<String>, provider: Option<String> }, Skip }`
  - `struct OrganizeDecision { src: String, action: DecisionAction }`
  - `struct AppliedMove { media_id: Option<String>, src: String, dst: String }`
  - `struct ApplyResult { moved: u64, skipped: u64, failed: u64, applied: Vec<AppliedMove> }`
  - `async fn apply_plan(conn: &DatabaseConnection, library_id: &str, library_path: &str, decisions: Vec<OrganizeDecision>) -> CoreResult<ApplyResult>`

- [ ] **Step 1: Register the module**

In `core/src/filesystem/organizer/mod.rs` add:

```rust
pub mod apply;
```

- [ ] **Step 2: Write `apply.rs`**

Create `core/src/filesystem/organizer/apply.rs`:

```rust
//! Execute an organize plan: move files and re-point media records atomically.

use std::path::{Path, PathBuf};

use models::entity::{media, series, series_metadata};
use models::shared::enums::FileStatus;
use sea_orm::{
	prelude::*, ActiveValue::Set, DatabaseConnection, IntoActiveModel, TransactionTrait,
};

use crate::{CoreError, CoreResult};

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
				std::fs::copy(src, dst)?;
				std::fs::remove_file(src)?;
				Ok(())
			} else {
				Err(error)
			}
		},
	}
}

/// Resolve the target series id inside `txn`, creating the series (+ metadata) when
/// no existing series matches by explicit id, external id, or destination folder path.
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
		let series_id = resolve_series(
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
		.await?;

		// Move on disk before committing; on failure the txn is dropped (rolled back).
		if let Err(error) = move_file(&src, &dst) {
			tracing::error!(?error, ?src, ?dst, "Failed to move file during organize");
			result.failed += 1;
			continue; // txn dropped -> rolled back, nothing persisted
		}

		// Re-point the existing media record (preserving its id => read progress).
		let media_id = if let Some(model) = media::Entity::find()
			.filter(media::Column::Path.eq(decision.src.clone()))
			.one(&txn)
			.await?
		{
			let id = model.id.clone();
			let mut active = model.into_active_model();
			active.path = Set(dst.to_string_lossy().to_string());
			active.series_id = Set(Some(series_id.clone()));
			active.update(&txn).await?;
			Some(id)
		} else {
			None // file wasn't catalogued yet; a later scan will pick it up
		};

		txn.commit().await?;
		result.moved += 1;
		result.applied.push(AppliedMove {
			media_id,
			src: decision.src,
			dst: dst.to_string_lossy().to_string(),
		});
	}

	Ok(result)
}
```

Note: `CoreError` is imported for the `?` conversions from `DbErr`; if unused directly, drop it and keep only `CoreResult`. Confirm `DbErr` → `CoreError` `From` exists (it's used throughout `core`).

- [ ] **Step 3: Add apply integration tests**

Append to `core/integration-tests/tests/organizer.rs`:

```rust
use longbox_core::filesystem::organizer::apply::{
	apply_plan, DecisionAction, OrganizeDecision,
};
use models::entity::media;

#[tokio::test]
async fn apply_moves_file_and_repoints_media_preserving_identity() {
	let db = test_db().await;
	let root = tempdir().unwrap();
	let src = root.path().join("Batman 003 (2016).cbz");
	fs::write(&src, b"x").unwrap();

	// Seed the loose file as catalogued media under a junk "data" series.
	library::ActiveModel {
		id: Set("lib-1".to_string()),
		name: Set("Comics".to_string()),
		path: Set(root.path().to_string_lossy().to_string()),
		status: Set(FileStatus::Ready),
		..Default::default()
	}
	.insert(&db)
	.await
	.unwrap();
	let junk = series::ActiveModel {
		name: Set("data".to_string()),
		path: Set(root.path().to_string_lossy().to_string()),
		library_id: Set(Some("lib-1".to_string())),
		status: Set(FileStatus::Ready),
		..Default::default()
	}
	.insert(&db)
	.await
	.unwrap();
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
		"lib-1",
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
	// File physically moved.
	assert!(!src.exists());
	assert!(root.path().join("Batman (2016)/Batman 003 (2016).cbz").exists());
	// Same media row (identity preserved), now re-pointed.
	let reloaded = media::Entity::find_by_id(book.id.clone())
		.one(&db)
		.await
		.unwrap()
		.unwrap();
	assert!(reloaded.path.ends_with("Batman (2016)/Batman 003 (2016).cbz"));
	assert_ne!(reloaded.series_id.as_deref(), Some(junk.id.as_str()));
	assert!(reloaded.series_id.is_some());
}

#[tokio::test]
async fn apply_skips_on_destination_collision() {
	let db = test_db().await;
	let root = tempdir().unwrap();
	let src = root.path().join("Batman 003 (2016).cbz");
	fs::write(&src, b"x").unwrap();
	// Pre-existing destination.
	let dst_dir = root.path().join("Batman (2016)");
	fs::create_dir_all(&dst_dir).unwrap();
	fs::write(dst_dir.join("Batman 003 (2016).cbz"), b"existing").unwrap();

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
	assert!(src.exists()); // source untouched
}
```

- [ ] **Step 4: Run tests**

Run: `cargo test -p integration-tests --test organizer`
Expected: PASS (4 tests total). Fix any `media`/`library` seed literal to match required columns if a panic names a missing field.

- [ ] **Step 5: Commit**

```bash
cargo fmt --all
git add core/src/filesystem/organizer core/integration-tests
git commit -m "feat(organizer): apply_plan move + transactional media re-point"
```

---

### Task 8: `OrganizeLooseFilesJob` + `LongboxJob` wiring

**Files:**

- Create: `core/src/filesystem/organizer/organize_job.rs`
- Modify: `core/src/filesystem/organizer/mod.rs`
- Modify: `core/src/job/longbox_job.rs`, `core/src/job/output.rs`, `core/src/job/run.rs`

**Interfaces:**

- Consumes: `build_plan`, `apply_plan`, `OrganizeDecision`, `organize_plan_record` entity, `JobContext`.
- Produces:
  - `enum OrganizeMode { Plan, Apply { decisions: Vec<OrganizeDecision> }, AutoScan }` (Serialize/Deserialize/Clone)
  - `struct OrganizeLooseFilesJob { library_id: String, mode: OrganizeMode, provider_cache: Option<Arc<ProviderClientCache>> }`
  - `struct OrganizeLooseFilesOutput { proposed_moves: u64, unmatched: u64, moved: u64, skipped: u64, failed: u64 }` (SimpleObject + `JobOutputExt`)
  - `LongboxJob::OrganizeLooseFiles { library_id, mode }` + `LongboxJob::organize_loose_files(library_id, mode)`

- [ ] **Step 1: Register module**

In `core/src/filesystem/organizer/mod.rs` add:

```rust
pub mod organize_job;

pub use organize_job::{OrganizeLooseFilesJob, OrganizeLooseFilesOutput, OrganizeMode};
```

- [ ] **Step 2: Write the job**

Create `core/src/filesystem/organizer/organize_job.rs`:

```rust
//! Background job that plans and/or applies loose-file organization.

use std::sync::Arc;

use async_graphql::SimpleObject;
use models::entity::{library, library_config, organize_plan_record};
use sea_orm::{prelude::*, ActiveValue::Set};
use serde::{Deserialize, Serialize};

use crate::filesystem::metadata::ProviderClientCache;
use crate::job::{JobContext, JobError, JobLifecycle, JobOutputExt, JobProgress, WorkingState};

use super::apply::{apply_plan, DecisionAction, OrganizeDecision};
use super::confirm::OrganizeBucket;
use super::plan::{build_plan, OrganizePlan};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum OrganizeMode {
	/// Build a preview and persist it; move nothing.
	Plan,
	/// Apply the given decisions.
	Apply { decisions: Vec<OrganizeDecision> },
	/// Cached-only plan + auto-apply of the Confident bucket (post-scan path).
	AutoScan,
}

#[derive(Clone, Serialize, Deserialize, Default, Debug, SimpleObject)]
#[serde(rename_all = "camelCase")]
pub struct OrganizeLooseFilesOutput {
	pub proposed_moves: u64,
	pub unmatched: u64,
	pub moved: u64,
	pub skipped: u64,
	pub failed: u64,
}

impl JobOutputExt for OrganizeLooseFilesOutput {}

pub struct OrganizeLooseFilesJob {
	pub library_id: String,
	pub mode: OrganizeMode,
	pub provider_cache: Option<Arc<ProviderClientCache>>,
}

impl OrganizeLooseFilesJob {
	pub fn new(library_id: String, mode: OrganizeMode) -> Self {
		Self {
			library_id,
			mode,
			provider_cache: None,
		}
	}

	async fn cache(&mut self, ctx: &JobContext) -> Result<Arc<ProviderClientCache>, JobError> {
		if let Some(cache) = &self.provider_cache {
			return Ok(Arc::clone(cache));
		}
		let key = ctx.get_encryption_key().await?;
		let cache = Arc::new(ProviderClientCache::new(key));
		self.provider_cache = Some(Arc::clone(&cache));
		Ok(cache)
	}
}

async fn load_library(
	conn: &DatabaseConnection,
	library_id: &str,
) -> Result<(library::Model, library_config::Model), JobError> {
	let lib = library::Entity::find_by_id(library_id.to_owned())
		.one(conn)
		.await?
		.ok_or_else(|| JobError::Unknown("Library not found".to_string()))?;
	let config = library_config::Entity::find()
		.filter(library_config::Column::LibraryId.eq(library_id.to_owned()))
		.one(conn)
		.await?
		.ok_or_else(|| JobError::Unknown("Library config not found".to_string()))?;
	Ok((lib, config))
}

async fn persist_plan(
	conn: &DatabaseConnection,
	library_id: &str,
	status: &str,
	plan: &OrganizePlan,
) -> Result<(), JobError> {
	let plan_json = serde_json::to_string(plan)
		.map_err(|e| JobError::Unknown(format!("Failed to serialize plan: {e}")))?;
	// Replace any prior record for this library (latest-wins).
	organize_plan_record::Entity::delete_many()
		.filter(organize_plan_record::Column::LibraryId.eq(library_id.to_owned()))
		.exec(conn)
		.await?;
	organize_plan_record::ActiveModel {
		library_id: Set(library_id.to_owned()),
		status: Set(status.to_owned()),
		plan_json: Set(plan_json),
		..Default::default()
	}
	.insert(conn)
	.await?;
	Ok(())
}

#[async_trait::async_trait]
impl JobLifecycle for OrganizeLooseFilesJob {
	const NAME: &'static str = "organize_loose_files";
	type Output = OrganizeLooseFilesOutput;
	type Task = ();

	fn description(&self) -> Option<String> {
		Some(format!("Organize loose files: {}", self.library_id))
	}

	async fn init(
		&mut self,
		ctx: &JobContext,
	) -> Result<WorkingState<Self::Output, Self::Task>, JobError> {
		let conn = ctx.conn();
		let (lib, config) = load_library(conn, &self.library_id).await?;
		let cache = self.cache(ctx).await?;
		let mut output = OrganizeLooseFilesOutput::default();

		match self.mode.clone() {
			OrganizeMode::Plan => {
				ctx.report_progress(JobProgress::msg("Scanning for loose files"));
				let plan =
					build_plan(conn, &lib.id, &lib.path, &config, &cache, false).await?;
				output.proposed_moves = plan.proposed_moves.len() as u64;
				output.unmatched = plan.unmatched.len() as u64;
				persist_plan(conn, &lib.id, "AWAITING_REVIEW", &plan).await?;
			},
			OrganizeMode::AutoScan => {
				ctx.report_progress(JobProgress::msg("Auto-organizing confident matches"));
				let plan = build_plan(conn, &lib.id, &lib.path, &config, &cache, true).await?;
				output.proposed_moves = plan.proposed_moves.len() as u64;
				output.unmatched = plan.unmatched.len() as u64;
				let decisions = plan
					.proposed_moves
					.iter()
					.filter(|m| m.bucket == OrganizeBucket::Confident)
					.map(|m| OrganizeDecision {
						src: m.src.clone(),
						action: DecisionAction::Move {
							series_id: m.existing_series_id.clone(),
							canonical_name: m.canonical_name.clone(),
							year: m.year,
							external_id: Some(m.external_id.clone()),
							provider: Some(m.provider.clone()),
						},
					})
					.collect::<Vec<_>>();
				let applied = apply_plan(conn, &lib.id, &lib.path, decisions).await?;
				output.moved = applied.moved;
				output.skipped = applied.skipped;
				output.failed = applied.failed;
				persist_plan(conn, &lib.id, "APPLIED", &plan).await?;
			},
			OrganizeMode::Apply { decisions } => {
				ctx.report_progress(JobProgress::msg("Applying organize decisions"));
				let applied = apply_plan(conn, &lib.id, &lib.path, decisions).await?;
				output.moved = applied.moved;
				output.skipped = applied.skipped;
				output.failed = applied.failed;
			},
		}

		Ok(WorkingState {
			output: Some(output),
			tasks: Default::default(),
			logs: vec![],
		})
	}

	async fn execute_task(
		&self,
		_ctx: &JobContext,
		_task: Self::Task,
	) -> Result<crate::job::JobTaskOutput<Self>, JobError> {
		// All work happens in init (Task = ()).
		Ok(crate::job::JobTaskOutput {
			output: OrganizeLooseFilesOutput::default(),
			subtasks: vec![],
			logs: vec![],
		})
	}
}
```

Note: verify the exact import paths for `JobContext`, `JobError`, `JobLifecycle`, `JobOutputExt`, `JobProgress`, `WorkingState`, `JobTaskOutput` (all under `crate::job` per Task-8 findings; the scanner job imports them from `crate::job::{...}`). Confirm `ctx.conn()` and `ctx.get_encryption_key()` signatures (Task-8/metadata findings).

- [ ] **Step 3: Wire the `LongboxJob` variant**

In `core/src/job/longbox_job.rs`:

Add import near the top:

```rust
use crate::filesystem::organizer::OrganizeMode;
```

Add the enum variant inside `enum LongboxJob { ... }`:

```rust
	OrganizeLooseFiles {
		library_id: String,
		mode: OrganizeMode,
	},
```

Add the `name()` arm:

```rust
			LongboxJob::OrganizeLooseFiles { .. } => "organize_loose_files",
```

Add the `description()` arm:

```rust
			LongboxJob::OrganizeLooseFiles { library_id, .. } => {
				Some(format!("Organize loose files: {library_id}"))
			},
```

Add the constructor:

```rust
	pub fn organize_loose_files(library_id: String, mode: OrganizeMode) -> Self {
		LongboxJob::OrganizeLooseFiles { library_id, mode }
	}
```

- [ ] **Step 4: Wire `CoreJobOutput`**

In `core/src/job/output.rs`, add the import alongside the other output imports:

```rust
use crate::filesystem::organizer::OrganizeLooseFilesOutput;
```

Add the variant to `enum CoreJobOutput { ... }`:

```rust
	OrganizeLooseFiles(OrganizeLooseFilesOutput),
```

(The `#[derive(Union)]` generates `From<OrganizeLooseFilesOutput>` automatically — no manual impl.)

- [ ] **Step 5: Wire dispatch**

In `core/src/job/run.rs`, add to the imports:

```rust
	filesystem::organizer::OrganizeLooseFilesJob,
```

(place it inside the existing `filesystem::{ ... }` import group), and add the match arm in `dispatch_job`:

```rust
		LongboxJob::OrganizeLooseFiles { library_id, mode } => {
			run_job(&job_ctx, &mut OrganizeLooseFilesJob::new(library_id, mode)).await
		},
```

- [ ] **Step 6: Verify build**

Run: `cargo build -p longbox_core`
Expected: compiles. The exhaustive `match` in `dispatch_job`, `name()`, `description()`, and `CoreJobOutput` conversions are compiler-enforced, so a miss is a build error.

- [ ] **Step 7: Commit**

```bash
cargo fmt --all
git add core/src
git commit -m "feat(organizer): OrganizeLooseFiles job + LongboxJob wiring"
```

---

### Task 9: Auto-on-scan enqueue

After a library scan completes, enqueue an `AutoScan` organize run when the library opts in.

**Files:**

- Modify: `core/src/filesystem/scanner/library_scan_job.rs`

**Interfaces:**

- Consumes: `LongboxJob::organize_loose_files`, `library_config.auto_organize_loose_files`, `ctx.enqueue`.

- [ ] **Step 1: Locate the scan-complete path**

Read `core/src/filesystem/scanner/library_scan_job.rs` around `handle_scan_complete` (~line 984) and the `finalize`/completion call site (~line 306). The scan job already holds the library id, path, and config.

- [ ] **Step 2: Add the enqueue after completion**

In the scan job's completion path (after the scan output is finalized, where `self.config` / the loaded `library_config` is in scope), add:

```rust
		// Opt-in: auto-organize loose files using cached matches only.
		if config.auto_organize_loose_files {
			if let Err(error) = ctx
				.enqueue(LongboxJob::organize_loose_files(
					self.id.clone(),
					crate::filesystem::organizer::OrganizeMode::AutoScan,
				))
				.await
			{
				tracing::error!(?error, "Failed to enqueue auto-organize job");
			}
		}
```

Adjust `config`/`self.id` to the exact identifiers in scope at that point (the job struct field for the library id and the loaded `library_config::Model`). Ensure `LongboxJob` is imported in that file (it is — the scanner enqueues jobs already).

- [ ] **Step 3: Verify build**

Run: `cargo build -p longbox_core`
Expected: compiles.

- [ ] **Step 4: Commit**

```bash
cargo fmt --all
git add core/src/filesystem/scanner/library_scan_job.rs
git commit -m "feat(organizer): auto-enqueue organize on scan when opted in"
```

---

### Task 10: GraphQL output objects + input

**Files:**

- Create: `crates/graphql/src/object/organize.rs`
- Create: `crates/graphql/src/input/organize.rs`
- Modify: `crates/graphql/src/object/mod.rs`, `crates/graphql/src/input/mod.rs`

**Interfaces:**

- Produces GraphQL types: `OrganizePreview { proposedMoves: [OrganizeProposedMove!]!, unmatched: [OrganizeUnmatchedFile!]! }`, `OrganizeProposedMove`, `OrganizeUnmatchedFile`, `OrganizeBucket` enum (GraphQL), and `OrganizeDecisionInput { src, canonicalName, year, externalId, provider, seriesId, skip }`.

- [ ] **Step 1: Write the output objects**

Create `crates/graphql/src/object/organize.rs`:

```rust
use async_graphql::{Enum, SimpleObject};

use longbox_core::filesystem::organizer::confirm::OrganizeBucket as CoreBucket;
use longbox_core::filesystem::organizer::plan::{OrganizePlan, ProposedMove, UnmatchedFile};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Enum)]
pub enum OrganizeBucket {
	Confident,
	Ambiguous,
	Unmatched,
}

impl From<CoreBucket> for OrganizeBucket {
	fn from(value: CoreBucket) -> Self {
		match value {
			CoreBucket::Confident => OrganizeBucket::Confident,
			CoreBucket::Ambiguous => OrganizeBucket::Ambiguous,
			CoreBucket::Unmatched => OrganizeBucket::Unmatched,
		}
	}
}

#[derive(Debug, Clone, SimpleObject)]
pub struct OrganizeProposedMove {
	pub media_id: Option<String>,
	pub src: String,
	pub dst: String,
	pub canonical_name: String,
	pub year: Option<i32>,
	pub external_id: String,
	pub provider: String,
	pub confidence: f32,
	pub bucket: OrganizeBucket,
	pub existing_series_id: Option<String>,
}

impl From<ProposedMove> for OrganizeProposedMove {
	fn from(m: ProposedMove) -> Self {
		Self {
			media_id: m.media_id,
			src: m.src,
			dst: m.dst,
			canonical_name: m.canonical_name,
			year: m.year,
			external_id: m.external_id,
			provider: m.provider,
			confidence: m.confidence,
			bucket: m.bucket.into(),
			existing_series_id: m.existing_series_id,
		}
	}
}

#[derive(Debug, Clone, SimpleObject)]
pub struct OrganizeUnmatchedFile {
	pub media_id: Option<String>,
	pub src: String,
	pub parsed_series: Option<String>,
	pub reason: String,
}

impl From<UnmatchedFile> for OrganizeUnmatchedFile {
	fn from(u: UnmatchedFile) -> Self {
		Self {
			media_id: u.media_id,
			src: u.src,
			parsed_series: u.parsed_series,
			reason: u.reason,
		}
	}
}

#[derive(Debug, Clone, SimpleObject)]
pub struct OrganizePreview {
	pub proposed_moves: Vec<OrganizeProposedMove>,
	pub unmatched: Vec<OrganizeUnmatchedFile>,
}

impl From<OrganizePlan> for OrganizePreview {
	fn from(plan: OrganizePlan) -> Self {
		Self {
			proposed_moves: plan.proposed_moves.into_iter().map(Into::into).collect(),
			unmatched: plan.unmatched.into_iter().map(Into::into).collect(),
		}
	}
}
```

- [ ] **Step 2: Write the input object**

Create `crates/graphql/src/input/organize.rs`:

```rust
use async_graphql::InputObject;

use longbox_core::filesystem::organizer::apply::{DecisionAction, OrganizeDecision};

#[derive(Debug, Clone, InputObject)]
pub struct OrganizeDecisionInput {
	/// Absolute source path of the file to organize.
	pub src: String,
	/// When true, skip this file (leave it in place).
	#[graphql(default)]
	pub skip: bool,
	/// Existing series to merge into (optional).
	pub series_id: Option<String>,
	pub canonical_name: Option<String>,
	pub year: Option<i32>,
	pub external_id: Option<String>,
	pub provider: Option<String>,
}

impl From<OrganizeDecisionInput> for OrganizeDecision {
	fn from(input: OrganizeDecisionInput) -> Self {
		let action = if input.skip {
			DecisionAction::Skip
		} else {
			DecisionAction::Move {
				series_id: input.series_id,
				canonical_name: input.canonical_name.unwrap_or_default(),
				year: input.year,
				external_id: input.external_id,
				provider: input.provider,
			}
		};
		OrganizeDecision {
			src: input.src,
			action,
		}
	}
}
```

- [ ] **Step 3: Register the modules**

In `crates/graphql/src/object/mod.rs` add `pub mod organize;` (alongside the other `pub mod` lines). In `crates/graphql/src/input/mod.rs` add `pub mod organize;`.

- [ ] **Step 4: Verify build**

Run: `cargo build -p graphql`
Expected: compiles.

- [ ] **Step 5: Commit**

```bash
cargo fmt --all
git add crates/graphql/src/object crates/graphql/src/input
git commit -m "feat(organizer): GraphQL preview objects + decision input"
```

---

### Task 11: GraphQL mutations + query

**Files:**

- Create: `crates/graphql/src/mutation/organize.rs`
- Create: `crates/graphql/src/query/organize.rs`
- Modify: `crates/graphql/src/mutation/mod.rs`, `crates/graphql/src/query/mod.rs`

**Interfaces:**

- Produces:
  - `mutation planOrganizeLooseFiles(libraryId: ID!): Boolean!` — enqueues `OrganizeMode::Plan`.
  - `mutation applyOrganizeLooseFiles(libraryId: ID!, decisions: [OrganizeDecisionInput!]!): Boolean!` — enqueues `OrganizeMode::Apply`.
  - `query organizePreview(libraryId: ID!): OrganizePreview` — reads the latest `organize_plan_record`.

- [ ] **Step 1: Write the mutations**

Create `crates/graphql/src/mutation/organize.rs`:

```rust
use async_graphql::{Context, Object, Result, ID};

use longbox_core::filesystem::organizer::OrganizeMode;
use longbox_core::job::LongboxJob;

use crate::data::{AuthContext, CoreContext};
use crate::guard::PermissionGuard;
use crate::input::organize::OrganizeDecisionInput;
use models::shared::enums::UserPermission;

#[derive(Default)]
pub struct OrganizeMutation;

#[Object]
impl OrganizeMutation {
	/// Enqueue a job that scans for loose files and builds an organize preview.
	#[graphql(guard = "PermissionGuard::one(UserPermission::ScanLibrary)")]
	async fn plan_organize_loose_files(
		&self,
		ctx: &Context<'_>,
		library_id: ID,
	) -> Result<bool> {
		let _auth = ctx.data::<AuthContext>()?;
		let core = ctx.data::<CoreContext>()?;
		core.enqueue(LongboxJob::organize_loose_files(
			library_id.to_string(),
			OrganizeMode::Plan,
		))
		.await?;
		Ok(true)
	}

	/// Enqueue a job that applies the given organize decisions (moves files).
	#[graphql(guard = "PermissionGuard::one(UserPermission::ScanLibrary)")]
	async fn apply_organize_loose_files(
		&self,
		ctx: &Context<'_>,
		library_id: ID,
		decisions: Vec<OrganizeDecisionInput>,
	) -> Result<bool> {
		let _auth = ctx.data::<AuthContext>()?;
		let core = ctx.data::<CoreContext>()?;
		let decisions = decisions.into_iter().map(Into::into).collect();
		core.enqueue(LongboxJob::organize_loose_files(
			library_id.to_string(),
			OrganizeMode::Apply { decisions },
		))
		.await?;
		Ok(true)
	}
}
```

Note: confirm the guard/permission import paths (`crate::guard::PermissionGuard`, `UserPermission::ScanLibrary`) against an existing mutation like `crates/graphql/src/mutation/library.rs` (the `scan_library` resolver) and match them exactly.

- [ ] **Step 2: Write the query**

Create `crates/graphql/src/query/organize.rs`:

```rust
use async_graphql::{Context, Object, Result, ID};
use sea_orm::{prelude::*, QueryOrder};

use longbox_core::filesystem::organizer::plan::OrganizePlan;
use models::entity::organize_plan_record;

use crate::data::{AuthContext, CoreContext};
use crate::object::organize::OrganizePreview;

#[derive(Default)]
pub struct OrganizeQuery;

#[Object]
impl OrganizeQuery {
	/// The latest computed organize preview for a library, if any.
	async fn organize_preview(
		&self,
		ctx: &Context<'_>,
		library_id: ID,
	) -> Result<Option<OrganizePreview>> {
		let _auth = ctx.data::<AuthContext>()?;
		let conn = ctx.data::<CoreContext>()?.conn.as_ref();

		let record = organize_plan_record::Entity::find()
			.filter(organize_plan_record::Column::LibraryId.eq(library_id.to_string()))
			.order_by_desc(organize_plan_record::Column::UpdatedAt)
			.one(conn)
			.await?;

		match record {
			Some(record) => {
				let plan: OrganizePlan = serde_json::from_str(&record.plan_json)
					.map_err(|e| format!("Corrupt organize plan record: {e}"))?;
				Ok(Some(plan.into()))
			},
			None => Ok(None),
		}
	}
}
```

- [ ] **Step 3: Register resolvers**

In `crates/graphql/src/mutation/mod.rs`: add `mod organize;`, `use organize::OrganizeMutation;`, and add `OrganizeMutation` to the `ContentMutations` `MergedObject` tuple.

In `crates/graphql/src/query/mod.rs`: add `mod organize;`, `use organize::OrganizeQuery;`, and add `OrganizeQuery` to the `ContentQueries` `MergedObject` tuple.

- [ ] **Step 4: Verify build**

Run: `cargo build -p graphql`
Expected: compiles.

- [ ] **Step 5: Commit**

```bash
cargo fmt --all
git add crates/graphql/src
git commit -m "feat(organizer): plan/apply mutations + organizePreview query"
```

---

### Task 12: Expose the config toggle + regenerate schema/client

**Files:**

- Modify: `crates/graphql/src/input/library.rs` (config input)
- Regenerate: `crates/graphql/schema.graphql`, `packages/graphql/src/client/*`

**Interfaces:**

- Produces: `auto_organize_loose_files` on the library config input (so the frontend can toggle it) and the flag on the config output object (auto-derived via `#[graphql]` on the entity Model).

- [ ] **Step 1: Add the field to the config input**

In `crates/graphql/src/input/library.rs`, find `LibraryConfigInput` and add:

```rust
	#[graphql(default)]
	pub auto_organize_loose_files: bool,
```

Then find where `LibraryConfigInput` is converted into the `library_config` ActiveModel (its `into_active_model`/build function) and set the field:

```rust
	auto_organize_loose_files: Set(self.auto_organize_loose_files),
```

Read the existing conversion for the exact pattern (e.g. how `skip_book_overview` is threaded) and mirror it.

- [ ] **Step 2: Regenerate the SDL**

Run: `cargo dump-schema`
Expected: `crates/graphql/schema.graphql` updates with `OrganizePreview`, `OrganizeProposedMove`, `OrganizeUnmatchedFile`, `OrganizeBucket`, `OrganizeDecisionInput`, the two mutations, the query, and `autoOrganizeLooseFiles` on the config types.

Run: `cargo dump-schema -- --check`
Expected: exits 0 (no drift).

- [ ] **Step 3: Regenerate the TS client**

Run: `yarn workspace @longbox/graphql codegen`
Expected: `packages/graphql/src/client/*` regenerates with the new types.

- [ ] **Step 4: Verify**

Run: `cargo build -p graphql && yarn workspace @longbox/graphql check-types`
Expected: both succeed.

- [ ] **Step 5: Commit**

```bash
cargo fmt --all
git add crates/graphql packages/graphql
git commit -m "feat(organizer): expose config toggle; regenerate schema + TS client"
```

---

### Task 13: Full preflight

**Files:** none (verification only)

- [ ] **Step 1: Run the CI preflight**

Run: `.claude/skills/ci-preflight/scripts/preflight.sh`
Expected: all gates green — `cargo fmt --all -- --check`, `cargo clippy -- -D warnings`, `cargo dump-schema -- --check`, `cargo test`, `yarn lint`, `yarn test`.

- [ ] **Step 2: Fix anything red, then re-run until green.**

- [ ] **Step 3: Final commit (if fixes were needed)**

```bash
cargo fmt --all
git add -A
git commit -m "chore(organizer): satisfy CI preflight"
```

---

## Self-Review

**Spec coverage:**

- Physically move files → Task 7 (`apply_plan` + `move_file`). ✓
- Both triggers (manual + auto-on-scan) → Tasks 11 (manual plan/apply mutations) + 9 (auto-on-scan enqueue) + 8 (`OrganizeMode::AutoScan`). ✓
- Provider-confirmed via canonical volume id → Task 4 (`search_series_candidates` + `confirm_from_candidates`, keyed on `external_id`). ✓
- `Name (Year)/` folder + write `series_metadata` → Task 3 (`series_folder_name`) + Task 7 (`resolve_series` writes title/year/external_id/source). ✓
- Root + catch-all scope, CollectionBased root-only → Task 5 (`find_candidate_files`). ✓
- Confidence buckets; never fabricate/never move unsure; auto = Confident only → Tasks 4 (`bucket_for`) + 6 (unmatched routing) + 8 (AutoScan filters Confident). ✓
- Preserve read progress (update path/series_id, not recreate) → Task 7 (re-point existing media in a txn). ✓
- Never overwrite; graceful degradation → Task 7 (collision skip) + Task 4 (provider errors logged, empty candidates → unmatched). ✓
- Cached-only auto path (no live provider in scan hot path) → Task 6 (`cached_only`) + Task 8 (AutoScan passes `true`). ✓
- Config toggle persisted + exposed → Tasks 1 + 12. ✓
- Preview persisted + queryable → Tasks 2 + 8 (`persist_plan`) + 11 (`organizePreview`). ✓

**Placeholder scan:** No TBD/TODO; every code step has complete code. Several steps carry a "Note: verify X against file Y" — these are confirmations of already-identified exact APIs, not missing content.

**Type consistency:** `OrganizeBucket` (core enum) vs GraphQL `OrganizeBucket` (Task 10) are distinct types with a `From` bridge — intentional. `OrganizeDecision`/`DecisionAction` defined in Task 7, consumed by Tasks 8/10/11. `build_plan`/`apply_plan` signatures match across Tasks 6/7/8. `OrganizeMode` defined in Task 8, used in Tasks 8/9/11.

**Known assumptions to verify during execution (flagged inline):** exact `library::ActiveModel` required columns (Task 6/7 seeds); `config.ignore_rules().build()` return type; guard/permission import paths; the scan-complete insertion point and in-scope identifiers (Task 9); `LibraryConfigInput` conversion location (Task 12). Each is called out in its task's Note.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-07-19-loose-file-organizer-backend.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**

(Frontend preview/apply UI is Plan 2, written after this backend GraphQL surface lands.)
