use async_graphql::SimpleObject;
use chrono::Utc;
use sea_orm::{
	prelude::{async_trait::async_trait, *},
	ActiveValue, DeriveEntityModel,
};

/// A registered out-of-tree extension: an HTTP service the operator runs, which
/// Longbox calls to obtain functionality that isn't in the release.
///
/// Deliberately *not* modelled as another `MetadataProvider` variant. That enum is a
/// `DeriveActiveEnum` closed at compile time and matched on in half a dozen places, so
/// every plugin would have meant a migration and a release. A plugin is its own kind of
/// thing, identified by a row rather than by a variant, which is the entire point.
#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq, SimpleObject)]
#[graphql(name = "PluginModel")]
#[sea_orm(table_name = "plugins")]
pub struct Model {
	#[sea_orm(primary_key, auto_increment = true)]
	pub id: i32,
	/// Stable local identity, slugified from the manifest id at registration and never
	/// rewritten. `release_calendar_entries.provider` stores `plugin:{slug}`, so a plugin that
	/// renames itself upstream must not orphan the rows it already contributed.
	#[sea_orm(unique)]
	pub slug: String,
	/// Display name, refreshed from the manifest on each successful handshake.
	pub name: String,
	/// Root of the plugin's protocol endpoints, e.g. `http://my-plugin:8080/longbox/v1`.
	///
	/// For a [`PluginKind::Local`] plugin this is rewritten each time the process is
	/// launched, because Longbox assigns the loopback port. It is still stored rather than
	/// held only in memory so the settings UI can show where a running plugin is answering.
	pub base_url: String,
	/// How Longbox reaches this plugin: a service the operator runs (`remote`), or a
	/// directory here that Longbox launches (`local`). See [`PluginKind`].
	pub kind: String,
	/// Directory name under `{config_dir}/plugins`, for `local` plugins only. Stored rather
	/// than derived from the slug so a later rename cannot strand the installed files.
	pub install_dir: Option<String>,
	/// Where the installed files came from, so the UI can offer a reinstall and say what it
	/// would be reinstalling. `None` for a plugin the operator placed by hand.
	pub source_url: Option<String>,
	/// The shared secret Longbox generated for this plugin, encrypted at rest. Never
	/// leaves the server: it is shown to the operator exactly once, at registration.
	#[graphql(skip)]
	pub encrypted_token: Option<String>,
	/// Registration does not imply trust — a plugin stays disabled until a handshake
	/// has actually succeeded, and the operator turns it on deliberately.
	pub enabled: bool,
	/// Protocol version advertised by the last successful handshake.
	pub protocol_version: Option<i32>,
	/// Snapshot of that handshake's manifest: version, capabilities, declared config
	/// schema. Retained so the settings UI can still render a plugin's config form while
	/// the plugin itself is unreachable.
	#[sea_orm(column_type = "Json", nullable)]
	#[graphql(skip)]
	pub manifest: Option<serde_json::Value>,
	/// Operator-supplied values for the manifest's declared config fields, encrypted
	/// whole: a plugin may declare `secret` fields, and those must not sit in plaintext
	/// merely because the rest of the blob is harmless.
	#[graphql(skip)]
	pub encrypted_settings: Option<String>,
	#[sea_orm(column_type = "custom(\"DATETIME\")", nullable)]
	pub last_handshake_at: Option<DateTimeWithTimeZone>,
	/// Why the last handshake failed, if it did. Cleared on success.
	pub last_error: Option<String>,
	#[sea_orm(column_type = "custom(\"DATETIME\")")]
	pub created_at: DateTimeWithTimeZone,
	#[sea_orm(column_type = "custom(\"DATETIME\")", nullable)]
	pub updated_at: Option<DateTimeWithTimeZone>,
}

/// How Longbox reaches a plugin.
///
/// Stored as text rather than a `DeriveActiveEnum` for the same reason plugins are not a
/// `MetadataProvider` variant: an unrecognised value must degrade to something sensible
/// rather than fail a query, so a database written by a newer build still loads here.
#[derive(Debug, Clone, Copy, PartialEq, Eq, async_graphql::Enum)]
pub enum PluginKind {
	/// A service the operator runs; Longbox only holds its URL.
	Remote,
	/// A directory under `{config_dir}/plugins` that Longbox launches as a child process
	/// and reaches over loopback.
	Local,
}

impl PluginKind {
	pub fn as_str(self) -> &'static str {
		match self {
			Self::Remote => "remote",
			Self::Local => "local",
		}
	}
}

impl Model {
	/// The value this plugin writes into `release_calendar_entries.provider`, and the id under
	/// which its contributions are attributed anywhere a provider id is expected.
	pub fn provider_id(&self) -> String {
		provider_id_for(&self.slug)
	}

	/// Anything unrecognised reads as [`PluginKind::Remote`], which is the behaviour a
	/// pre-`kind` row needs anyway and never launches a process by accident.
	pub fn plugin_kind(&self) -> PluginKind {
		match self.kind.as_str() {
			"local" => PluginKind::Local,
			_ => PluginKind::Remote,
		}
	}
}

/// See [`Model::provider_id`]. Free function so callers holding only a slug (a delete
/// sweep, a test) don't have to construct a whole model.
pub fn provider_id_for(slug: &str) -> String {
	format!("plugin:{slug}")
}

/// Reduce an arbitrary manifest id to a slug safe to embed in a provider id: lowercase
/// alphanumerics, with every other run collapsed to a single `-`.
///
/// Returns `None` for input that slugifies to nothing, so a plugin declaring an id of
/// `"???"` is rejected at registration rather than silently sharing the empty slug with
/// the next one.
pub fn slugify_plugin_id(raw: &str) -> Option<String> {
	let mut slug = String::with_capacity(raw.len());
	let mut pending_separator = false;

	for ch in raw.chars() {
		if ch.is_ascii_alphanumeric() {
			if pending_separator && !slug.is_empty() {
				slug.push('-');
			}
			pending_separator = false;
			slug.push(ch.to_ascii_lowercase());
		} else {
			pending_separator = true;
		}
	}

	(!slug.is_empty()).then_some(slug)
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

#[async_trait]
impl ActiveModelBehavior for ActiveModel {
	async fn before_save<C>(mut self, _db: &C, insert: bool) -> Result<Self, DbErr>
	where
		C: ConnectionTrait,
	{
		if insert {
			self.created_at = ActiveValue::Set(DateTimeWithTimeZone::from(Utc::now()));
		} else {
			self.updated_at =
				ActiveValue::Set(Some(DateTimeWithTimeZone::from(Utc::now())));
		}

		Ok(self)
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn slugify_lowercases_and_collapses_separators() {
		assert_eq!(
			slugify_plugin_id("com.example.MyPlugin"),
			Some("com-example-myplugin".to_string())
		);
		assert_eq!(
			slugify_plugin_id("  spaced   out  "),
			Some("spaced-out".to_string())
		);
		assert_eq!(
			slugify_plugin_id("already-fine"),
			Some("already-fine".to_string())
		);
	}

	/// A separator run must never produce a leading or doubled `-`, or two different
	/// manifest ids could collide on one slug.
	#[test]
	fn slugify_never_emits_leading_or_repeated_separators() {
		assert_eq!(slugify_plugin_id("...a...b..."), Some("a-b".to_string()));
		assert_eq!(slugify_plugin_id("--x--"), Some("x".to_string()));
	}

	#[test]
	fn slugify_rejects_input_with_nothing_to_slugify() {
		assert_eq!(slugify_plugin_id("???"), None);
		assert_eq!(slugify_plugin_id(""), None);
	}

	#[test]
	fn provider_id_is_namespaced() {
		assert_eq!(provider_id_for("my-plugin"), "plugin:my-plugin");
	}
}
