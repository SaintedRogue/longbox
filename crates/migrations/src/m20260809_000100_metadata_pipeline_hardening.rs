use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
	async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
		manager
			.create_table(
				Table::create()
					.table(MetadataResponseCache::Table)
					.if_not_exists()
					.col(
						ColumnDef::new(MetadataResponseCache::Id)
							.integer()
							.not_null()
							.auto_increment()
							.primary_key(),
					)
					.col(
						ColumnDef::new(MetadataResponseCache::Provider)
							.text()
							.not_null(),
					)
					// SHA-256 hex of the normalized request URL (api_key stripped,
					// query pairs sorted) — see metadata_integrations::response_cache.
					.col(
						ColumnDef::new(MetadataResponseCache::CacheKey)
							.text()
							.not_null(),
					)
					// "detail" | "list" — freshness window class. TTLs are evaluated at
					// read time, so no expiry column exists here on purpose.
					.col(
						ColumnDef::new(MetadataResponseCache::Kind)
							.text()
							.not_null(),
					)
					.col(
						ColumnDef::new(MetadataResponseCache::Body)
							.text()
							.not_null(),
					)
					.col(
						ColumnDef::new(MetadataResponseCache::CreatedAt)
							.date_time()
							.not_null(),
					)
					.to_owned(),
			)
			.await?;

		manager
			.create_index(
				Index::create()
					.if_not_exists()
					.unique()
					.name("idx_mrc_provider_key")
					.table(MetadataResponseCache::Table)
					.col(MetadataResponseCache::Provider)
					.col(MetadataResponseCache::CacheKey)
					.to_owned(),
			)
			.await?;

		manager
			.create_table(
				Table::create()
					.table(MetadataApiUsage::Table)
					.if_not_exists()
					.col(
						ColumnDef::new(MetadataApiUsage::Id)
							.integer()
							.not_null()
							.auto_increment()
							.primary_key(),
					)
					.col(ColumnDef::new(MetadataApiUsage::Provider).text().not_null())
					// URL path with numeric segments folded to {id} — diagnostics only;
					// budget counting sums the provider regardless of endpoint.
					.col(
						ColumnDef::new(MetadataApiUsage::EndpointKey)
							.text()
							.not_null(),
					)
					// Epoch milliseconds. Integer math keeps the rolling-window pruning
					// a single comparison; rows never outlive their provider's window.
					.col(
						ColumnDef::new(MetadataApiUsage::CalledAt)
							.big_integer()
							.not_null(),
					)
					.to_owned(),
			)
			.await?;

		manager
			.create_index(
				Index::create()
					.if_not_exists()
					.name("idx_mau_provider_called")
					.table(MetadataApiUsage::Table)
					.col(MetadataApiUsage::Provider)
					.col(MetadataApiUsage::CalledAt)
					.to_owned(),
			)
			.await?;

		manager
			.alter_table(
				Table::alter()
					.table(MediaMetadata::Table)
					.add_column(ColumnDef::new(MediaMetadata::MetronId).text())
					.to_owned(),
			)
			.await?;

		Ok(())
	}

	async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
		manager
			.alter_table(
				Table::alter()
					.table(MediaMetadata::Table)
					.drop_column(MediaMetadata::MetronId)
					.to_owned(),
			)
			.await?;
		manager
			.drop_table(Table::drop().table(MetadataApiUsage::Table).to_owned())
			.await?;
		manager
			.drop_table(Table::drop().table(MetadataResponseCache::Table).to_owned())
			.await?;
		Ok(())
	}
}

#[derive(DeriveIden)]
enum MetadataResponseCache {
	Table,
	Id,
	Provider,
	CacheKey,
	Kind,
	Body,
	CreatedAt,
}

#[derive(DeriveIden)]
enum MetadataApiUsage {
	Table,
	Id,
	Provider,
	EndpointKey,
	CalledAt,
}

#[derive(DeriveIden)]
enum MediaMetadata {
	Table,
	MetronId,
}
