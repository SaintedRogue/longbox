use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
	async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
		// When the calendar last pulled, regardless of *how* it was pulled.
		//
		// `scheduled_jobs.last_run_at` is the scheduler's own bookkeeping and only exists
		// when a schedule has been configured — but a manual sync must work without one,
		// and "when did this last update?" is a question about the calendar rather than
		// about the schedule. So it is recorded here, by both paths, and there is exactly
		// one answer to it.
		manager
			.alter_table(
				Table::alter()
					.table(ServerConfig::Table)
					.add_column(
						ColumnDef::new(ServerConfig::LastReleaseCalendarSyncAt)
							.date_time(),
					)
					.to_owned(),
			)
			.await?;

		Ok(())
	}

	async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
		manager
			.alter_table(
				Table::alter()
					.table(ServerConfig::Table)
					.drop_column(ServerConfig::LastReleaseCalendarSyncAt)
					.to_owned(),
			)
			.await?;

		Ok(())
	}
}

#[derive(DeriveIden)]
enum ServerConfig {
	Table,
	LastReleaseCalendarSyncAt,
}
