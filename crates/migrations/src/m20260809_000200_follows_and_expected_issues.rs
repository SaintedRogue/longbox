use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
	async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
		manager
			.create_table(
				Table::create()
					.table(SeriesFollows::Table)
					.if_not_exists()
					.col(
						ColumnDef::new(SeriesFollows::Id)
							.integer()
							.not_null()
							.auto_increment()
							.primary_key(),
					)
					.col(ColumnDef::new(SeriesFollows::UserId).text().not_null())
					.col(ColumnDef::new(SeriesFollows::SeriesId).text().not_null())
					.col(
						ColumnDef::new(SeriesFollows::CreatedAt)
							.date_time()
							.not_null(),
					)
					.foreign_key(
						ForeignKey::create()
							.name("fk_series_follows_user")
							.from(SeriesFollows::Table, SeriesFollows::UserId)
							.to(Users::Table, Users::Id)
							.on_delete(ForeignKeyAction::Cascade),
					)
					.foreign_key(
						ForeignKey::create()
							.name("fk_series_follows_series")
							.from(SeriesFollows::Table, SeriesFollows::SeriesId)
							.to(Series::Table, Series::Id)
							.on_delete(ForeignKeyAction::Cascade),
					)
					.to_owned(),
			)
			.await?;

		manager
			.create_index(
				Index::create()
					.if_not_exists()
					.unique()
					.name("idx_sf_user_series")
					.table(SeriesFollows::Table)
					.col(SeriesFollows::UserId)
					.col(SeriesFollows::SeriesId)
					.to_owned(),
			)
			.await?;
		manager
			.create_index(
				Index::create()
					.if_not_exists()
					.name("idx_sf_series")
					.table(SeriesFollows::Table)
					.col(SeriesFollows::SeriesId)
					.to_owned(),
			)
			.await?;

		manager
			.create_table(
				Table::create()
					.table(ExpectedIssues::Table)
					.if_not_exists()
					.col(
						ColumnDef::new(ExpectedIssues::Id)
							.integer()
							.not_null()
							.auto_increment()
							.primary_key(),
					)
					.col(ColumnDef::new(ExpectedIssues::SeriesId).text().not_null())
					.col(ColumnDef::new(ExpectedIssues::Provider).text().not_null())
					.col(ColumnDef::new(ExpectedIssues::ExternalId).text().not_null())
					.col(ColumnDef::new(ExpectedIssues::Number).text())
					.col(ColumnDef::new(ExpectedIssues::Title).text())
					.col(ColumnDef::new(ExpectedIssues::CoverUrl).text())
					// ISO YYYY-MM-DD — lexically sortable; NULL when the provider
					// hasn't dated the issue yet.
					.col(ColumnDef::new(ExpectedIssues::ReleaseDate).text())
					.col(
						ColumnDef::new(ExpectedIssues::CreatedAt)
							.date_time()
							.not_null(),
					)
					.foreign_key(
						ForeignKey::create()
							.name("fk_expected_issues_series")
							.from(ExpectedIssues::Table, ExpectedIssues::SeriesId)
							.to(Series::Table, Series::Id)
							.on_delete(ForeignKeyAction::Cascade),
					)
					.to_owned(),
			)
			.await?;

		manager
			.create_index(
				Index::create()
					.if_not_exists()
					.unique()
					.name("idx_ei_identity")
					.table(ExpectedIssues::Table)
					.col(ExpectedIssues::SeriesId)
					.col(ExpectedIssues::Provider)
					.col(ExpectedIssues::ExternalId)
					.to_owned(),
			)
			.await?;
		manager
			.create_index(
				Index::create()
					.if_not_exists()
					.name("idx_ei_release_date")
					.table(ExpectedIssues::Table)
					.col(ExpectedIssues::ReleaseDate)
					.to_owned(),
			)
			.await?;

		Ok(())
	}

	async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
		manager
			.drop_table(Table::drop().table(ExpectedIssues::Table).to_owned())
			.await?;
		manager
			.drop_table(Table::drop().table(SeriesFollows::Table).to_owned())
			.await?;
		Ok(())
	}
}

#[derive(DeriveIden)]
enum SeriesFollows {
	Table,
	Id,
	UserId,
	SeriesId,
	CreatedAt,
}

#[derive(DeriveIden)]
enum ExpectedIssues {
	Table,
	Id,
	SeriesId,
	Provider,
	ExternalId,
	Number,
	Title,
	CoverUrl,
	ReleaseDate,
	CreatedAt,
}

#[derive(DeriveIden)]
enum Users {
	Table,
	Id,
}

#[derive(DeriveIden)]
enum Series {
	Table,
	Id,
}
