use crate::{
	data::{AuthContext, CoreContext},
	guard::PermissionGuard,
	input::{media::MediaMetadataInput, metadata_provider::MetadataSearchInput},
	object::{media::Media, metadata_fetch_record::MetadataFetchRecord},
};
use async_graphql::{Context, Object, Result, ID};
use longbox_core::filesystem::metadata::ApplyActor;
use metadata_integrations::{
	MatchCandidate, MergeStrategy, MetadataField, MetadataFieldOverride, SearchQuery,
};
use models::{
	entity::{
		library_config, media, media_metadata, metadata_fetch_record,
		metadata_provider_config, series,
	},
	shared::enums::{MetadataFetchStatus, MetadataProvider, UserPermission},
};
use sea_orm::{prelude::*, ActiveValue::Set, IntoActiveModel};

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
			let config = match library_config_for_media(conn, &model.media).await {
				Ok(config) => config,
				Err(e) => {
					tracing::error!(
						error = ?e,
						media_id = %model.media.id,
						"Failed to load library config for ComicInfo write-back"
					);
					None
				},
			};
			if let Some(config) = config {
				if config.write_comicinfo {
					let metadata_model = model
						.metadata
						.as_ref()
						.expect("metadata was just set to Some above");
					let xml = longbox_core::filesystem::media::ComicInfoXml::from(
						metadata_model,
					)
					.to_xml_string();
					let path = std::path::PathBuf::from(&model.media.path);
					match xml {
						Ok(xml) => {
							let result = tokio::task::spawn_blocking(move || {
								longbox_core::filesystem::media::write_comic_info_to_zip(
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

	/// Search external metadata providers for a media item and return match candidates.
	///
	/// `query` optionally overrides the auto-derived search fields (see
	/// [`MetadataSearchInput`]); omitting it preserves the original behavior of
	/// searching by the item's stored metadata / parsed filename. `provider`
	/// scopes the search to a single provider (default: all enabled). `autoApply`
	/// defaults to `true`; the interactive match UI passes `false` so the record
	/// stays awaiting review and the user selects a candidate themselves.
	#[graphql(guard = "PermissionGuard::one(UserPermission::MetadataFetchRecordManage)")]
	async fn fetch_media_metadata(
		&self,
		ctx: &Context<'_>,
		id: ID,
		query: Option<MetadataSearchInput>,
		provider: Option<MetadataProvider>,
		auto_apply: Option<bool>,
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

		let provider_cache = core_ctx.provider_cache();

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

		let mut search = SearchQuery {
			title,
			author,
			isbn,
			..Default::default()
		};

		// Layer any user-provided overrides on top of the auto-derived query.
		// Because these become `Some`, core's metadata/filename enrichment (which
		// only fills empty fields) leaves them untouched.
		if let Some(overrides) = query {
			if let Some(title) = overrides.title_override() {
				// Set both signals: ComicVine searches by `series_name`, Metron by
				// the free-text title term — so an override must cover both.
				search.title = title.clone();
				search.series_name = Some(title);
			}
			if let Some(number) = overrides.number_override() {
				search.number = Some(number);
			}
			if let Some(year) = overrides.year {
				search.year = Some(year);
			}
			if let Some(publisher) = overrides.publisher_override() {
				search.publisher = Some(publisher);
			}
		}

		let candidates = longbox_core::filesystem::metadata::fetch_media_metadata(
			conn,
			&model.media.id,
			search,
			provider,
			auto_apply.unwrap_or(true),
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
		let core_ctx = ctx.data::<CoreContext>()?;
		let conn = core_ctx.conn.as_ref();
		let strategy = strategy.unwrap_or(MergeStrategy::FillGaps);
		let exclude_fields = exclude_fields.unwrap_or_default();
		let overrides = overrides.unwrap_or_default();

		// Needed to re-fetch a list-view provider's full record before applying it.
		let provider_configs = metadata_provider_config::Entity::find()
			.filter(metadata_provider_config::Column::Enabled.eq(true))
			.all(conn)
			.await?;

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

		// An explicit user accept wins over an external-id collision, but the
		// duplicate is worth surfacing in the logs (the auto-apply path refuses).
		if let Some(holder_id) =
			longbox_core::filesystem::metadata::find_media_external_id_holder(
				conn,
				media_id.as_ref(),
				&candidate.provider,
				&candidate.external_id,
			)
			.await
			.unwrap_or(None)
		{
			tracing::warn!(
				media_id = media_id.as_ref(),
				holder_id,
				provider = candidate.provider,
				external_id = candidate.external_id,
				"Accepting a match whose external id another media in this library already holds"
			);
		}

		// The stored candidate is whatever search returned, and for a list-view provider
		// that is a card: title, publisher, cover, date. The review grid fetches the full
		// record to *display*, but that happens in the browser — the accept mutation only
		// receives an index, so without this it would write the card back and the operator
		// would watch the title change while the summary, credits, characters, page count
		// and ISBN they just reviewed silently failed to land.
		//
		// Providers whose search is already complete return the candidate untouched.
		let candidate = longbox_core::filesystem::metadata::hydrate_candidate_for_apply(
			candidate,
			&provider_configs,
			&core_ctx.provider_cache(),
			true,
		)
		.await;

		longbox_core::filesystem::metadata::apply_media_match(
			conn,
			media_id.as_ref(),
			&candidate,
			strategy,
			exclude_fields,
			overrides,
			// The operator picked this match, so overridden fields are attributed to
			// them and locked against later fetches.
			ApplyActor::User,
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
