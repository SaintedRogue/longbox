use async_graphql::{Context, Object, Result};
use models::entity::plugin;
use plugin_integrations::PROTOCOL_VERSION;
use sea_orm::{prelude::*, QueryOrder};

use crate::{data::CoreContext, guard::ServerOwnerGuard, object::plugin::Plugin};

#[derive(Default)]
pub struct PluginQuery;

#[Object]
impl PluginQuery {
	/// Every registered plugin.
	///
	/// Server-owner only, and not because the list is especially sensitive: a plugin is
	/// an arbitrary URL this server will call with a credential attached, so who may see
	/// and change that set is the same question as who may administer the server.
	#[graphql(guard = "ServerOwnerGuard")]
	async fn plugins(&self, ctx: &Context<'_>) -> Result<Vec<Plugin>> {
		let core = ctx.data::<CoreContext>()?;
		let encryption_key = core.get_encryption_key().await?;

		let rows = plugin::Entity::find()
			.order_by_asc(plugin::Column::Name)
			.order_by_asc(plugin::Column::Id)
			.all(core.conn.as_ref())
			.await?;

		Ok(rows
			.into_iter()
			.map(|row| Plugin::from_model(row, &encryption_key))
			.collect())
	}

	#[graphql(guard = "ServerOwnerGuard")]
	async fn plugin_by_id(&self, ctx: &Context<'_>, id: i32) -> Result<Option<Plugin>> {
		let core = ctx.data::<CoreContext>()?;
		let encryption_key = core.get_encryption_key().await?;

		Ok(plugin::Entity::find_by_id(id)
			.one(core.conn.as_ref())
			.await?
			.map(|row| Plugin::from_model(row, &encryption_key)))
	}

	/// The plugin protocol revision this build speaks, so the settings UI can tell an
	/// operator which version a plugin they are about to write should target.
	async fn plugin_protocol_version(&self) -> i32 {
		PROTOCOL_VERSION
	}
}
