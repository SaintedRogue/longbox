use metadata_integrations::{parse_comic_filename, MatchCandidate, SearchQuery};
use models::{
	entity::{
		library_config, media, media_metadata, metadata_fetch_record,
		metadata_provider_config, series, series_metadata,
	},
	shared::enums::{LibraryType, MetadataFetchStatus, MetadataProvider},
};
use sea_orm::{prelude::*, sea_query::OnConflict, QuerySelect, Set};

use super::{apply, ProviderClientCache};
use crate::CoreError;

async fn library_type_for_series(
	conn: &DatabaseConnection,
	series_id: &str,
) -> Result<LibraryType, CoreError> {
	let library_id = series::Entity::find_by_id(series_id)
		.select_only()
		.column(series::Column::LibraryId)
		.into_tuple::<String>()
		.one(conn)
		.await?
		.ok_or_else(|| CoreError::NotFound(format!("Series {series_id}")))?;

	let config = library_config::Entity::find()
		.filter(library_config::Column::LibraryId.eq(library_id))
		.one(conn)
		.await
		.map_err(|e| CoreError::InternalError(e.to_string()))?
		.ok_or_else(|| CoreError::NotFound("Library missing config!".into()))?;

	Ok(config.library_type)
}

// TODO: This is terrible, I should just bite the bullet and put a direct fk on media
async fn library_type_for_media(
	conn: &DatabaseConnection,
	media_id: &str,
) -> Result<LibraryType, CoreError> {
	let tuple = media::Entity::find()
		.filter(media::Column::Id.eq(media_id))
		.find_also_related(series::Entity)
		.one(conn)
		.await?
		.ok_or_else(|| CoreError::NotFound(format!("Media {media_id}")))?;

	let (_, Some(series)) = tuple else {
		return Err(CoreError::NotFound(format!("Series for media {media_id}")));
	};

	library_type_for_series(conn, &series.id).await
}

fn filter_providers_for_library_type(
	provider_configs: Vec<metadata_provider_config::Model>,
	library_type: &LibraryType,
) -> Vec<metadata_provider_config::Model> {
	let mut filtered: Vec<metadata_provider_config::Model> = provider_configs
		.into_iter()
		.filter(|c| library_type.has_provider_overlap(&c.provider_type))
		.collect();
	// Preference order: lowest `position` first (ties broken by id), so the preferred
	// provider is queried first and wins auto-apply tie-breaks.
	filtered.sort_by_key(|c| (c.position, c.id));
	filtered
}

/// Narrow a set of provider configs to a single provider, for the interactive
/// "search this specific provider" flow. `None` leaves the set unchanged (search
/// all enabled providers, the default). If the chosen provider isn't among the
/// enabled configs the result is empty — callers treat that the same as
/// "no providers configured".
fn filter_to_provider(
	configs: Vec<metadata_provider_config::Model>,
	provider: Option<MetadataProvider>,
) -> Vec<metadata_provider_config::Model> {
	match provider {
		Some(provider) => configs
			.into_iter()
			.filter(|c| c.provider_type == provider)
			.collect(),
		None => configs,
	}
}

/// Fetch metadata candidates for a series from all enabled providers.
///
/// `year_override`, when set, is used as the series' start year for
/// disambiguation instead of the value stored in `series_metadata` — this is
/// how the on-demand search UI lets a user pin the year for an ambiguous title.
///
/// `provider_filter` scopes the search to a single provider (the interactive
/// "search this provider" flow); `None` searches all enabled providers.
/// `auto_apply` gates the high-confidence auto-apply step: the interactive UI
/// passes `false` so the record stays awaiting review and the user picks a
/// candidate themselves.
pub async fn fetch_series_metadata(
	conn: &DatabaseConnection,
	series_id: &str,
	series_name: &str,
	year_override: Option<i32>,
	provider_filter: Option<MetadataProvider>,
	auto_apply: bool,
	provider_cache: &ProviderClientCache,
) -> Result<Vec<MatchCandidate>, CoreError> {
	let library_type = library_type_for_series(conn, series_id).await?;

	let provider_configs = metadata_provider_config::Entity::find()
		.filter(metadata_provider_config::Column::Enabled.eq(true))
		.all(conn)
		.await?;

	let provider_configs =
		filter_providers_for_library_type(provider_configs, &library_type);
	let provider_configs = filter_to_provider(provider_configs, provider_filter);

	if provider_configs.is_empty() {
		return Err(CoreError::InternalError(
			"No enabled metadata providers configured for this library type".to_string(),
		));
	}

	let series_meta = series_metadata::Entity::find_by_id(series_id)
		.one(conn)
		.await?;

	let mut all_candidates: Vec<MatchCandidate> = Vec::new();
	let mut was_rate_limited = false;

	for config in &provider_configs {
		match provider_cache.get_or_create(config).await {
			Ok(provider) => {
				let query = SearchQuery {
					title: series_name.to_string(),
					series_year: year_override
						.or_else(|| series_meta.as_ref().and_then(|m| m.year)),
					limit: Some(10),
					..Default::default()
				};

				match provider.search_series(&query).await {
					Ok(candidates) => {
						all_candidates.extend(candidates);
					},
					Err(e) if e.is_rate_limited() => {
						was_rate_limited = true;
						tracing::warn!(
							provider = ?config.provider_type,
							"Rate limited after retries for series metadata"
						);
					},
					Err(e) => {
						tracing::error!(
							provider = ?config.provider_type,
							error = ?e,
							"Failed to search provider for series metadata"
						);
					},
				}
			},
			Err(e) => {
				tracing::error!(
					provider = ?config.provider_type,
					error = ?e,
					"Failed to get provider client"
				);
			},
		}
	}

	let status = if was_rate_limited && all_candidates.is_empty() {
		MetadataFetchStatus::RateLimited
	} else if all_candidates.is_empty() {
		MetadataFetchStatus::NoMatch
	} else {
		MetadataFetchStatus::AwaitingReview
	};

	let candidates_json = serde_json::to_value(&all_candidates)
		.map_err(|e| CoreError::InternalError(e.to_string()))?;

	let active_model = metadata_fetch_record::ActiveModel {
		series_id: Set(Some(series_id.to_string())),
		status: Set(status),
		match_candidates: Set(Some(candidates_json)),
		..Default::default()
	};

	metadata_fetch_record::Entity::insert(active_model)
		.on_conflict(
			OnConflict::column(metadata_fetch_record::Column::SeriesId)
				.update_columns([
					metadata_fetch_record::Column::Status,
					metadata_fetch_record::Column::MatchCandidates,
					metadata_fetch_record::Column::UpdatedAt,
				])
				.to_owned(),
		)
		.exec(conn)
		.await?;

	if auto_apply {
		if let Some((candidate, config)) =
			apply::find_auto_apply_candidate(&all_candidates, &provider_configs)
		{
			tracing::info!(
				series_id,
				provider = candidate.provider,
				confidence = candidate.confidence,
				"Auto-applying series metadata match"
			);
			if let Err(e) = apply::apply_series_match(
				conn,
				series_id,
				&candidate,
				config.strategy,
				config.exclude_fields,
				vec![],
			)
			.await
			{
				tracing::error!(
					series_id,
					error = ?e,
					"Failed to auto-apply series metadata"
				);
			}
		}
	}

	Ok(all_candidates)
}

/// Fill in comic-issue matching signals (series name, number, publisher, year,
/// ComicVine ID) on a [`SearchQuery`] from the media's parsed metadata, without
/// clobbering any values the caller already set explicitly
///
/// Note: `search.year` here is the *issue's own* year (`media_metadata.year`,
/// e.g. a cover/release year), not the series' start year — providers should
/// treat it as a per-issue disambiguation signal (Metron maps it to `cover_year`),
/// not a series-start-year signal. `search.series_year` is intentionally left
/// unpopulated on this path: `media_metadata` doesn't carry the series' start
/// year, and `series_metadata` isn't loaded here (only looked up transitively,
/// and discarded, inside `library_type_for_media`) — fetching it would mean a
/// new query/join, so it's skipped rather than speculatively added.
fn enrich_query_with_media_metadata(
	mut search: SearchQuery,
	metadata: Option<&media_metadata::Model>,
) -> SearchQuery {
	if let Some(metadata) = metadata {
		if search.series_name.is_none() {
			search.series_name = metadata.series.clone();
		}
		if search.number.is_none() {
			search.number = metadata.number.map(|n| n.normalize().to_string());
		}
		if search.publisher.is_none() {
			search.publisher = metadata.publisher.clone();
		}
		if search.year.is_none() {
			search.year = metadata.year;
		}
		if search.comicvine_id.is_none() {
			search.comicvine_id = metadata.comicvine_id.clone();
		}
	}

	// Last resort for filename-only libraries (no ComicInfo.xml, so empty
	// media_metadata): parse the filename (carried in `search.title`) into a series
	// + issue number so providers get a real query instead of the raw file name.
	fill_query_from_filename(&mut search);

	search
}

/// Fill still-empty comic matching signals (`series_name`, `number`, `year`) by
/// parsing the media's filename — which every caller passes as `search.title`.
///
/// This is heuristic and used only to build a better provider query; the parsed
/// values are never written back to `media_metadata`. Shared by both the on-demand
/// [`fetch_media_metadata`] path and the bulk [`super::fetch_job`] path so a
/// filename-only library matches the same way from either entry point.
pub(super) fn fill_query_from_filename(search: &mut SearchQuery) {
	if search.series_name.is_some() && search.number.is_some() {
		return;
	}

	let parsed = parse_comic_filename(&search.title);
	if search.series_name.is_none() {
		search.series_name = parsed.series;
	}
	if search.number.is_none() {
		search.number = parsed.number;
	}
	if search.year.is_none() {
		search.year = parsed.year;
	}
}

/// Fetch metadata candidates for a media item.
///
/// `provider_filter` scopes the search to a single provider (the interactive
/// "search this provider" flow); `None` searches all enabled providers.
/// `auto_apply` gates the high-confidence auto-apply step: the interactive UI
/// passes `false` so the record stays awaiting review and the user picks a
/// candidate themselves.
pub async fn fetch_media_metadata(
	conn: &DatabaseConnection,
	media_id: &str,
	search: SearchQuery,
	provider_filter: Option<MetadataProvider>,
	auto_apply: bool,
	provider_cache: &ProviderClientCache,
) -> Result<Vec<MatchCandidate>, CoreError> {
	let library_type = library_type_for_media(conn, media_id).await?;

	let provider_configs = metadata_provider_config::Entity::find()
		.filter(metadata_provider_config::Column::Enabled.eq(true))
		.all(conn)
		.await?;

	let provider_configs =
		filter_providers_for_library_type(provider_configs, &library_type);
	let provider_configs = filter_to_provider(provider_configs, provider_filter);

	if provider_configs.is_empty() {
		return Err(CoreError::InternalError(
			"No enabled metadata providers configured for this library type".to_string(),
		));
	}

	let media_meta = media_metadata::Entity::find()
		.filter(media_metadata::Column::MediaId.eq(media_id))
		.one(conn)
		.await?;
	let search = enrich_query_with_media_metadata(search, media_meta.as_ref());

	let mut all_candidates: Vec<MatchCandidate> = Vec::new();
	let mut was_rate_limited = false;

	for config in &provider_configs {
		match provider_cache.get_or_create(config).await {
			Ok(provider) => match provider.search_media(&search).await {
				Ok(candidates) => {
					all_candidates.extend(candidates);
				},
				Err(e) if e.is_rate_limited() => {
					was_rate_limited = true;
					tracing::warn!(
						provider = ?config.provider_type,
						"Rate limited after retries for media metadata"
					);
				},
				Err(e) => {
					tracing::error!(
						provider = ?config.provider_type,
						error = ?e,
						"Failed to search provider for media metadata"
					);
				},
			},
			Err(e) => {
				tracing::error!(
					provider = ?config.provider_type,
					error = ?e,
					"Failed to get provider client"
				);
			},
		}
	}

	let status = if was_rate_limited && all_candidates.is_empty() {
		MetadataFetchStatus::RateLimited
	} else if all_candidates.is_empty() {
		MetadataFetchStatus::NoMatch
	} else {
		MetadataFetchStatus::AwaitingReview
	};

	let candidates_json = serde_json::to_value(&all_candidates)
		.map_err(|e| CoreError::InternalError(e.to_string()))?;

	let active_model = metadata_fetch_record::ActiveModel {
		media_id: Set(Some(media_id.to_string())),
		status: Set(status),
		match_candidates: Set(Some(candidates_json)),
		..Default::default()
	};

	metadata_fetch_record::Entity::insert(active_model)
		.on_conflict(
			OnConflict::column(metadata_fetch_record::Column::MediaId)
				.update_columns([
					metadata_fetch_record::Column::Status,
					metadata_fetch_record::Column::MatchCandidates,
					metadata_fetch_record::Column::UpdatedAt,
				])
				.to_owned(),
		)
		.exec(conn)
		.await?;

	if auto_apply {
		if let Some((candidate, config)) =
			apply::find_auto_apply_candidate(&all_candidates, &provider_configs)
		{
			tracing::info!(
				media_id,
				provider = candidate.provider,
				confidence = candidate.confidence,
				"Auto-applying media metadata match"
			);
			if let Err(e) = apply::apply_media_match(
				conn,
				media_id,
				&candidate,
				config.strategy,
				config.exclude_fields,
				vec![],
			)
			.await
			{
				tracing::error!(
					media_id,
					error = ?e,
					"Failed to auto-apply media metadata"
				);
			}
		}
	}

	Ok(all_candidates)
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn enrich_falls_back_to_filename_when_metadata_empty() {
		// Filename-only library: no media_metadata row, so series/number/year must
		// come from parsing the filename (carried in `title`).
		let search = SearchQuery {
			title: "Absolute Batman 001 (2024) (digital) (Son of Ultron-Empire)"
				.to_string(),
			..Default::default()
		};
		let enriched = enrich_query_with_media_metadata(search, None);
		assert_eq!(enriched.series_name.as_deref(), Some("Absolute Batman"));
		assert_eq!(enriched.number.as_deref(), Some("1"));
		assert_eq!(enriched.year, Some(2024));
	}

	#[test]
	fn filename_fallback_never_overrides_existing_signals() {
		let mut search = SearchQuery {
			title: "Absolute Batman 001 (2024)".to_string(),
			series_name: Some("Real Series".to_string()),
			number: Some("5".to_string()),
			..Default::default()
		};
		fill_query_from_filename(&mut search);
		assert_eq!(search.series_name.as_deref(), Some("Real Series"));
		assert_eq!(search.number.as_deref(), Some("5"));
	}
}
