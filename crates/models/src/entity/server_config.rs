use async_graphql::SimpleObject;
use sea_orm::{entity::prelude::*, FromQueryResult};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq, SimpleObject)]
#[sea_orm(table_name = "server_config")]
#[graphql(name = "ServerConfigModel")]
pub struct Model {
	#[sea_orm(primary_key, auto_increment = true)]
	pub id: i32,
	#[sea_orm(column_type = "Text", nullable)]
	pub public_url: Option<String>,
	pub initial_wal_setup_complete: bool,
	#[sea_orm(column_type = "Text", nullable)]
	#[graphql(skip)]
	pub encryption_key: Option<String>,
	#[sea_orm(column_type = "Text", nullable)]
	#[graphql(skip)]
	pub jwt_access_secret: Option<String>,
	#[sea_orm(column_type = "Text", nullable)]
	#[graphql(skip)]
	pub jwt_refresh_secret: Option<String>,
	/// When the server owner acknowledged the terms of using **unofficial** metadata
	/// providers — those with no official API, reached only by driving a site's own
	/// session-authenticated endpoints with the operator's personal login.
	///
	/// `None` means not acknowledged, and providers in that class must be **absent**
	/// from the add-provider list entirely rather than merely disabled. A timestamp
	/// (not a bool) so the acceptance is auditable and can be cleared to re-prompt
	/// if the disclosure wording changes.
	pub unofficial_providers_acknowledged_at: Option<DateTimeUtc>,
}

#[derive(FromQueryResult)]
pub struct EncryptionKeySelect {
	pub encryption_key: Option<String>,
}

#[derive(FromQueryResult)]
pub struct JwtSecretsSelect {
	pub jwt_access_secret: Option<String>,
	pub jwt_refresh_secret: Option<String>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
