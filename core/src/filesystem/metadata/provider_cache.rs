use std::{collections::HashMap, sync::Arc};

use metadata_integrations::{
	create_provider, runtime::RuntimeHandle, MetadataProvider, MetadataProviderError,
};
use models::{
	entity::{metadata_provider_config, server_config},
	shared::enums::MetadataProvider as MetadataProviderEnum,
};
use sea_orm::{prelude::*, DatabaseConnection, SelectColumns};
use tokio::sync::{OnceCell, RwLock};

use crate::utils::encryption::decrypt_string;

/// A cache for lazily-loaded metadata provider clients.
///
/// There must be exactly ONE instance per process (it lives on
/// `ApalisWorkerState`, reachable from both `Ctx` and `JobContext`): each cached
/// client owns its rate limiter, and every client shares this cache's
/// [`RuntimeHandle`] (response cache + budget ledger) — a second instance would
/// hand out fresh limiters and split the budget accounting, which is exactly the
/// bug this design retired.
pub struct ProviderClientCache {
	clients:
		RwLock<HashMap<MetadataProviderEnum, Arc<dyn MetadataProvider + Send + Sync>>>,
	conn: Arc<DatabaseConnection>,
	/// The API-token encryption key, resolved from `server_config` on first use.
	encryption_key: OnceCell<String>,
	runtime: RuntimeHandle,
}

impl ProviderClientCache {
	/// Create the cache. Construction is infallible — the encryption key is
	/// resolved lazily on the first [`get_or_create`](Self::get_or_create).
	pub fn new(conn: Arc<DatabaseConnection>, runtime: RuntimeHandle) -> Self {
		Self {
			clients: RwLock::new(HashMap::new()),
			conn,
			encryption_key: OnceCell::new(),
			runtime,
		}
	}

	async fn encryption_key(&self) -> Result<&String, ProviderCacheError> {
		self.encryption_key
			.get_or_try_init(|| async {
				let record = server_config::Entity::find()
					.select_column(server_config::Column::EncryptionKey)
					.one(self.conn.as_ref())
					.await
					.map_err(|e| {
						ProviderCacheError::EncryptionKeyUnavailable(e.to_string())
					})?;
				record
					.and_then(|config| config.encryption_key)
					.ok_or_else(|| {
						ProviderCacheError::EncryptionKeyUnavailable(
							"encryption key is not set".to_string(),
						)
					})
			})
			.await
	}

	/// Get or create a provider client for the given configuration
	pub async fn get_or_create(
		&self,
		config: &metadata_provider_config::Model,
	) -> Result<Arc<dyn MetadataProvider + Send + Sync>, ProviderCacheError> {
		{
			let clients = self.clients.read().await;
			if let Some(client) = clients.get(&config.provider_type) {
				return Ok(Arc::clone(client));
			}
		}

		let encrypted_token = config
			.encrypted_api_token
			.as_ref()
			.ok_or(ProviderCacheError::MissingApiToken)?;

		let encryption_key = self.encryption_key().await?;
		let decrypted_token = decrypt_string(encrypted_token, encryption_key)
			.map_err(|e| ProviderCacheError::DecryptionFailed(e.to_string()))?;

		let provider_type_str = config.provider_type.to_string();
		let client =
			create_provider(&provider_type_str, decrypted_token, self.runtime.clone())
				.map_err(ProviderCacheError::ProviderCreationFailed)?;

		let client_arc: Arc<dyn MetadataProvider + Send + Sync> = Arc::from(client);

		{
			let mut clients = self.clients.write().await;
			clients.insert(config.provider_type, Arc::clone(&client_arc));
		}

		Ok(client_arc)
	}

	/// Clear all cached clients
	pub async fn clear(&self) {
		let mut clients = self.clients.write().await;
		clients.clear();
	}
}

#[derive(Debug, thiserror::Error)]
pub enum ProviderCacheError {
	#[error("Provider has no API token configured")]
	MissingApiToken,
	#[error("Failed to resolve the API-token encryption key: {0}")]
	EncryptionKeyUnavailable(String),
	#[error("Failed to decrypt API token: {0}")]
	DecryptionFailed(String),
	#[error("Failed to create provider: {0}")]
	ProviderCreationFailed(#[from] MetadataProviderError),
}
