use async_graphql::{InputObject, Json, OneofObject, Result};
use longbox_core::utils::encryption::encrypt_string;
use metadata_integrations::merge::AutoApplyConfig;
use models::{entity::metadata_provider_config, shared::enums::MetadataProvider};
use sea_orm::{ActiveValue::NotSet, Set, Unchanged};

/// Input object for creating a metadata provider configuration
#[derive(InputObject)]
pub struct CreateMetadataProviderConfigInput {
	/// The provider type
	pub provider_type: MetadataProvider,
	/// The API token for authenticating with the provider
	pub api_token: String,
	/// Whether the provider is enabled
	pub enabled: Option<bool>,
	/// Preference order among providers (lower = preferred). Optional; defaults to 0.
	pub position: Option<i32>,
	/// Auto-apply configuration
	pub auto_apply_config: Option<Json<AutoApplyConfig>>,
	/// Optional expiration date for the API key. This is exclusively a QOL thing,
	/// since the creds don't live within the management domain of Longbox
	pub api_token_expires_at: Option<chrono::DateTime<chrono::FixedOffset>>,
}

impl CreateMetadataProviderConfigInput {
	pub async fn try_into_active_model(
		self,
		encryption_key: &String,
	) -> Result<metadata_provider_config::ActiveModel> {
		let encrypted_api_token = encrypt_string(&self.api_token, encryption_key)?;

		let auto_apply_json = self
			.auto_apply_config
			.map(|c| serde_json::to_value(c.0))
			.transpose()
			.map_err(|e| async_graphql::Error::new(e.to_string()))?;

		Ok(metadata_provider_config::ActiveModel {
			id: NotSet,
			provider_type: Set(self.provider_type),
			enabled: Set(self.enabled.unwrap_or(true)),
			position: self.position.map(Set).unwrap_or(NotSet),
			encrypted_api_token: Set(Some(encrypted_api_token)),
			api_token_expires_at: Set(self.api_token_expires_at),
			auto_apply_config: auto_apply_json.map(|v| Set(Some(v))).unwrap_or(NotSet),
			created_at: NotSet,
			updated_at: NotSet,
		})
	}
}

// I always pinch myself for not adding patch because full update is so annoying on the frontend,
// so you are welcome future me

/// A patch equivalent of [CreateMetadataProviderConfigInput], i.e. just with optional fields.
#[derive(InputObject)]
pub struct PatchMetadataProviderConfigInput {
	/// The API token for authenticating with the provider
	pub api_token: Option<String>,
	/// Whether the provider is enabled
	pub enabled: Option<bool>,
	/// Preference order among providers (lower = preferred).
	pub position: Option<i32>,
	/// Auto-apply configuration
	pub auto_apply_config: Option<Json<AutoApplyConfig>>,
	/// Optional expiration date for the API key. This is exclusively a QOL thing,
	/// since the creds don't live within the management domain of Longbox
	pub api_token_expires_at: Option<chrono::DateTime<chrono::FixedOffset>>,
}

impl PatchMetadataProviderConfigInput {
	pub async fn apply_to_model(
		self,
		model: metadata_provider_config::Model,
		encryption_key: &String,
	) -> Result<metadata_provider_config::ActiveModel> {
		let encrypted_api_token = self
			.api_token
			.map(|token| encrypt_string(&token, encryption_key))
			.transpose()?;

		let auto_apply_json = self
			.auto_apply_config
			.map(|c| serde_json::to_value(c.0))
			.transpose()
			.map_err(|e| async_graphql::Error::new(e.to_string()))?;

		Ok(metadata_provider_config::ActiveModel {
			id: Unchanged(model.id),
			provider_type: Unchanged(model.provider_type),
			enabled: self.enabled.map(Set).unwrap_or(Unchanged(model.enabled)),
			position: self.position.map(Set).unwrap_or(Unchanged(model.position)),
			encrypted_api_token: encrypted_api_token
				.map(|t| Set(Some(t)))
				.unwrap_or(Unchanged(model.encrypted_api_token)),
			api_token_expires_at: self
				.api_token_expires_at
				.map(|t| Set(Some(t)))
				.unwrap_or(Unchanged(model.api_token_expires_at)),
			auto_apply_config: auto_apply_json
				.map(|v| Set(Some(v)))
				.unwrap_or(Unchanged(model.auto_apply_config)),
			created_at: Unchanged(model.created_at),
			..Default::default()
		})
	}
}

/// An identifer for specifying the target of a metadata fetch record query. I added
/// mostly for type safety and not annoyingly wrangling both media_id and series_id
#[derive(OneofObject)]
pub enum MetadataFetchRecordId {
	Series(String),
	Media(String),
}

/// Editable search fields for an on-demand metadata match. Every field is
/// optional: a value the user supplies *overrides* what Longbox would otherwise
/// derive from the item's stored metadata or parsed filename, while a `None`
/// field falls back to that automatic derivation. Reused by both the media
/// (issue) and series fetch mutations, so callers can refine a bad auto-match
/// (e.g. a filename the parser split wrong) instead of being stuck with it.
#[derive(InputObject, Default)]
pub struct MetadataSearchInput {
	/// Series / book title to search for. On a media search this overrides both
	/// the free-text title term and the `series_name` signal, so every provider
	/// honors it (ComicVine matches on series name, Metron on the title term).
	pub title: Option<String>,
	/// Issue number to search for (media search only; ignored for series).
	pub number: Option<String>,
	/// Release / cover year, used to disambiguate same-named results.
	pub year: Option<i32>,
	/// Publisher, used to disambiguate same-named results (media search only).
	pub publisher: Option<String>,
}

impl MetadataSearchInput {
	/// A trimmed, non-empty variant of the title override, if any. Blank input
	/// from a cleared text field is treated as "no override".
	pub fn title_override(&self) -> Option<String> {
		self.title
			.as_ref()
			.map(|s| s.trim().to_string())
			.filter(|s| !s.is_empty())
	}

	/// A trimmed, non-empty variant of the issue-number override, if any.
	pub fn number_override(&self) -> Option<String> {
		self.number
			.as_ref()
			.map(|s| s.trim().to_string())
			.filter(|s| !s.is_empty())
	}

	/// A trimmed, non-empty variant of the publisher override, if any.
	pub fn publisher_override(&self) -> Option<String> {
		self.publisher
			.as_ref()
			.map(|s| s.trim().to_string())
			.filter(|s| !s.is_empty())
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn overrides_trim_and_treat_blank_as_none() {
		let input = MetadataSearchInput {
			title: Some("  Absolute Batman  ".to_string()),
			number: Some("   ".to_string()),
			year: Some(2024),
			publisher: Some("".to_string()),
		};

		// Non-blank values are trimmed; blank/whitespace-only values become None
		// so a user clearing a pre-filled field falls back to auto-derivation.
		assert_eq!(input.title_override(), Some("Absolute Batman".to_string()));
		assert_eq!(input.number_override(), None);
		assert_eq!(input.publisher_override(), None);
	}

	#[test]
	fn overrides_none_when_field_absent() {
		let input = MetadataSearchInput::default();
		assert_eq!(input.title_override(), None);
		assert_eq!(input.number_override(), None);
		assert_eq!(input.publisher_override(), None);
		assert_eq!(input.year, None);
	}
}
