use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
	async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
		manager
			.create_table(
				Table::create()
					.table(BookGroups::Table)
					.if_not_exists()
					.col(
						ColumnDef::new(BookGroups::Id)
							.text()
							.not_null()
							.primary_key(),
					)
					.col(ColumnDef::new(BookGroups::LibraryId).text().not_null())
					.col(ColumnDef::new(BookGroups::Name).text().not_null())
					// How the group came to exist: "metadata", "filename", or "manual".
					.col(ColumnDef::new(BookGroups::Source).text().not_null())
					// The normalized key detection used, so a re-run matches the existing
					// group instead of creating a duplicate. NULL for manual groups, which
					// is also why the unique index below tolerates repeats: SQLite treats
					// NULLs as distinct.
					.col(ColumnDef::new(BookGroups::SourceKey).text())
					.col(ColumnDef::new(BookGroups::CreatedAt).date_time().not_null())
					.col(ColumnDef::new(BookGroups::UpdatedAt).date_time().not_null())
					.foreign_key(
						ForeignKey::create()
							.name("fk_book_groups_library")
							.from(BookGroups::Table, BookGroups::LibraryId)
							.to(Libraries::Table, Libraries::Id)
							.on_delete(ForeignKeyAction::Cascade),
					)
					.to_owned(),
			)
			.await?;

		manager
			.create_index(
				Index::create()
					.if_not_exists()
					.name("idx_book_groups_library")
					.table(BookGroups::Table)
					.col(BookGroups::LibraryId)
					.to_owned(),
			)
			.await?;

		manager
			.create_index(
				Index::create()
					.if_not_exists()
					.unique()
					.name("idx_book_groups_library_source_key")
					.table(BookGroups::Table)
					.col(BookGroups::LibraryId)
					.col(BookGroups::SourceKey)
					.to_owned(),
			)
			.await?;

		manager
			.alter_table(
				Table::alter()
					.table(Media::Table)
					.add_column(ColumnDef::new(Media::BookGroupId).text())
					.to_owned(),
			)
			.await?;

		// Set once a human decides a book's grouping. Detection skips locked rows, which
		// is what makes a manual correction survive later re-runs and rescans.
		manager
			.alter_table(
				Table::alter()
					.table(Media::Table)
					.add_column(
						ColumnDef::new(Media::BookGroupLocked)
							.boolean()
							.not_null()
							.default(false),
					)
					.to_owned(),
			)
			.await?;

		manager
			.create_index(
				Index::create()
					.if_not_exists()
					.name("idx_media_book_group")
					.table(Media::Table)
					.col(Media::BookGroupId)
					.to_owned(),
			)
			.await
	}

	async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
		manager
			.drop_index(
				Index::drop()
					.name("idx_media_book_group")
					.table(Media::Table)
					.to_owned(),
			)
			.await?;

		manager
			.alter_table(
				Table::alter()
					.table(Media::Table)
					.drop_column(Media::BookGroupLocked)
					.to_owned(),
			)
			.await?;

		manager
			.alter_table(
				Table::alter()
					.table(Media::Table)
					.drop_column(Media::BookGroupId)
					.to_owned(),
			)
			.await?;

		manager
			.drop_table(Table::drop().table(BookGroups::Table).to_owned())
			.await
	}
}

#[derive(DeriveIden)]
enum BookGroups {
	Table,
	Id,
	LibraryId,
	Name,
	Source,
	SourceKey,
	CreatedAt,
	UpdatedAt,
}

#[derive(DeriveIden)]
enum Media {
	Table,
	BookGroupId,
	BookGroupLocked,
}

#[derive(DeriveIden)]
enum Libraries {
	Table,
	Id,
}
