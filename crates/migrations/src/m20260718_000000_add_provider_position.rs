use sea_orm_migration::prelude::*;

/// Adds a `position` column to `metadata_provider_configs` used to order providers
/// by preference. Lower positions win: the lowest-position provider is the
/// "preferred" one, and it takes precedence when more than one provider yields a
/// confident metadata match (see `find_auto_apply_candidate`).
#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
	async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
		manager
			.alter_table(
				Table::alter()
					.table(MetadataProviderConfigs::Table)
					.add_column(
						ColumnDef::new(MetadataProviderConfigs::Position)
							.integer()
							.not_null()
							.default(0),
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
					.table(MetadataProviderConfigs::Table)
					.drop_column(MetadataProviderConfigs::Position)
					.to_owned(),
			)
			.await?;

		Ok(())
	}
}

#[derive(DeriveIden)]
enum MetadataProviderConfigs {
	Table,
	Position,
}
