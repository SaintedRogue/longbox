use async_graphql::{Context, Object, Result, SimpleObject};
use longbox_core::plugin::local;
use models::entity::plugin;
use plugin_integrations::PROTOCOL_VERSION;
use sea_orm::{prelude::*, QueryOrder};

use crate::{data::CoreContext, guard::ServerOwnerGuard, object::plugin::Plugin};

/// A plugin directory sitting under `{config}/plugins`, whether or not it is registered.
#[derive(SimpleObject)]
pub struct DiscoveredLocalPlugin {
	/// Directory name, and the handle `installLocalPlugin` takes.
	pub dir: String,
	/// Id the directory declares. Slugified, this is what the plugin would be registered as.
	pub id: String,
	pub name: String,
	pub version: Option<String>,
	pub description: Option<String>,
	/// The command Longbox would run. Surfaced deliberately: installing this means
	/// executing it inside the server, so the operator should see it before agreeing to.
	pub command: Vec<String>,
	/// Whether a plugin with this id is already registered, so the UI can offer "install"
	/// or say why it cannot.
	pub installed: bool,
}

#[derive(Default)]
pub struct PluginQuery;

#[Object]
impl PluginQuery {
	/// Every registered plugin.
	///
	/// Server-owner only, and not because the list is especially sensitive: a plugin is
	/// an arbitrary URL this server will call with a credential attached, so who may see
	/// and change that set is the same question as who may administer the server.
	/// Plugin directories found under `{config}/plugins`, installed or not.
	///
	/// This is the route that needs no catalogue and no container: drop a directory onto
	/// the config volume and it appears here ready to install.
	#[graphql(guard = "ServerOwnerGuard")]
	async fn discovered_local_plugins(
		&self,
		ctx: &Context<'_>,
	) -> Result<Vec<DiscoveredLocalPlugin>> {
		let core = ctx.data::<CoreContext>()?;

		let registered: std::collections::HashSet<String> = plugin::Entity::find()
			.all(core.conn.as_ref())
			.await?
			.into_iter()
			.map(|p| p.slug)
			.collect();

		Ok(local::discover(&core.config.get_config_dir())
			.into_iter()
			.map(|found| {
				let installed = plugin::slugify_plugin_id(&found.descriptor.id)
					.is_some_and(|slug| registered.contains(&slug));
				DiscoveredLocalPlugin {
					dir: found.dir,
					id: found.descriptor.id,
					name: found.descriptor.name,
					version: found.descriptor.version,
					description: found.descriptor.description,
					command: found.descriptor.command,
					installed,
				}
			})
			.collect())
	}

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
