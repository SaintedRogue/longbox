use async_graphql::{Context, Object, Result, SimpleObject};
use chrono::Utc;
use longbox_core::{
	plugin::{client_for, refresh_manifest},
	utils::encryption::{create_shared_secret, decrypt_string, encrypt_string},
};
use models::entity::plugin::{self, slugify_plugin_id};
use plugin_integrations::{merge_settings, PluginClient, PluginManifest};
use sea_orm::{prelude::*, ActiveValue::Set, ActiveValue::Unchanged};
use std::collections::BTreeMap;

use crate::{
	data::CoreContext,
	guard::ServerOwnerGuard,
	input::plugin::{PatchPluginInput, RegisterPluginInput},
	object::plugin::{Plugin, RegisteredPlugin},
};

/// Outcome of poking a plugin's health endpoint.
#[derive(SimpleObject)]
pub struct PluginTestResult {
	pub ok: bool,
	/// The plugin's own explanation when it reports unhealthy, or ours when we could not
	/// reach it at all.
	pub detail: Option<String>,
}

#[derive(Default)]
pub struct PluginMutation;

#[Object]
impl PluginMutation {
	/// Register a plugin by URL.
	///
	/// Registration requires a successful handshake: Longbox reads the manifest before it
	/// will store anything, so a row always corresponds to something that actually
	/// answered and declared what it is. `manifest` and `health` are therefore expected to
	/// be servable without the token — they carry no secrets — while capability endpoints
	/// must require it.
	///
	/// The plugin is stored **disabled**. Registering something is not the same as
	/// deciding to let it run, and the operator still has to configure it.
	#[graphql(guard = "ServerOwnerGuard")]
	async fn register_plugin(
		&self,
		ctx: &Context<'_>,
		input: RegisterPluginInput,
	) -> Result<RegisteredPlugin> {
		let core = ctx.data::<CoreContext>()?;
		let conn = core.conn.as_ref();
		let encryption_key = core.get_encryption_key().await?;

		let token = match input.token {
			Some(supplied) if !supplied.trim().is_empty() => supplied,
			_ => create_shared_secret()?,
		};

		let client = PluginClient::new(&input.base_url, Some(token.clone()))
			.map_err(|e| async_graphql::Error::new(e.to_string()))?;
		let manifest = client
			.manifest()
			.await
			.map_err(|e| async_graphql::Error::new(e.to_string()))?;

		let slug = slugify_plugin_id(&manifest.id).ok_or_else(|| {
			async_graphql::Error::new(format!(
				"Plugin declares an unusable id ({:?}); it needs at least one letter or digit",
				manifest.id
			))
		})?;

		if plugin::Entity::find()
			.filter(plugin::Column::Slug.eq(slug.clone()))
			.one(conn)
			.await?
			.is_some()
		{
			return Err(async_graphql::Error::new(format!(
				"A plugin with id `{slug}` is already registered. Remove it first if you meant to replace it."
			)));
		}

		let snapshot = serde_json::to_value(&manifest)?;
		let active = plugin::ActiveModel {
			slug: Set(slug),
			name: Set(manifest.name.clone()),
			base_url: Set(input.base_url),
			encrypted_token: Set(Some(encrypt_string(&token, &encryption_key)?)),
			enabled: Set(false),
			protocol_version: Set(Some(manifest.protocol)),
			manifest: Set(Some(snapshot)),
			last_handshake_at: Set(Some(Utc::now().into())),
			last_error: Set(None),
			..Default::default()
		};
		let model = active.insert(conn).await?;

		Ok(RegisteredPlugin {
			plugin: Plugin::from_model(model, &encryption_key),
			token,
		})
	}

	/// Patch a plugin. Returns the new token only when one was rotated.
	#[graphql(guard = "ServerOwnerGuard")]
	async fn update_plugin(
		&self,
		ctx: &Context<'_>,
		id: i32,
		input: PatchPluginInput,
	) -> Result<RegisteredPlugin> {
		let core = ctx.data::<CoreContext>()?;
		let conn = core.conn.as_ref();
		let encryption_key = core.get_encryption_key().await?;

		let model = plugin::Entity::find_by_id(id)
			.one(conn)
			.await?
			.ok_or_else(|| async_graphql::Error::new("Plugin not found"))?;

		let rotated = input.rotate_token.unwrap_or(false);
		let token = if rotated {
			create_shared_secret()?
		} else {
			model
				.encrypted_token
				.as_deref()
				.and_then(|t| decrypt_string(t, &encryption_key).ok())
				.unwrap_or_default()
		};

		// Settings are validated against the manifest the plugin declared, so a value for
		// a field it does not have — or of the wrong shape — is rejected here rather than
		// discovered as a confusing failure mid-sweep.
		let encrypted_settings = match input.settings {
			Some(incoming) => {
				let manifest = stored_manifest(&model).ok_or_else(|| {
					async_graphql::Error::new(
						"This plugin has no manifest yet — run a handshake before configuring it",
					)
				})?;
				let stored = stored_settings(&model, &encryption_key);
				let merged = merge_settings(&manifest, &stored, &incoming.0)
					.map_err(|e| async_graphql::Error::new(e.to_string()))?;
				Some(encrypt_string(
					&serde_json::to_string(&merged)?,
					&encryption_key,
				)?)
			},
			None => None,
		};

		let active = plugin::ActiveModel {
			id: Unchanged(model.id),
			base_url: input
				.base_url
				.map(Set)
				.unwrap_or(Unchanged(model.base_url.clone())),
			enabled: input.enabled.map(Set).unwrap_or(Unchanged(model.enabled)),
			encrypted_token: if rotated {
				Set(Some(encrypt_string(&token, &encryption_key)?))
			} else {
				Unchanged(model.encrypted_token.clone())
			},
			encrypted_settings: encrypted_settings
				.map(|s| Set(Some(s)))
				.unwrap_or(Unchanged(model.encrypted_settings.clone())),
			..Default::default()
		};
		let updated = active.update(conn).await?;

		Ok(RegisteredPlugin {
			plugin: Plugin::from_model(updated, &encryption_key),
			token: if rotated { token } else { String::new() },
		})
	}

	#[graphql(guard = "ServerOwnerGuard")]
	async fn delete_plugin(&self, ctx: &Context<'_>, id: i32) -> Result<bool> {
		let core = ctx.data::<CoreContext>()?;
		let deleted = plugin::Entity::delete_by_id(id)
			.exec(core.conn.as_ref())
			.await?;
		Ok(deleted.rows_affected > 0)
	}

	/// Re-read a plugin's manifest, picking up new capabilities or config fields without
	/// re-registering it.
	#[graphql(guard = "ServerOwnerGuard")]
	async fn refresh_plugin_manifest(
		&self,
		ctx: &Context<'_>,
		id: i32,
	) -> Result<Plugin> {
		let core = ctx.data::<CoreContext>()?;
		refresh_manifest(core, id)
			.await
			.map_err(|e| async_graphql::Error::new(e.to_string()))?;

		let encryption_key = core.get_encryption_key().await?;
		let model = plugin::Entity::find_by_id(id)
			.one(core.conn.as_ref())
			.await?
			.ok_or_else(|| async_graphql::Error::new("Plugin not found"))?;

		Ok(Plugin::from_model(model, &encryption_key))
	}

	/// Call a plugin's health endpoint. Unlike the other mutations this never errors on an
	/// unreachable plugin — "it is down, and here is why" is the answer, not a failure.
	#[graphql(guard = "ServerOwnerGuard")]
	async fn test_plugin(&self, ctx: &Context<'_>, id: i32) -> Result<PluginTestResult> {
		let core = ctx.data::<CoreContext>()?;
		let conn = core.conn.as_ref();
		let encryption_key = core.get_encryption_key().await?;

		let model = plugin::Entity::find_by_id(id)
			.one(conn)
			.await?
			.ok_or_else(|| async_graphql::Error::new("Plugin not found"))?;

		let result = match client_for(&model, &encryption_key) {
			Ok(client) => match client.health().await {
				Ok(health) => PluginTestResult {
					ok: health.ok,
					detail: health.detail,
				},
				Err(error) => PluginTestResult {
					ok: false,
					detail: Some(error.to_string()),
				},
			},
			Err(error) => PluginTestResult {
				ok: false,
				detail: Some(error.to_string()),
			},
		};

		longbox_core::plugin::record_outcome(
			conn,
			model.id,
			(!result.ok).then(|| {
				result
					.detail
					.clone()
					.unwrap_or_else(|| "Plugin reported unhealthy".to_string())
			}),
		)
		.await
		.map_err(|e| async_graphql::Error::new(e.to_string()))?;

		Ok(result)
	}
}

fn stored_manifest(model: &plugin::Model) -> Option<PluginManifest> {
	model
		.manifest
		.clone()
		.and_then(|m| serde_json::from_value(m).ok())
}

fn stored_settings(
	model: &plugin::Model,
	encryption_key: &String,
) -> BTreeMap<String, serde_json::Value> {
	model
		.encrypted_settings
		.as_deref()
		.and_then(|blob| decrypt_string(blob, encryption_key).ok())
		.and_then(|json| serde_json::from_str(&json).ok())
		.unwrap_or_default()
}
