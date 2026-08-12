use sea_orm_migration::prelude::*;

/// Adds `unofficial_providers_acknowledged_at` to the singleton `server_config` row.
///
/// Gates metadata providers that have no official/public API and can only be reached
/// by driving the site's own session-authenticated endpoints with the operator's
/// personal login — currently League of Comic Geeks, whose Terms of Use prohibit
/// automated access. Such providers stay **absent** from the add-provider list (not
/// merely disabled) until the operator acknowledges that they are acting as
/// themselves, with their own account, and accept that.
///
/// Deliberately a nullable timestamp rather than a boolean: the acknowledgement is
/// auditable (when did the operator accept?) and can be cleared to re-prompt if the
/// wording ever changes.
#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
	async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
		manager
			.alter_table(
				Table::alter()
					.table(ServerConfig::Table)
					.add_column(
						ColumnDef::new(ServerConfig::UnofficialProvidersAcknowledgedAt)
							.timestamp()
							.null(),
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
					.drop_column(ServerConfig::UnofficialProvidersAcknowledgedAt)
					.to_owned(),
			)
			.await?;

		Ok(())
	}
}

#[derive(DeriveIden)]
enum ServerConfig {
	Table,
	UnofficialProvidersAcknowledgedAt,
}
