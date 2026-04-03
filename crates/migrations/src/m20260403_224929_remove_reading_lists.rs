use sea_orm::{sqlx::Sqlite, Statement};
use sea_orm_migration::{prelude::*, schema::*};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
	async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
		// this is an interesting one! i never _actually_ created reading_lists in the initial migration script for sea-orm,
		// so only folks who migrated their data would have this table. so i will just do a safe drop if it exists, and be
		// done with it
		manager
			.drop_table(
				Table::drop()
					.table(ReadingLists::Table)
					.if_exists()
					.to_owned(),
			)
			.await?;

		Ok(())
	}

	async fn down(&self, _: &SchemaManager) -> Result<(), DbErr> {
		// we are not going to restore, see above
		Ok(())
	}
}

#[derive(DeriveIden)]
enum ReadingLists {
	Table,
}
