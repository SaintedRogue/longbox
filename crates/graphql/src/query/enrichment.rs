use std::sync::Arc;

use async_graphql::{Context, Object, Result, SimpleObject};
use metadata_integrations::{
	ExternalMediaMetadata, ExternalSeriesMetadata, MetadataProvider as ProviderTrait,
};
use models::{
	entity::{
		external_metadata_link, media, metadata_field_source, metadata_provider_config,
		series,
	},
	shared::enums::{MetadataProvider, UserPermission},
};
use sea_orm::{prelude::*, QueryFilter, QueryOrder};

use crate::{data::CoreContext, guard::PermissionGuard};

/// One provider's view of an entity, ready to render as a column in the review grid.
///
/// `payload` is flattened to JSON rather than typed: the shape differs between a book and
/// a series, providers fill different subsets of it, and the grid reads it field by field.
/// Typing it here would mean a GraphQL object per entity kind that duplicates
/// `ExternalMediaMetadata` and drifts from it.
#[derive(SimpleObject)]
pub struct EnrichmentSource {
	/// Provider trait id (`comicvine`, `metron`, `locg`) or `manual`.
	pub provider: String,
	pub external_id: Option<String>,
	pub provider_url: Option<String>,
	/// `candidate` — stored for comparison; `linked` — the accepted match;
	/// `rejected` — declined, kept so it is not offered again.
	pub state: String,
	/// `auto`, `user`, or `backfill` for a link recovered from the pre-pool columns.
	pub chosen_by: Option<String>,
	pub confidence: Option<f64>,
	/// The provider's field bag. `None` for a recovered link that predates the pool —
	/// the id is known but the response was never kept, so it needs a re-fetch before it
	/// can be compared.
	pub payload: Option<serde_json::Value>,
}

/// Which source a stored field came from.
#[derive(SimpleObject)]
pub struct FieldProvenance {
	/// A `MetadataField` in its serde form, e.g. `PAGE_COUNT`.
	pub field: String,
	pub source_provider: String,
	pub source_external_id: Option<String>,
	/// `auto` or `user`.
	pub chosen_by: String,
}

/// Everything the review grid needs for one entity: the sources to compare, and where
/// each currently-stored field came from.
#[derive(SimpleObject)]
pub struct EnrichmentPool {
	pub sources: Vec<EnrichmentSource>,
	pub field_sources: Vec<FieldProvenance>,
}

#[derive(Default)]
pub struct EnrichmentQuery;

#[Object]
impl EnrichmentQuery {
	/// The full metadata a provider holds for one of its own records.
	///
	/// Exists because some providers' search endpoints are list views. League of Comic
	/// Geeks has no API, so a search result is a card: title, publisher, cover, date. The
	/// summary, page count, ISBN, credits and characters are only on the item's own page,
	/// which means a review grid built from search results shows a column of dashes.
	///
	/// Rather than fetching every result's page during a search — three quarters of which
	/// nobody opens, and which on a whole-library match would add hours against a
	/// 15-requests-per-minute ceiling — the client calls this for the one candidate a
	/// person actually selected. The provider response cache makes re-opening the same
	/// review free.
	#[graphql(guard = "PermissionGuard::one(UserPermission::MetadataProviderRead)")]
	async fn media_external_metadata(
		&self,
		ctx: &Context<'_>,
		provider: MetadataProvider,
		external_id: String,
	) -> Result<ExternalMediaMetadata> {
		let client = provider_client(ctx, provider).await?;
		Ok(client.fetch_media_metadata(&external_id).await?)
	}

	/// [`media_external_metadata`](Self::media_external_metadata) for a series.
	#[graphql(guard = "PermissionGuard::one(UserPermission::MetadataProviderRead)")]
	async fn series_external_metadata(
		&self,
		ctx: &Context<'_>,
		provider: MetadataProvider,
		external_id: String,
	) -> Result<ExternalSeriesMetadata> {
		let client = provider_client(ctx, provider).await?;
		Ok(client.fetch_series_metadata(&external_id).await?)
	}

	/// The enrichment pool for a book: one entry per provider that has answered, plus
	/// the provenance of its stored fields.
	///
	/// Ordered `linked` first so the accepted source leads the grid, then by descending
	/// confidence — the order a reviewer wants to read them in.
	#[graphql(guard = "PermissionGuard::one(UserPermission::MetadataProviderRead)")]
	async fn media_enrichment_pool(
		&self,
		ctx: &Context<'_>,
		id: async_graphql::ID,
	) -> Result<EnrichmentPool> {
		let conn = ctx.data::<CoreContext>()?.conn.as_ref();
		let media_id = id.to_string();

		// Existence check so a bad id is an error rather than a convincing empty pool.
		media::Entity::find_by_id(&media_id)
			.one(conn)
			.await?
			.ok_or("Book not found")?;

		let links = external_metadata_link::Entity::find()
			.filter(external_metadata_link::Column::MediaId.eq(&media_id))
			.order_by_desc(external_metadata_link::Column::Confidence)
			.all(conn)
			.await?;

		let field_sources = metadata_field_source::Entity::find()
			.filter(metadata_field_source::Column::MediaId.eq(&media_id))
			.order_by_asc(metadata_field_source::Column::Field)
			.all(conn)
			.await?;

		Ok(build_pool(links, field_sources))
	}

	/// [`media_enrichment_pool`](Self::media_enrichment_pool) for a series.
	#[graphql(guard = "PermissionGuard::one(UserPermission::MetadataProviderRead)")]
	async fn series_enrichment_pool(
		&self,
		ctx: &Context<'_>,
		id: async_graphql::ID,
	) -> Result<EnrichmentPool> {
		let conn = ctx.data::<CoreContext>()?.conn.as_ref();
		let series_id = id.to_string();

		series::Entity::find_by_id(&series_id)
			.one(conn)
			.await?
			.ok_or("Series not found")?;

		let links = external_metadata_link::Entity::find()
			.filter(external_metadata_link::Column::SeriesId.eq(&series_id))
			.order_by_desc(external_metadata_link::Column::Confidence)
			.all(conn)
			.await?;

		let field_sources = metadata_field_source::Entity::find()
			.filter(metadata_field_source::Column::SeriesId.eq(&series_id))
			.order_by_asc(metadata_field_source::Column::Field)
			.all(conn)
			.await?;

		Ok(build_pool(links, field_sources))
	}
}

/// The shared client for a provider, from its stored (enabled) config.
///
/// Goes through the process-wide cache so this shares one rate limiter, response cache
/// and budget ledger with the fetch jobs — a review that re-opens the same match is a
/// cache hit rather than another request against the provider.
async fn provider_client(
	ctx: &Context<'_>,
	provider: MetadataProvider,
) -> Result<Arc<dyn ProviderTrait + Send + Sync>> {
	let core = ctx.data::<CoreContext>()?;
	let config = metadata_provider_config::Entity::find()
		.filter(metadata_provider_config::Column::ProviderType.eq(provider))
		.filter(metadata_provider_config::Column::Enabled.eq(true))
		.one(core.conn.as_ref())
		.await?
		.ok_or("That provider is not configured, or is turned off")?;

	Ok(core.provider_cache().get_or_create(&config).await?)
}

/// Rewrite a payload's keys from serde's snake_case to the camelCase the rest of the API
/// speaks.
///
/// The payload is stored exactly as Rust serializes it, so it round-trips back into
/// `ExternalMediaMetadata`. But every other metadata shape the client sees comes through
/// async-graphql, which camelCases — and the client reads a field by the *same* key it
/// uses for a match candidate (`coverArtists`). Translating here keeps storage canonical
/// and the API consistent; doing it in storage would break the Rust round-trip, and not
/// doing it at all would make the pool the one payload the client cannot read.
fn camel_case_keys(value: serde_json::Value) -> serde_json::Value {
	match value {
		serde_json::Value::Object(map) => serde_json::Value::Object(
			map.into_iter()
				.map(|(key, val)| (to_camel_case(&key), camel_case_keys(val)))
				.collect(),
		),
		serde_json::Value::Array(items) => {
			serde_json::Value::Array(items.into_iter().map(camel_case_keys).collect())
		},
		other => other,
	}
}

fn to_camel_case(key: &str) -> String {
	let mut out = String::with_capacity(key.len());
	let mut capitalize = false;
	for ch in key.chars() {
		if ch == '_' {
			capitalize = true;
		} else if capitalize {
			out.extend(ch.to_uppercase());
			capitalize = false;
		} else {
			out.push(ch);
		}
	}
	out
}

/// Shape the rows for the grid, putting the accepted source first.
fn build_pool(
	links: Vec<external_metadata_link::Model>,
	field_sources: Vec<metadata_field_source::Model>,
) -> EnrichmentPool {
	let mut sources: Vec<EnrichmentSource> = links
		.into_iter()
		.map(|link| EnrichmentSource {
			provider: link.provider,
			external_id: link.external_id,
			provider_url: link.provider_url,
			state: link.state,
			chosen_by: link.chosen_by,
			confidence: link.confidence,
			// Stored as a JSON string; parse failures surface as `None` rather than
			// failing the whole query, since one unreadable payload should not hide the
			// other sources.
			payload: link
				.payload
				.and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
				.map(camel_case_keys),
		})
		.collect();

	sources.sort_by_key(|source| {
		match source.state.as_str() {
			// `sort_by_key` is stable, so equal keys keep the confidence order above.
			external_metadata_link::LinkState::LINKED => 0,
			external_metadata_link::LinkState::CANDIDATE => 1,
			_ => 2,
		}
	});

	EnrichmentPool {
		sources,
		field_sources: field_sources
			.into_iter()
			.map(|row| FieldProvenance {
				field: row.field,
				source_provider: row.source_provider,
				source_external_id: row.source_external_id,
				chosen_by: row.chosen_by,
			})
			.collect(),
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	/// The client reads a pool payload with the same key it uses for a match candidate,
	/// and those keys are camelCase because candidates come through async-graphql. The
	/// payload is stored in serde's snake_case so it round-trips back into Rust, so the
	/// boundary has to translate or the pool becomes the one payload the UI cannot read.
	#[test]
	fn payload_keys_become_camel_case() {
		let stored = serde_json::json!({
			"page_count": 44,
			"cover_artists": ["Nick Dragotta"],
			"series_name": "Absolute Batman",
			"title": "Absolute Batman #1",
		});
		assert_eq!(
			camel_case_keys(stored),
			serde_json::json!({
				"pageCount": 44,
				"coverArtists": ["Nick Dragotta"],
				"seriesName": "Absolute Batman",
				"title": "Absolute Batman #1",
			})
		);
	}

	#[test]
	fn already_camel_and_single_word_keys_are_untouched() {
		assert_eq!(to_camel_case("title"), "title");
		assert_eq!(to_camel_case("pageCount"), "pageCount");
		assert_eq!(to_camel_case("isbn_13"), "isbn13");
	}

	/// The accepted source leads the grid; everything else keeps the confidence order it
	/// arrived in.
	#[test]
	fn linked_sources_sort_ahead_of_candidates() {
		use chrono::Utc;

		let link = |provider: &str, state: &str, confidence: f64| {
			external_metadata_link::Model {
				id: 0,
				media_id: Some("bk".to_string()),
				series_id: None,
				provider: provider.to_string(),
				external_id: None,
				provider_url: None,
				payload: None,
				confidence: Some(confidence),
				state: state.to_string(),
				chosen_by: None,
				fetched_at: Utc::now(),
				refreshed_at: None,
			}
		};

		let pool = build_pool(
			vec![
				link(
					"comicvine",
					external_metadata_link::LinkState::CANDIDATE,
					0.94,
				),
				link("locg", external_metadata_link::LinkState::LINKED, 0.71),
				link("metron", external_metadata_link::LinkState::REJECTED, 0.99),
			],
			vec![],
		);

		let order: Vec<&str> = pool.sources.iter().map(|s| s.provider.as_str()).collect();
		assert_eq!(
			order,
			["locg", "comicvine", "metron"],
			"linked first, then candidates, rejected last"
		);
	}
}
