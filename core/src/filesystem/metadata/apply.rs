use metadata_integrations::{
	AutoApplyConfig, ExternalMediaMetadata, ExternalMetadata, ExternalSeriesMetadata,
	FieldMerger, MatchCandidate, MergeStrategy, MetadataField, MetadataFieldOverride,
};
use models::{
	entity::{media_metadata, metadata_fetch_record, series_metadata},
	shared::enums::MetadataFetchStatus,
};
use rust_decimal::prelude::FromPrimitive;
use sea_orm::{prelude::*, IntoActiveModel, Set};
use serde_json::Value as JsonValue;

use super::{
	enrichment::{self, ApplyActor, EnrichmentTarget},
	ProviderClientCache,
};
use crate::CoreError;

/// Apply the given match candidate to series metadata, merging fields
/// according to the provided strategy and locked fields
pub async fn apply_series_match<C>(
	conn: &C,
	series_id: &str,
	candidate: &MatchCandidate,
	strategy: MergeStrategy,
	exclude_fields: Vec<MetadataField>,
	overrides: Vec<MetadataFieldOverride>,
	actor: ApplyActor,
) -> Result<(), CoreError>
where
	C: ConnectionTrait,
{
	let ext = match &candidate.metadata {
		ExternalMetadata::Series(s) => s,
		_ => {
			return Err(CoreError::InternalError(format!(
				"Candidate metadata is not series type for series {}",
				series_id
			)));
		},
	};

	let existing = series_metadata::Entity::find_by_id(series_id)
		.one(conn)
		.await?;

	match existing {
		Some(model) => {
			let mut merger = FieldMerger::with_overrides(
				strategy,
				parse_locked_fields(&model.locked_fields),
				exclude_fields,
				overrides,
			);

			let mut active = model.clone().into_active_model();
			active.metadata_source = Set(Some(candidate.provider.clone()));
			active.metadata_external_id = Set(Some(candidate.external_id.clone()));

			apply_series_fields(&mut merger, &model, &mut active, ext);

			series_metadata::Entity::update(active).exec(conn).await?;

			enrichment::record_applied_match(
				conn,
				EnrichmentTarget::Series(series_id),
				candidate,
				actor,
				merger.merged_fields(),
				merger.overridden_fields(),
			)
			.await?;
		},
		None => {
			let active = build_series_metadata_insert(
				series_id,
				ext,
				&candidate.provider,
				&candidate.external_id,
			);
			series_metadata::Entity::insert(active).exec(conn).await?;

			enrichment::record_applied_match(
				conn,
				EnrichmentTarget::Series(series_id),
				candidate,
				actor,
				&enrichment::series_fields_present(ext),
				&[],
			)
			.await?;
		},
	}

	mark_fetch_status_accepted(conn, Some(series_id), None, candidate).await?;

	Ok(())
}

/// Apply the given match candidate to media metadata, merging fields
/// according to the provided strategy and locked fields
pub async fn apply_media_match<C>(
	conn: &C,
	media_id: &str,
	candidate: &MatchCandidate,
	strategy: MergeStrategy,
	exclude_fields: Vec<MetadataField>,
	overrides: Vec<MetadataFieldOverride>,
	actor: ApplyActor,
) -> Result<(), CoreError>
where
	C: ConnectionTrait,
{
	let ext = match &candidate.metadata {
		ExternalMetadata::Media(m) => m,
		_ => {
			return Err(CoreError::InternalError(format!(
				"Candidate metadata is not media type for media {}",
				media_id
			)));
		},
	};

	let existing = media_metadata::Entity::find()
		.filter(media_metadata::Column::MediaId.eq(media_id))
		.one(conn)
		.await?;

	match existing {
		Some(model) => {
			let mut merger = FieldMerger::with_overrides(
				strategy,
				parse_locked_fields(&model.locked_fields),
				exclude_fields,
				overrides,
			);

			let mut active = model.clone().into_active_model();
			active.metadata_source = Set(Some(candidate.provider.clone()));
			active.metadata_external_id = Set(Some(candidate.external_id.clone()));

			apply_media_fields(&mut merger, &model, &mut active, ext);

			media_metadata::Entity::update(active).exec(conn).await?;

			enrichment::record_applied_match(
				conn,
				EnrichmentTarget::Media(media_id),
				candidate,
				actor,
				merger.merged_fields(),
				merger.overridden_fields(),
			)
			.await?;
		},
		None => {
			let active = build_media_metadata_insert(
				media_id,
				ext,
				&candidate.provider,
				&candidate.external_id,
			);
			media_metadata::Entity::insert(active).exec(conn).await?;

			// A fresh insert writes every field the provider supplied, so the whole
			// payload is attributable to it. Nothing was overridden: overrides only
			// apply on top of an existing record.
			enrichment::record_applied_match(
				conn,
				EnrichmentTarget::Media(media_id),
				candidate,
				actor,
				&enrichment::media_fields_present(ext),
				&[],
			)
			.await?;
		},
	}

	mark_fetch_status_accepted(conn, None, Some(media_id), candidate).await?;

	Ok(())
}

/// Fetch a candidate's full metadata before it is written, when its provider's search
/// only returns list rows.
///
/// Some providers' search endpoints are list views: League of Comic Geeks has no API at
/// all, so a search result is a card with a title, publisher, cover and date. That is
/// enough to rank a result and to show it in a list, but writing it would store a
/// near-empty record. Auto-apply has no human in the loop to trigger the detail fetch the
/// review dialog does, so it has to do it here — for the one candidate it is about to
/// write, and only for providers that say they need it.
///
/// Returns the candidate unchanged if the provider's search is already complete, if its
/// client cannot be built, or if the fetch fails. A thin auto-applied record is a worse
/// outcome than a slightly stale one, but losing the match entirely is worse than both.
pub async fn hydrate_candidate_for_apply(
	candidate: &MatchCandidate,
	provider_configs: &[models::entity::metadata_provider_config::Model],
	provider_cache: &ProviderClientCache,
	is_media: bool,
) -> MatchCandidate {
	let Some(config) = provider_configs
		.iter()
		.find(|config| config.provider_type.provider_id() == candidate.provider)
	else {
		return candidate.clone();
	};

	let Ok(provider) = provider_cache.get_or_create(config).await else {
		return candidate.clone();
	};

	if !provider.search_returns_partial_metadata() {
		return candidate.clone();
	}

	let fetched = if is_media {
		provider
			.fetch_media_metadata(&candidate.external_id)
			.await
			.map(ExternalMetadata::Media)
	} else {
		provider
			.fetch_series_metadata(&candidate.external_id)
			.await
			.map(ExternalMetadata::Series)
	};

	match fetched {
		Ok(metadata) => MatchCandidate {
			metadata,
			..candidate.clone()
		},
		Err(error) => {
			tracing::warn!(
				provider = candidate.provider,
				external_id = candidate.external_id,
				?error,
				"Could not fetch full metadata before auto-apply; applying the search \
				 result as-is"
			);
			candidate.clone()
		},
	}
}

/// Given a list of candidates and a set of provider configs, find the best
/// candidate whose provider has auto-apply enabled and whose confidence meets
/// the threshold.
///
/// Note: A provider _should_ sort the candidates already, so this function takes that
/// assumption and does not sort
pub fn find_auto_apply_candidate(
	candidates: &[MatchCandidate],
	provider_configs: &[models::entity::metadata_provider_config::Model],
) -> Option<(MatchCandidate, AutoApplyConfig)> {
	// Evaluate providers in preference order (lowest `position` first, ties by id) so
	// that when more than one provider returns a confident match, the user's preferred
	// provider wins. Candidates are pre-sorted by confidence within each provider.
	let mut ordered: Vec<_> = provider_configs.iter().collect();
	ordered.sort_by_key(|c| (c.position, c.id));

	for config in ordered {
		let Some(auto_config) = config
			.auto_apply_config
			.as_ref()
			.and_then(|v| serde_json::from_value::<AutoApplyConfig>(v.clone()).ok())
		else {
			continue;
		};
		if !auto_config.enabled {
			continue;
		}

		let best = candidates.iter().find(|candidate| {
			candidate.provider == config.provider_type.provider_id()
				&& Decimal::from_f32(candidate.confidence).unwrap_or(Decimal::ZERO)
					>= auto_config.threshold
		});
		if let Some(candidate) = best {
			return Some((candidate.clone(), auto_config));
		}
	}

	None
}

/// Find another series in the same library already holding `(provider,
/// external_id)`. The auto-apply path must not silently bind a second series to
/// the same external identity — that's usually a duplicate the user should
/// merge, so the fetch record is left awaiting review instead. Scoped to the
/// library because external ids legitimately repeat across libraries (same
/// reasoning as the organizer's lookup in `organizer/apply.rs`). Returns the
/// holder's series id.
pub async fn find_series_external_id_holder<C>(
	conn: &C,
	series_id: &str,
	provider: &str,
	external_id: &str,
) -> Result<Option<String>, CoreError>
where
	C: ConnectionTrait,
{
	use models::entity::series;

	let library_id = series::Entity::find_by_id(series_id)
		.one(conn)
		.await?
		.and_then(|s| s.library_id);
	let Some(library_id) = library_id else {
		return Ok(None);
	};

	let holder_ids: Vec<String> = series_metadata::Entity::find()
		.filter(series_metadata::Column::MetadataSource.eq(provider))
		.filter(series_metadata::Column::MetadataExternalId.eq(external_id))
		.filter(series_metadata::Column::SeriesId.ne(series_id))
		.all(conn)
		.await?
		.into_iter()
		.map(|m| m.series_id)
		.collect();
	if holder_ids.is_empty() {
		return Ok(None);
	}

	let holder = series::Entity::find()
		.filter(series::Column::Id.is_in(holder_ids))
		.filter(series::Column::LibraryId.eq(library_id))
		.one(conn)
		.await?;
	Ok(holder.map(|s| s.id))
}

/// The media twin of [`find_series_external_id_holder`]: another media item in
/// the same library already holding `(provider, external_id)`. Returns the
/// holder's media id.
pub async fn find_media_external_id_holder<C>(
	conn: &C,
	media_id: &str,
	provider: &str,
	external_id: &str,
) -> Result<Option<String>, CoreError>
where
	C: ConnectionTrait,
{
	use models::entity::{media, series};

	let series_id = media::Entity::find_by_id(media_id)
		.one(conn)
		.await?
		.and_then(|m| m.series_id);
	let Some(series_id) = series_id else {
		return Ok(None);
	};
	let library_id = series::Entity::find_by_id(&series_id)
		.one(conn)
		.await?
		.and_then(|s| s.library_id);
	let Some(library_id) = library_id else {
		return Ok(None);
	};

	let holder_media_ids: Vec<String> = media_metadata::Entity::find()
		.filter(media_metadata::Column::MetadataSource.eq(provider))
		.filter(media_metadata::Column::MetadataExternalId.eq(external_id))
		.filter(media_metadata::Column::MediaId.ne(media_id))
		.all(conn)
		.await?
		.into_iter()
		.filter_map(|m| m.media_id)
		.collect();
	if holder_media_ids.is_empty() {
		return Ok(None);
	}

	let holders = media::Entity::find()
		.filter(media::Column::Id.is_in(holder_media_ids))
		.all(conn)
		.await?;
	let holder_series_ids: Vec<String> =
		holders.iter().filter_map(|m| m.series_id.clone()).collect();
	let same_library_series: std::collections::HashSet<String> = series::Entity::find()
		.filter(series::Column::Id.is_in(holder_series_ids))
		.filter(series::Column::LibraryId.eq(library_id))
		.all(conn)
		.await?
		.into_iter()
		.map(|s| s.id)
		.collect();

	Ok(holders
		.into_iter()
		.find(|m| {
			m.series_id
				.as_ref()
				.is_some_and(|sid| same_library_series.contains(sid))
		})
		.map(|m| m.id))
}

fn parse_locked_fields(json: &Option<JsonValue>) -> Vec<MetadataField> {
	json.as_ref()
		.and_then(|v| serde_json::from_value(v.clone()).ok())
		.unwrap_or_default()
}

async fn mark_fetch_status_accepted<C>(
	conn: &C,
	series_id: Option<&str>,
	media_id: Option<&str>,
	candidate: &MatchCandidate,
) -> Result<(), CoreError>
where
	C: ConnectionTrait,
{
	let candidate_json = serde_json::to_value(candidate)
		.map_err(|e| CoreError::InternalError(e.to_string()))?;

	let mut query = metadata_fetch_record::Entity::find();
	if let Some(sid) = series_id {
		query = query.filter(metadata_fetch_record::Column::SeriesId.eq(sid));
	}
	if let Some(mid) = media_id {
		query = query.filter(metadata_fetch_record::Column::MediaId.eq(mid));
	}

	// Note: This realistically shouldn't happen but is more of a safeguard
	if let Some(status) = query.one(conn).await? {
		tracing::warn!(
			?series_id,
			?media_id,
			?candidate,
			"Unable to fetch the original fetch record!"
		);
		let mut active: metadata_fetch_record::ActiveModel = status.into();
		active.status = Set(MetadataFetchStatus::Fetched);
		active.accepted_match_candidate = Set(Some(candidate_json));
		metadata_fetch_record::Entity::update(active)
			.exec(conn)
			.await?;
	}

	Ok(())
}

fn apply_series_fields(
	merger: &mut FieldMerger,
	model: &series_metadata::Model,
	active: &mut series_metadata::ActiveModel,
	ext: &ExternalSeriesMetadata,
) {
	if let Some(v) =
		merger.merge_scalar(MetadataField::Title, &model.title, &Some(ext.title.clone()))
	{
		active.title = Set(v);
	}

	if let Some(v) =
		merger.merge_scalar(MetadataField::Summary, &model.summary, &ext.summary)
	{
		active.summary = Set(v);
	}

	if let Some(v) =
		merger.merge_scalar(MetadataField::Publisher, &model.publisher, &ext.publisher)
	{
		active.publisher = Set(v);
	}

	if let Some(v) = merger.merge_scalar(MetadataField::Year, &model.year, &ext.year) {
		active.year = Set(v);
	}

	let ext_age_rating = ext.age_rating.as_ref().and_then(|s| s.parse::<i32>().ok());
	if let Some(v) =
		merger.merge_scalar(MetadataField::AgeRating, &model.age_rating, &ext_age_rating)
	{
		active.age_rating = Set(v);
	}

	let ext_status = ext.status.as_ref().map(|s| format!("{:?}", s));
	if let Some(v) =
		merger.merge_scalar(MetadataField::Status, &model.status, &ext_status)
	{
		active.status = Set(v);
	}

	if let Some(v) = merger.merge_scalar(
		MetadataField::VolumeCount,
		&model.total_issues,
		&ext.volume_count,
	) {
		active.total_issues = Set(v);
	}

	if let Some(v) =
		merger.merge_comma_list(MetadataField::Genres, &model.genres, &ext.genres)
	{
		active.genres = Set(v);
	}

	if let Some(v) =
		merger.merge_comma_list(MetadataField::Writers, &model.writers, &ext.authors)
	{
		active.writers = Set(v);
	}

	if let Some(v) = merger.apply_scalar_override::<String>(MetadataField::Title) {
		active.title = Set(v);
	}
	if let Some(v) = merger.apply_scalar_override::<String>(MetadataField::Summary) {
		active.summary = Set(v);
	}
	if let Some(v) = merger.apply_scalar_override::<String>(MetadataField::Publisher) {
		active.publisher = Set(v);
	}
	if let Some(v) = merger.apply_scalar_override::<i32>(MetadataField::Year) {
		active.year = Set(v);
	}
	if let Some(v) = merger.apply_scalar_override::<i32>(MetadataField::AgeRating) {
		active.age_rating = Set(v);
	}
	if let Some(v) = merger.apply_scalar_override::<String>(MetadataField::Status) {
		active.status = Set(v);
	}
	if let Some(v) = merger.apply_scalar_override::<i32>(MetadataField::VolumeCount) {
		active.total_issues = Set(v);
	}
	if let Some(v) = merger.apply_comma_list_override(MetadataField::Genres) {
		active.genres = Set(v);
	}
	if let Some(v) = merger.apply_comma_list_override(MetadataField::Writers) {
		active.writers = Set(v);
	}
}

fn apply_media_fields(
	merger: &mut FieldMerger,
	model: &media_metadata::Model,
	active: &mut media_metadata::ActiveModel,
	ext: &ExternalMediaMetadata,
) {
	if let Some(v) = merger.merge_scalar(MetadataField::Title, &model.title, &ext.title) {
		active.title = Set(v);
	}

	if let Some(v) =
		merger.merge_scalar(MetadataField::Summary, &model.summary, &ext.summary)
	{
		active.summary = Set(v);
	}

	if let Some(v) = merger.merge_scalar(MetadataField::Year, &model.year, &ext.year) {
		active.year = Set(v);
	}

	if let Some(v) =
		merger.merge_scalar(MetadataField::PageCount, &model.page_count, &ext.page_count)
	{
		active.page_count = Set(v);
	}

	if let Some(v) = merger.merge_scalar(MetadataField::ReleaseDate, &model.day, &ext.day)
	{
		active.day = Set(v);
	}

	if let Some(v) =
		merger.merge_scalar(MetadataField::ReleaseDate, &model.month, &ext.month)
	{
		active.month = Set(v);
	}

	let ext_isbn = ext.isbn.as_ref().or(ext.isbn_13.as_ref()).cloned();
	if let Some(v) =
		merger.merge_scalar(MetadataField::Isbn, &model.identifier_isbn, &ext_isbn)
	{
		active.identifier_isbn = Set(v);
	}

	if let Some(v) =
		merger.merge_comma_list(MetadataField::Genres, &model.genres, &ext.genres)
	{
		active.genres = Set(v);
	}

	if let Some(v) =
		merger.merge_comma_list(MetadataField::Writers, &model.writers, &ext.writers)
	{
		active.writers = Set(v);
	}

	if let Some(v) = merger.merge_comma_list(
		MetadataField::Colorists,
		&model.colorists,
		&ext.colorists,
	) {
		active.colorists = Set(v);
	}

	if let Some(v) = merger.merge_comma_list(
		MetadataField::Letterers,
		&model.letterers,
		&ext.letterers,
	) {
		active.letterers = Set(v);
	}

	if let Some(v) = merger.merge_comma_list(
		MetadataField::CoverArtists,
		&model.cover_artists,
		&ext.cover_artists,
	) {
		active.cover_artists = Set(v);
	}

	// Comics providers (Metron) supply a dedicated `pencillers` field; when present it
	// wins over the generic `artists` field Hardcover populates, but both map to the
	// same `pencillers` column. The merge-strategy field key follows whichever source
	// won so existing per-field locks/excludes on `Artists` keep working for Hardcover.
	let pencillers_source = ext.pencillers.as_ref().or(ext.artists.as_ref()).cloned();
	let pencillers_field = if ext.pencillers.is_some() {
		MetadataField::Pencillers
	} else {
		MetadataField::Artists
	};
	if let Some(v) =
		merger.merge_comma_list(pencillers_field, &model.pencillers, &pencillers_source)
	{
		active.pencillers = Set(v);
	}

	if let Some(v) =
		merger.merge_comma_list(MetadataField::Inkers, &model.inkers, &ext.inkers)
	{
		active.inkers = Set(v);
	}

	if let Some(v) =
		merger.merge_comma_list(MetadataField::Editors, &model.editors, &ext.editors)
	{
		active.editors = Set(v);
	}

	if let Some(v) = merger.merge_comma_list(
		MetadataField::Characters,
		&model.characters,
		&ext.characters,
	) {
		active.characters = Set(v);
	}

	if let Some(v) =
		merger.merge_comma_list(MetadataField::Teams, &model.teams, &ext.teams)
	{
		active.teams = Set(v);
	}

	if let Some(v) =
		merger.merge_scalar(MetadataField::StoryArc, &model.story_arc, &ext.story_arc)
	{
		active.story_arc = Set(v);
	}

	if let Some(v) =
		merger.merge_scalar(MetadataField::Publisher, &model.publisher, &ext.publisher)
	{
		active.publisher = Set(v);
	}

	// Note: `ext.imprint` has no corresponding column on `media_metadata` (imprint only
	// exists on `series_metadata`), so it is not applied here.

	if let Some(v) = merger.apply_scalar_override::<String>(MetadataField::Title) {
		active.title = Set(v);
	}
	if let Some(v) = merger.apply_scalar_override::<String>(MetadataField::Summary) {
		active.summary = Set(v);
	}
	if let Some(v) = merger.apply_scalar_override::<i32>(MetadataField::Year) {
		active.year = Set(v);
	}
	if let Some(v) = merger.apply_scalar_override::<i32>(MetadataField::PageCount) {
		active.page_count = Set(v);
	}
	// TODO: Sort this one out
	// if let Some(v) = merger.apply_scalar_override::<i32>(MetadataField::ReleaseDate) {
	// 	active.day = Set(v);
	// }
	if let Some(v) = merger.apply_scalar_override::<String>(MetadataField::Isbn) {
		active.identifier_isbn = Set(v);
	}
	if let Some(v) = merger.apply_comma_list_override(MetadataField::Genres) {
		active.genres = Set(v);
	}
	if let Some(v) = merger.apply_comma_list_override(MetadataField::Writers) {
		active.writers = Set(v);
	}
	if let Some(v) = merger.apply_comma_list_override(MetadataField::Colorists) {
		active.colorists = Set(v);
	}
	if let Some(v) = merger.apply_comma_list_override(MetadataField::Letterers) {
		active.letterers = Set(v);
	}
	if let Some(v) = merger.apply_comma_list_override(MetadataField::CoverArtists) {
		active.cover_artists = Set(v);
	}
	if let Some(v) = merger.apply_comma_list_override(MetadataField::Artists) {
		active.pencillers = Set(v);
	}
	if let Some(v) = merger.apply_comma_list_override(MetadataField::Pencillers) {
		active.pencillers = Set(v);
	}
	if let Some(v) = merger.apply_comma_list_override(MetadataField::Inkers) {
		active.inkers = Set(v);
	}
	if let Some(v) = merger.apply_comma_list_override(MetadataField::Editors) {
		active.editors = Set(v);
	}
	if let Some(v) = merger.apply_comma_list_override(MetadataField::Characters) {
		active.characters = Set(v);
	}
	if let Some(v) = merger.apply_comma_list_override(MetadataField::Teams) {
		active.teams = Set(v);
	}
	if let Some(v) = merger.apply_scalar_override::<String>(MetadataField::StoryArc) {
		active.story_arc = Set(v);
	}
	if let Some(v) = merger.apply_scalar_override::<String>(MetadataField::Publisher) {
		active.publisher = Set(v);
	}
}

fn build_series_metadata_insert(
	series_id: &str,
	ext: &ExternalSeriesMetadata,
	provider: &str,
	external_id: &str,
) -> series_metadata::ActiveModel {
	let ext_age_rating = ext.age_rating.as_ref().and_then(|s| s.parse::<i32>().ok());
	let ext_status = ext.status.as_ref().map(|s| format!("{:?}", s));

	series_metadata::ActiveModel {
		series_id: Set(series_id.to_string()),
		title: Set(Some(ext.title.clone())),
		summary: Set(ext.summary.clone()),
		publisher: Set(ext.publisher.clone()),
		year: Set(ext.year),
		age_rating: Set(ext_age_rating),
		status: Set(ext_status),
		total_issues: Set(ext.volume_count),
		genres: Set(ext.genres.as_ref().map(|g| g.join(", "))),
		writers: Set(ext.authors.as_ref().map(|a| a.join(", "))),
		metadata_source: Set(Some(provider.to_string())),
		metadata_external_id: Set(Some(external_id.to_string())),
		..Default::default()
	}
}

fn build_media_metadata_insert(
	media_id: &str,
	ext: &ExternalMediaMetadata,
	provider: &str,
	external_id: &str,
) -> media_metadata::ActiveModel {
	let ext_isbn = ext.isbn.as_ref().or(ext.isbn_13.as_ref()).cloned();
	// See the comment in `apply_media_fields`: an explicit `ext.pencillers` (Metron)
	// wins over the generic `ext.artists` (Hardcover) when both are populated.
	let ext_pencillers = ext.pencillers.as_ref().or(ext.artists.as_ref()).cloned();

	media_metadata::ActiveModel {
		media_id: Set(Some(media_id.to_string())),
		title: Set(ext.title.clone()),
		summary: Set(ext.summary.clone()),
		year: Set(ext.year),
		day: Set(ext.day),
		month: Set(ext.month),
		page_count: Set(ext.page_count),
		identifier_isbn: Set(ext_isbn),
		genres: Set(ext.genres.as_ref().map(|g| g.join(", "))),
		writers: Set(ext.writers.as_ref().map(|w| w.join(", "))),
		colorists: Set(ext.colorists.as_ref().map(|c| c.join(", "))),
		letterers: Set(ext.letterers.as_ref().map(|l| l.join(", "))),
		cover_artists: Set(ext.cover_artists.as_ref().map(|c| c.join(", "))),
		pencillers: Set(ext_pencillers.map(|a| a.join(", "))),
		inkers: Set(ext.inkers.as_ref().map(|i| i.join(", "))),
		editors: Set(ext.editors.as_ref().map(|e| e.join(", "))),
		characters: Set(ext.characters.as_ref().map(|c| c.join(", "))),
		teams: Set(ext.teams.as_ref().map(|t| t.join(", "))),
		story_arc: Set(ext.story_arc.clone()),
		publisher: Set(ext.publisher.clone()),
		metadata_source: Set(Some(provider.to_string())),
		metadata_external_id: Set(Some(external_id.to_string())),
		..Default::default()
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	// Absolute path: this module is itself named `tests`, so `use super::*` glob-imports
	// that self-reference and shadows the extern `tests` fixture crate under a bare name.
	use ::tests::{db, fake_data};
	use models::entity::{
		external_metadata_link::{self, ChosenBy, LinkState, MANUAL_PROVIDER},
		metadata_field_source,
	};

	async fn seeded_series(
		conn: &sea_orm::DatabaseConnection,
		library_id: &str,
		name: &str,
	) -> String {
		fake_data::Series {
			id: None,
			name: Some(name.to_string()),
			path: Some(format!("/tmp/{library_id}/{name}")),
			library_id: Some(library_id.to_string()),
		}
		.insert(conn)
		.await
		.id
	}

	#[tokio::test]
	async fn series_external_id_holder_is_scoped_to_the_library() {
		let conn = db::test_database().await;
		let lib_a = fake_data::Library {
			id: None,
			name: Some("A".to_string()),
			path: Some("/tmp/lib-a".to_string()),
		}
		.insert(&conn)
		.await;
		let lib_b = fake_data::Library {
			id: None,
			name: Some("B".to_string()),
			path: Some("/tmp/lib-b".to_string()),
		}
		.insert(&conn)
		.await;

		let holder = seeded_series(&conn, &lib_a.id, "Saga").await;
		let sibling = seeded_series(&conn, &lib_a.id, "Saga Dup").await;
		let other_library = seeded_series(&conn, &lib_b.id, "Saga Elsewhere").await;

		series_metadata::ActiveModel {
			series_id: Set(holder.clone()),
			metadata_source: Set(Some("comicvine".to_string())),
			metadata_external_id: Set(Some("4050-1".to_string())),
			..Default::default()
		}
		.insert(&conn)
		.await
		.unwrap();

		// A sibling in the same library binding the same id is a collision.
		assert_eq!(
			find_series_external_id_holder(&conn, &sibling, "comicvine", "4050-1")
				.await
				.unwrap(),
			Some(holder.clone())
		);
		// The same id in a DIFFERENT library is legitimate (organizer precedent).
		assert_eq!(
			find_series_external_id_holder(&conn, &other_library, "comicvine", "4050-1")
				.await
				.unwrap(),
			None
		);
		// A different id collides with nothing.
		assert_eq!(
			find_series_external_id_holder(&conn, &sibling, "comicvine", "4050-2")
				.await
				.unwrap(),
			None
		);
	}

	#[tokio::test]
	async fn media_external_id_holder_is_scoped_to_the_library() {
		let conn = db::test_database().await;
		let lib = fake_data::Library {
			id: None,
			name: Some("A".to_string()),
			path: Some("/tmp/lib-a".to_string()),
		}
		.insert(&conn)
		.await;
		let series_id = seeded_series(&conn, &lib.id, "Saga").await;

		let holder = fake_data::Media {
			series_id: series_id.clone(),
			id: None,
			name: Some("Saga #1".to_string()),
			extension: Some("cbz".to_string()),
			created_at: None,
			modified_at: None,
			deleted_at: None,
			pages: None,
		}
		.insert(&conn)
		.await;
		let sibling = fake_data::Media {
			series_id: series_id.clone(),
			id: None,
			name: Some("Saga #1 (dup)".to_string()),
			extension: Some("cbz".to_string()),
			created_at: None,
			modified_at: None,
			deleted_at: None,
			pages: None,
		}
		.insert(&conn)
		.await;

		media_metadata::ActiveModel {
			media_id: Set(Some(holder.id.clone())),
			metadata_source: Set(Some("comicvine".to_string())),
			metadata_external_id: Set(Some("4000-9".to_string())),
			..Default::default()
		}
		.insert(&conn)
		.await
		.unwrap();

		assert_eq!(
			find_media_external_id_holder(&conn, &sibling.id, "comicvine", "4000-9")
				.await
				.unwrap(),
			Some(holder.id.clone())
		);
		assert_eq!(
			find_media_external_id_holder(&conn, &sibling.id, "comicvine", "4000-10")
				.await
				.unwrap(),
			None
		);
	}

	fn comic_ext(
		series: Option<&str>,
		number_raw: Option<&str>,
	) -> ExternalMediaMetadata {
		ExternalMediaMetadata {
			series_name: series.map(String::from),
			number_raw: number_raw.map(String::from),
			..Default::default()
		}
	}

	// The composed clean title now lives in the provider mapping (map_issue etc.); the
	// apply layer just writes ext.title. These guard the enum's comic-provider gate,
	// which the mapping relies on to decide whether to compose.
	#[test]
	fn comic_providers_are_recognized() {
		use models::shared::enums::MetadataProvider;
		assert!(MetadataProvider::from_provider_id("comicvine")
			.is_some_and(|p| p.is_comic_provider()));
		assert!(MetadataProvider::from_provider_id("metron")
			.is_some_and(|p| p.is_comic_provider()));
		assert!(!MetadataProvider::from_provider_id("hardcover")
			.is_some_and(|p| p.is_comic_provider()));
	}

	#[test]
	fn insert_uses_provider_supplied_title() {
		// The provider mapping is responsible for composing "{Series} #{n}"; the apply
		// layer must pass ext.title through untouched.
		let ext = ExternalMediaMetadata {
			title: Some("Absolute Batman #1".to_string()),
			..comic_ext(Some("Absolute Batman"), Some("1"))
		};
		let model = build_media_metadata_insert("m1", &ext, "comicvine", "78901");
		assert_eq!(model.title, Set(Some("Absolute Batman #1".to_string())));
	}

	/// Build a media candidate carrying just enough to be attributable.
	fn media_candidate(provider: &str, external_id: &str) -> MatchCandidate {
		MatchCandidate {
			provider: provider.to_string(),
			external_id: external_id.to_string(),
			metadata: ExternalMetadata::Media(ExternalMediaMetadata {
				provider: provider.to_string(),
				external_id: external_id.to_string(),
				title: Some(format!("Title from {provider}")),
				summary: Some(format!("Summary from {provider}")),
				page_count: Some(44),
				..Default::default()
			}),
			confidence: 0.9,
			confidence_factors: vec![],
		}
	}

	async fn seeded_media(conn: &sea_orm::DatabaseConnection, series_id: &str) -> String {
		fake_data::Media {
			series_id: series_id.to_string(),
			id: None,
			name: Some("Issue 1".to_string()),
			extension: Some("cbz".to_string()),
			created_at: None,
			modified_at: None,
			deleted_at: None,
			pages: Some(20),
		}
		.insert(conn)
		.await
		.id
	}

	async fn seeded_library_media(conn: &sea_orm::DatabaseConnection) -> String {
		let library = fake_data::Library {
			id: None,
			name: Some("Comics".to_string()),
			path: Some("/tmp/comics".to_string()),
		}
		.insert(conn)
		.await;
		let series = seeded_series(conn, &library.id, "Absolute Batman").await;
		seeded_media(conn, &series).await
	}

	/// The point of the pool: two providers describing the same book coexist, instead of
	/// the second displacing the first the way a single `metadata_source` column forced.
	#[tokio::test]
	async fn two_providers_link_to_the_same_book() {
		let conn = db::test_database().await;
		let media_id = seeded_library_media(&conn).await;

		for provider in ["comicvine", "locg"] {
			apply_media_match(
				&conn,
				&media_id,
				&media_candidate(provider, &format!("{provider}-1")),
				MergeStrategy::FillGaps,
				vec![],
				vec![],
				ApplyActor::Auto,
			)
			.await
			.expect("apply succeeds");
		}

		let links = external_metadata_link::Entity::find()
			.filter(external_metadata_link::Column::MediaId.eq(&media_id))
			.all(&conn)
			.await
			.expect("query");

		let mut providers: Vec<&str> =
			links.iter().map(|l| l.provider.as_str()).collect();
		providers.sort_unstable();
		assert_eq!(providers, ["comicvine", "locg"]);
		assert!(
			links.iter().all(|l| l.state == LinkState::LINKED),
			"an applied match is a linked one"
		);
		assert!(
			links.iter().all(|l| l.payload.is_some()),
			"the payload is what lets the review grid compare sources"
		);
	}

	/// Applying the same provider twice must refresh its one row, not accumulate rows —
	/// the partial unique index says one link per (book, provider).
	#[tokio::test]
	async fn re_applying_a_provider_updates_its_existing_link() {
		let conn = db::test_database().await;
		let media_id = seeded_library_media(&conn).await;

		for external_id in ["locg-1", "locg-2"] {
			apply_media_match(
				&conn,
				&media_id,
				&media_candidate("locg", external_id),
				MergeStrategy::PreferExternal,
				vec![],
				vec![],
				ApplyActor::Auto,
			)
			.await
			.expect("apply succeeds");
		}

		let links = external_metadata_link::Entity::find()
			.filter(external_metadata_link::Column::MediaId.eq(&media_id))
			.all(&conn)
			.await
			.expect("query");
		assert_eq!(links.len(), 1);
		assert_eq!(links[0].external_id.as_deref(), Some("locg-2"));
		assert!(links[0].refreshed_at.is_some(), "a re-apply is a refresh");
	}

	/// Every field the apply actually wrote gets attributed. Fields the provider had
	/// nothing for must not appear — provenance that claims coverage it does not have is
	/// worse than none.
	#[tokio::test]
	async fn applied_fields_are_attributed_to_their_provider() {
		let conn = db::test_database().await;
		let media_id = seeded_library_media(&conn).await;

		apply_media_match(
			&conn,
			&media_id,
			&media_candidate("locg", "2463692"),
			MergeStrategy::FillGaps,
			vec![],
			vec![],
			ApplyActor::Auto,
		)
		.await
		.expect("apply succeeds");

		let rows = metadata_field_source::Entity::find()
			.filter(metadata_field_source::Column::MediaId.eq(&media_id))
			.all(&conn)
			.await
			.expect("query");

		assert!(
			!rows.is_empty(),
			"expected provenance for the applied fields"
		);
		assert!(rows.iter().all(|r| r.source_provider == "locg"));
		assert!(rows
			.iter()
			.all(|r| r.source_external_id.as_deref() == Some("2463692")));
		assert!(rows.iter().all(|r| r.chosen_by == ChosenBy::AUTO));

		let fields: Vec<&str> = rows.iter().map(|r| r.field.as_str()).collect();
		assert!(fields.contains(&"PAGE_COUNT"), "got {fields:?}");
		assert!(
			!fields.contains(&"STORY_ARC"),
			"the candidate carried no story arc, so nothing may claim to have set it"
		);
	}

	/// A provider whose search is already complete must not be charged an extra request.
	///
	/// `hydrate_candidate_for_apply` exists for list-view providers; every other provider
	/// has to pass through it untouched, or auto-apply would double its request count
	/// across a whole-library match for no benefit.
	#[tokio::test]
	async fn hydration_before_apply_leaves_complete_providers_alone() {
		let conn = db::test_database().await;
		let candidate = media_candidate("comicvine", "cv-1");

		// No provider configs, so no client can be built -- the candidate must come back
		// as-is rather than being dropped or emptied.
		let result = hydrate_candidate_for_apply(
			&candidate,
			&[],
			&ProviderClientCache::new(
				std::sync::Arc::new(conn),
				metadata_integrations::runtime::noop_runtime(),
			),
			true,
		)
		.await;

		assert_eq!(result.provider, candidate.provider);
		assert_eq!(result.external_id, candidate.external_id);
		match (&result.metadata, &candidate.metadata) {
			(ExternalMetadata::Media(got), ExternalMetadata::Media(want)) => {
				assert_eq!(got.title, want.title);
				assert_eq!(got.page_count, want.page_count);
			},
			_ => panic!("metadata kind changed"),
		}
	}

	/// A hand-picked value is attributed to the operator and locked, so the next fetch
	/// cannot quietly undo the choice. This is the guarantee the whole pick-and-choose
	/// flow rests on.
	#[tokio::test]
	async fn an_overridden_field_is_attributed_to_the_operator_and_locked() {
		let conn = db::test_database().await;
		let media_id = seeded_library_media(&conn).await;

		// A first apply so a metadata row exists -- overrides only apply on top of one.
		apply_media_match(
			&conn,
			&media_id,
			&media_candidate("comicvine", "cv-1"),
			MergeStrategy::FillGaps,
			vec![],
			vec![],
			ApplyActor::Auto,
		)
		.await
		.expect("first apply succeeds");

		apply_media_match(
			&conn,
			&media_id,
			&media_candidate("locg", "locg-1"),
			MergeStrategy::PreferExternal,
			vec![],
			vec![MetadataFieldOverride {
				field: MetadataField::Summary,
				value: serde_json::json!("Signed copy, NYCC 2024"),
			}],
			ApplyActor::User,
		)
		.await
		.expect("override apply succeeds");

		let summary_row = metadata_field_source::Entity::find()
			.filter(metadata_field_source::Column::MediaId.eq(&media_id))
			.filter(metadata_field_source::Column::Field.eq("SUMMARY"))
			.one(&conn)
			.await
			.expect("query")
			.expect("summary provenance exists");
		assert_eq!(summary_row.source_provider, MANUAL_PROVIDER);
		assert_eq!(summary_row.chosen_by, ChosenBy::USER);
		assert!(summary_row.source_external_id.is_none());

		let metadata = media_metadata::Entity::find()
			.filter(media_metadata::Column::MediaId.eq(&media_id))
			.one(&conn)
			.await
			.expect("query")
			.expect("metadata exists");
		assert_eq!(metadata.summary.as_deref(), Some("Signed copy, NYCC 2024"));
		let locked: Vec<MetadataField> =
			serde_json::from_value(metadata.locked_fields.expect("locked list"))
				.expect("valid lock list");
		assert!(
			locked.contains(&MetadataField::Summary),
			"a hand-picked field must be locked, got {locked:?}"
		);

		// Exactly one provenance row for the field, not one per pass. The production
		// schema enforces this with a unique index, so a duplicate would fail the insert
		// and take the whole apply down -- which is how this was found.
		let summary_rows = metadata_field_source::Entity::find()
			.filter(metadata_field_source::Column::MediaId.eq(&media_id))
			.filter(metadata_field_source::Column::Field.eq("SUMMARY"))
			.all(&conn)
			.await
			.expect("query");
		assert_eq!(summary_rows.len(), 1, "one row per field, whoever wrote it");
	}
}
