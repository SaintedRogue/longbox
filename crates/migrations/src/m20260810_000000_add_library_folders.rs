use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
	async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
		// Unlike `media.book_group_id`, both foreign keys here can be declared and
		// enforced: this is a CREATE TABLE, not an ALTER, and SQLite only refuses to
		// add an enforced FK to an existing table.
		manager
			.create_table(
				Table::create()
					.table(LibraryFolders::Table)
					.if_not_exists()
					.col(
						ColumnDef::new(LibraryFolders::Id)
							.text()
							.not_null()
							.primary_key(),
					)
					.col(ColumnDef::new(LibraryFolders::LibraryId).text().not_null())
					// NULL for a folder sitting directly under the library root.
					.col(ColumnDef::new(LibraryFolders::ParentId).text())
					// The leaf directory name only, never the accumulated path. This is
					// what makes folder-name search exact: matching `name` cannot
					// accidentally hit a library's mount point the way matching an
					// absolute `series.path` does.
					.col(ColumnDef::new(LibraryFolders::Name).text().not_null())
					// Absolute, byte-identical to how the walker produced it, so it
					// compares directly against `series.path` and `scanned_directories.path`.
					.col(ColumnDef::new(LibraryFolders::Path).text().not_null())
					// 0 = a direct child of the library root.
					.col(
						ColumnDef::new(LibraryFolders::Depth)
							.integer()
							.not_null()
							.default(0),
					)
					.col(
						ColumnDef::new(LibraryFolders::CreatedAt)
							.date_time()
							.not_null(),
					)
					.foreign_key(
						ForeignKey::create()
							.name("fk_library_folders_library")
							.from(LibraryFolders::Table, LibraryFolders::LibraryId)
							.to(Libraries::Table, Libraries::Id)
							.on_delete(ForeignKeyAction::Cascade),
					)
					// Self-referential: dropping a folder drops everything nested under
					// it. Defence in depth behind the scan's own prune step, which
					// already removes a whole subtree together because a directory only
					// goes stale when it is gone from disk.
					.foreign_key(
						ForeignKey::create()
							.name("fk_library_folders_parent")
							.from(LibraryFolders::Table, LibraryFolders::ParentId)
							.to(LibraryFolders::Table, LibraryFolders::Id)
							.on_delete(ForeignKeyAction::Cascade),
					)
					.to_owned(),
			)
			.await?;

		manager
			.create_index(
				Index::create()
					.if_not_exists()
					.name("idx_library_folders_library")
					.table(LibraryFolders::Table)
					.col(LibraryFolders::LibraryId)
					.to_owned(),
			)
			.await?;

		// A path is exactly one folder, so unlike `series.path` this can be unique.
		// It is also the conflict target the scan's upsert relies on.
		manager
			.create_index(
				Index::create()
					.if_not_exists()
					.unique()
					.name("idx_library_folders_library_path")
					.table(LibraryFolders::Table)
					.col(LibraryFolders::LibraryId)
					.col(LibraryFolders::Path)
					.to_owned(),
			)
			.await?;

		// The "list this folder's children" hot path.
		manager
			.create_index(
				Index::create()
					.if_not_exists()
					.name("idx_library_folders_parent")
					.table(LibraryFolders::Table)
					.col(LibraryFolders::LibraryId)
					.col(LibraryFolders::ParentId)
					.to_owned(),
			)
			.await?;

		// Does not make a leading-wildcard LIKE index-assisted -- nothing in this
		// schema's name search does -- but keeps the scanned table to one row per
		// distinct directory, which is always fewer rows than series.
		manager
			.create_index(
				Index::create()
					.if_not_exists()
					.name("idx_library_folders_name")
					.table(LibraryFolders::Table)
					.col(LibraryFolders::Name)
					.to_owned(),
			)
			.await?;

		// The series' immediate parent folder. Unenforced, following the
		// `media.book_group_id` precedent: SQLite cannot cleanly add an enforced FK
		// to an existing table. Referential integrity is the scan prune step's job.
		manager
			.alter_table(
				Table::alter()
					.table(Series::Table)
					.add_column(ColumnDef::new(Series::FolderId).text())
					.to_owned(),
			)
			.await?;

		manager
			.create_index(
				Index::create()
					.if_not_exists()
					.name("idx_series_folder")
					.table(Series::Table)
					.col(Series::FolderId)
					.to_owned(),
			)
			.await
	}

	async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
		manager
			.drop_index(
				Index::drop()
					.name("idx_series_folder")
					.table(Series::Table)
					.to_owned(),
			)
			.await?;

		manager
			.alter_table(
				Table::alter()
					.table(Series::Table)
					.drop_column(Series::FolderId)
					.to_owned(),
			)
			.await?;

		manager
			.drop_table(Table::drop().table(LibraryFolders::Table).to_owned())
			.await
	}
}

#[derive(DeriveIden)]
enum LibraryFolders {
	Table,
	Id,
	LibraryId,
	ParentId,
	Name,
	Path,
	Depth,
	CreatedAt,
}

#[derive(DeriveIden)]
enum Series {
	Table,
	FolderId,
}

#[derive(DeriveIden)]
enum Libraries {
	Table,
	Id,
}
