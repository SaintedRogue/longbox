use crate::{
	data::{AuthContext, CoreContext},
	guard::PermissionGuard,
	input::media::MediaMetadataInput,
	object::{media::Media, metadata_fetch_record::MetadataFetchRecord},
};
use async_graphql::{Context, Object, Result, ID};
use metadata_integrations::{
	MatchCandidate, MergeStrategy, MetadataField, MetadataFieldOverride, SearchQuery,
};
use models::{
	entity::{library_config, media, media_metadata, metadata_fetch_record, series},
	shared::enums::{MetadataFetchStatus, UserPermission},
};
use sea_orm::{prelude::*, ActiveValue::Set, IntoActiveModel};
use stump_core::filesystem::metadata::ProviderClientCache;

/// Resolve the [`library_config::Model`] that governs the library a piece of
/// media belongs to, via media -> series -> library_config. Returns `None`
/// if any hop is missing (e.g. orphaned media, or a library with no config
/// row yet) rather than erroring, since write-back is best-effort.
async fn library_config_for_media(
	conn: &DatabaseConnection,
	media: &media::Model,
) -> Result<Option<library_config::Model>> {
	let Some(series_id) = media.series_id.clone() else {
		return Ok(None);
	};

	let Some(series) = series::Entity::find_by_id(series_id).one(conn).await? else {
		return Ok(None);
	};

	let Some(library_id) = series.library_id else {
		return Ok(None);
	};

	let config = library_config::Entity::find()
		.filter(library_config::Column::LibraryId.eq(library_id))
		.one(conn)
		.await?;

	Ok(config)
}

#[derive(Default)]
pub struct MediaMetadataMutation;

#[Object]
impl MediaMetadataMutation {
	#[graphql(guard = "PermissionGuard::one(UserPermission::EditMetadata)")]
	async fn update_media_metadata(
		&self,
		ctx: &Context<'_>,
		id: ID,
		input: MediaMetadataInput,
	) -> Result<Media> {
		let AuthContext { user, .. } = ctx.data::<AuthContext>()?;
		let conn = ctx.data::<CoreContext>()?.conn.as_ref();

		let model = media::ModelWithMetadata::find_for_user(user)
			.filter(media::Column::Id.eq(id.to_string()))
			.into_model::<media::ModelWithMetadata>()
			.one(conn)
			.await?
			.ok_or("Media not found")?;

		let updated_metadata = if let Some(existing) = model.metadata {
			let mut active_model = input.into_active_model();
			active_model.id = Set(existing.id);
			active_model.media_id = Set(Some(model.media.id.clone()));
			active_model.update(conn).await?
		} else {
			let mut active_model = input.into_active_model();
			active_model.media_id = Set(Some(model.media.id.clone()));
			active_model.insert(conn).await?
		};

		let model = media::ModelWithMetadata {
			media: model.media,
			metadata: Some(updated_metadata),
		};

		// Best-effort ComicInfo.xml write-back for opt-in libraries.
		// Failure is logged, never fails the mutation: the DB row is the
		// source of truth and the next successful edit will retry.
		let should_write_back =
			matches!(model.media.extension.to_lowercase().as_str(), "cbz" | "zip");
		if should_write_back {
			if let Some(config) = library_config_for_media(conn, &model.media).await? {
				if config.write_comicinfo {
					let metadata_model = model
						.metadata
						.as_ref()
						.expect("metadata was just set to Some above");
					let xml =
						stump_core::filesystem::media::ComicInfoXml::from(metadata_model)
							.to_xml_string();
					let path = std::path::PathBuf::from(&model.media.path);
					match xml {
						Ok(xml) => {
							let result = tokio::task::spawn_blocking(move || {
								stump_core::filesystem::media::write_comic_info_to_zip(
									&path, &xml,
								)
							})
							.await;
							if let Err(e) = result
								.map_err(|e| e.to_string())
								.and_then(|r| r.map_err(|e| e.to_string()))
							{
								tracing::error!(
									error = %e,
									media_id = %model.media.id,
									"ComicInfo write-back failed"
								);
							}
						},
						Err(e) => {
							tracing::error!(
								error = %e,
								media_id = %model.media.id,
								"ComicInfo serialization failed"
							);
						},
					}
				}
			}
		}

		Ok(model.into())
	}

	/// Search external metadata providers for a media item and return match candidates
	#[graphql(guard = "PermissionGuard::one(UserPermission::MetadataFetchRecordManage)")]
	async fn fetch_media_metadata(
		&self,
		ctx: &Context<'_>,
		id: ID,
	) -> Result<Vec<MatchCandidate>> {
		let AuthContext { .. } = ctx.data::<AuthContext>()?;
		let core_ctx = ctx.data::<CoreContext>()?;
		let conn = core_ctx.conn.as_ref();

		let model = media::ModelWithMetadata::find()
			.filter(media::Column::Id.eq(id.to_string()))
			.into_model::<media::ModelWithMetadata>()
			.one(conn)
			.await?
			.ok_or("Media not found")?;

		let encryption_key = core_ctx.get_encryption_key().await?;
		let provider_cache = ProviderClientCache::new(encryption_key);

		let title = model
			.metadata
			.as_ref()
			.and_then(|m| m.title.clone())
			.unwrap_or_else(|| model.media.name.clone());

		let author = match model.metadata.as_ref().and_then(|m| m.writers.clone()) {
			Some(authors_str) => {
				authors_str.split(',').map(|s| s.trim().to_string()).next()
			},
			None => None,
		};

		let isbn = model
			.metadata
			.as_ref()
			.and_then(|m| m.identifier_isbn.clone());

		let candidates = stump_core::filesystem::metadata::fetch_media_metadata(
			conn,
			&model.media.id,
			SearchQuery {
				title,
				author,
				isbn,
				..Default::default()
			},
			&provider_cache,
		)
		.await?;

		Ok(candidates)
	}

	/// Accept a match candidate and apply it to media metadata
	#[graphql(guard = "PermissionGuard::one(UserPermission::MetadataFetchRecordManage)")]
	async fn accept_media_match(
		&self,
		ctx: &Context<'_>,
		media_id: ID,
		candidate_index: u32,
		strategy: Option<MergeStrategy>,
		exclude_fields: Option<Vec<MetadataField>>,
		overrides: Option<Vec<MetadataFieldOverride>>,
	) -> Result<MetadataFetchRecord> {
		let conn = ctx.data::<CoreContext>()?.conn.as_ref();
		let strategy = strategy.unwrap_or(MergeStrategy::FillGaps);
		let exclude_fields = exclude_fields.unwrap_or_default();
		let overrides = overrides.unwrap_or_default();

		let status = metadata_fetch_record::Entity::find()
			.filter(metadata_fetch_record::Column::MediaId.eq(media_id.to_string()))
			.one(conn)
			.await?
			.ok_or("No fetch status found for this media")?;

		if status.status != MetadataFetchStatus::AwaitingReview {
			return Err(async_graphql::Error::new(format!(
				"Fetch status is {:?}, expected AwaitingReview",
				status.status
			)));
		}

		let candidates: Vec<MatchCandidate> = status
			.match_candidates
			.as_ref()
			.and_then(|v| serde_json::from_value(v.clone()).ok())
			.unwrap_or_default();

		let candidate = candidates
			.get(candidate_index as usize)
			.ok_or("Candidate index out of bounds")?;

		stump_core::filesystem::metadata::apply_media_match(
			conn,
			media_id.as_ref(),
			candidate,
			strategy,
			exclude_fields,
			overrides,
		)
		.await?;

		let updated = metadata_fetch_record::Entity::find()
			.filter(metadata_fetch_record::Column::MediaId.eq(media_id.to_string()))
			.one(conn)
			.await?
			.ok_or("Failed to re-fetch status")?;

		Ok(MetadataFetchRecord::from(updated))
	}

	/// Reject the current match candidates for a media item
	#[graphql(guard = "PermissionGuard::one(UserPermission::MetadataFetchRecordManage)")]
	async fn reject_media_match(
		&self,
		ctx: &Context<'_>,
		media_id: ID,
		candidate_index: u32,
	) -> Result<MetadataFetchRecord> {
		let conn = ctx.data::<CoreContext>()?.conn.as_ref();

		let status = metadata_fetch_record::Entity::find()
			.filter(metadata_fetch_record::Column::MediaId.eq(media_id.to_string()))
			.one(conn)
			.await?
			.ok_or("No fetch status found for this media")?;

		let existing_candidates: Vec<MatchCandidate> = status
			.match_candidates
			.as_ref()
			.and_then(|v| serde_json::from_value(v.clone()).ok())
			.unwrap_or_default();

		if (candidate_index as usize) >= existing_candidates.len() {
			return Err(async_graphql::Error::new("Candidate index out of bounds"));
		}

		let adjusted_candidates = existing_candidates
			.into_iter()
			.enumerate()
			.filter(|(i, _)| *i != candidate_index as usize)
			.map(|(_, c)| c)
			.collect::<Vec<_>>();

		let mut active = status.into_active_model();
		if adjusted_candidates.is_empty() {
			active.status = Set(MetadataFetchStatus::NoMatch);
		}
		active.match_candidates = Set(Some(serde_json::to_value(adjusted_candidates)?));

		let updated = metadata_fetch_record::Entity::update(active)
			.exec(conn)
			.await?;

		Ok(MetadataFetchRecord::from(updated))
	}

	/// Set the locked metadata fields for a media item
	#[graphql(guard = "PermissionGuard::one(UserPermission::EditMetadata)")]
	async fn set_media_locked_fields(
		&self,
		ctx: &Context<'_>,
		media_id: ID,
		locked_fields: Vec<MetadataField>,
	) -> Result<Media> {
		let AuthContext { user, .. } = ctx.data::<AuthContext>()?;
		let conn = ctx.data::<CoreContext>()?.conn.as_ref();

		let model = media::ModelWithMetadata::find_for_user(user)
			.filter(media::Column::Id.eq(media_id.to_string()))
			.into_model::<media::ModelWithMetadata>()
			.one(conn)
			.await?
			.ok_or("Media not found")?;

		let locked_json = serde_json::to_value(&locked_fields)?;

		let updated_metadata = if let Some(existing) = model.metadata {
			let mut active = existing.into_active_model();
			active.locked_fields = Set(Some(locked_json));
			active.update(conn).await?
		} else {
			let active = media_metadata::ActiveModel {
				media_id: Set(Some(model.media.id.clone())),
				locked_fields: Set(Some(locked_json)),
				..Default::default()
			};
			active.insert(conn).await?
		};

		let model = media::ModelWithMetadata {
			media: model.media,
			metadata: Some(updated_metadata),
		};

		Ok(model.into())
	}
}
