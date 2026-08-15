use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
	async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
		manager
			.create_table(
				Table::create()
					.table(Plugins::Table)
					.if_not_exists()
					.col(
						ColumnDef::new(Plugins::Id)
							.integer()
							.not_null()
							.auto_increment()
							.primary_key(),
					)
					// Stable local identity, slugified from the manifest id at
					// registration and never rewritten afterwards. `expected_issues.provider`
					// stores `plugin:{slug}`, so a plugin that renames itself upstream must
					// not orphan the rows it already contributed.
					.col(ColumnDef::new(Plugins::Slug).text().not_null())
					.col(ColumnDef::new(Plugins::Name).text().not_null())
					.col(ColumnDef::new(Plugins::BaseUrl).text().not_null())
					// The shared secret Longbox generates and the plugin must echo back in
					// `Authorization`. Encrypted with the server encryption key, like every
					// other credential we hold.
					.col(ColumnDef::new(Plugins::EncryptedToken).text())
					// Registration does not trust a plugin by default: it stays disabled
					// until a handshake has actually succeeded.
					.col(
						ColumnDef::new(Plugins::Enabled)
							.boolean()
							.not_null()
							.default(false),
					)
					.col(ColumnDef::new(Plugins::ProtocolVersion).integer())
					// Snapshot of the last successful manifest: name, version, capabilities
					// and the declared config schema. Kept so the settings UI can render a
					// plugin's config form while the plugin itself is unreachable.
					.col(ColumnDef::new(Plugins::Manifest).json())
					// Operator-supplied values for the manifest's declared config fields,
					// encrypted whole — a plugin may declare `secret` fields and those must
					// not sit in plaintext just because the rest of the blob is harmless.
					.col(ColumnDef::new(Plugins::EncryptedSettings).text())
					.col(ColumnDef::new(Plugins::LastHandshakeAt).date_time())
					.col(ColumnDef::new(Plugins::LastError).text())
					.col(ColumnDef::new(Plugins::CreatedAt).date_time().not_null())
					.col(ColumnDef::new(Plugins::UpdatedAt).date_time())
					.to_owned(),
			)
			.await?;

		manager
			.create_index(
				Index::create()
					.if_not_exists()
					.unique()
					.name("idx_plugins_slug")
					.table(Plugins::Table)
					.col(Plugins::Slug)
					.to_owned(),
			)
			.await?;

		Ok(())
	}

	async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
		manager
			.drop_table(Table::drop().table(Plugins::Table).to_owned())
			.await?;
		Ok(())
	}
}

#[derive(DeriveIden)]
enum Plugins {
	Table,
	Id,
	Slug,
	Name,
	BaseUrl,
	EncryptedToken,
	Enabled,
	ProtocolVersion,
	Manifest,
	EncryptedSettings,
	LastHandshakeAt,
	LastError,
	CreatedAt,
	UpdatedAt,
}
