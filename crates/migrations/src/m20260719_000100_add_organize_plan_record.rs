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
					.col(
						ColumnDef::new(OrganizePlanRecord::LibraryId)
							.text()
							.not_null(),
					)
					.col(ColumnDef::new(OrganizePlanRecord::Status).text().not_null())
					.col(
						ColumnDef::new(OrganizePlanRecord::PlanJson)
							.text()
							.not_null(),
					)
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
							.from(
								OrganizePlanRecord::Table,
								OrganizePlanRecord::LibraryId,
							)
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
