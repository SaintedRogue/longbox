//! The enrichment pool: what each provider knows, and which source won each field.
//!
//! `media_metadata` / `series_metadata` hold one *resolved* record — the values library
//! views read. They cannot express "ComicVine says this, LOCG says that", and their
//! single `metadata_source` column meant the first provider to match a book locked out
//! every other. These two tables carry what that shape cannot:
//!
//! - [`external_metadata_link`] — one row per (entity, provider): the provider's id and
//!   its captured payload, so several sources coexist and can be compared.
//! - [`metadata_field_source`] — one row per (entity, field): which source won it.
//!
//! Neither is on a read path for browsing; they exist for the review grid and for
//! answering "where did this value come from?" after the fact.

use chrono::Utc;
use metadata_integrations::{
	ExternalMediaMetadata, ExternalSeriesMetadata, MatchCandidate, MetadataField,
};
use models::entity::{
	external_metadata_link::{self, ChosenBy, LinkState, MANUAL_PROVIDER},
	media_metadata, metadata_field_source, series_metadata,
};
use sea_orm::{prelude::*, ActiveValue::Set, IntoActiveModel, QueryFilter};

use crate::CoreError;

/// The stored string form of a metadata field.
///
/// Serde's `SCREAMING_SNAKE_CASE` form — deliberately the same token `locked_fields`
/// already stores, so a provenance row and a lock entry for the same field are directly
/// comparable rather than two spellings of one thing.
fn field_key(field: MetadataField) -> String {
	serde_json::to_value(field)
		.ok()
		.and_then(|value| value.as_str().map(str::to_string))
		.unwrap_or_else(|| format!("{field:?}"))
}

/// Which entity a link or provenance row belongs to.
///
/// Exactly one of the two id columns is ever set — the tables enforce it with a CHECK —
/// so this makes the choice unrepresentable rather than relying on callers to pass one
/// `Option` and not the other.
#[derive(Debug, Clone, Copy)]
pub enum EnrichmentTarget<'a> {
	Media(&'a str),
	Series(&'a str),
}

impl<'a> EnrichmentTarget<'a> {
	fn media_id(&self) -> Option<String> {
		match self {
			Self::Media(id) => Some((*id).to_string()),
			Self::Series(_) => None,
		}
	}

	fn series_id(&self) -> Option<String> {
		match self {
			Self::Series(id) => Some((*id).to_string()),
			Self::Media(_) => None,
		}
	}
}

/// Who decided to apply a match.
///
/// Explicit rather than inferred: a job applying a high-confidence match and an operator
/// picking one in the review dialog produce the same DB writes but mean different
/// things, and only the caller knows which happened.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ApplyActor {
	/// The auto-apply path, above its confidence threshold.
	Auto,
	/// The operator, through the review dialog or the metadata editor.
	User,
}

impl ApplyActor {
	fn as_str(&self) -> &'static str {
		match self {
			Self::Auto => ChosenBy::AUTO,
			Self::User => ChosenBy::USER,
		}
	}
}

/// Record a provider's payload without claiming it is the truth.
///
/// Called for every candidate a fetch produces, so the review grid can show what LOCG
/// says next to what ComicVine says *before* either is accepted. An existing `linked`
/// row is left alone: a candidate must never demote an accepted match.
pub async fn record_candidate<C>(
	conn: &C,
	target: EnrichmentTarget<'_>,
	candidate: &MatchCandidate,
) -> Result<(), CoreError>
where
	C: ConnectionTrait,
{
	upsert_link(conn, target, candidate, LinkState::CANDIDATE, None).await
}

/// Store the best candidate from each provider that answered.
///
/// This is what turns the pool from "matches we accepted" into "what every provider
/// says", which is the difference between a link table and something you can actually
/// compare in a review grid. Providers return their candidates already ranked, so the
/// first one per provider is that provider's own best guess.
///
/// Failures are logged and skipped rather than propagated: a fetch that found real
/// candidates should not be reported as failed because a comparison row could not be
/// written.
pub async fn record_candidate_pool<C>(
	conn: &C,
	target: EnrichmentTarget<'_>,
	candidates: &[MatchCandidate],
) -> Result<(), CoreError>
where
	C: ConnectionTrait,
{
	let mut seen: Vec<&str> = Vec::new();

	for candidate in candidates {
		if seen.contains(&candidate.provider.as_str()) {
			continue;
		}
		seen.push(candidate.provider.as_str());

		if let Err(error) = record_candidate(conn, target, candidate).await {
			tracing::warn!(
				provider = candidate.provider,
				external_id = candidate.external_id,
				?error,
				"Could not store provider candidate for comparison"
			);
		}
	}

	Ok(())
}

/// Record that a provider's match was applied, and attribute the fields it wrote.
///
/// Three writes, in this order:
///
/// 1. The link row moves to `linked` — this entity now remembers the provider's id
///    regardless of which other providers it is also linked to.
/// 2. A provenance row per field written, so each stored value names its source.
/// 3. Fields the operator overrode by hand are added to `locked_fields`, which is what
///    stops the next fetch overwriting a deliberate choice.
pub async fn record_applied_match<C>(
	conn: &C,
	target: EnrichmentTarget<'_>,
	candidate: &MatchCandidate,
	actor: ApplyActor,
	merged_fields: &[MetadataField],
	overridden_fields: &[MetadataField],
) -> Result<(), CoreError>
where
	C: ConnectionTrait,
{
	upsert_link(conn, target, candidate, LinkState::LINKED, Some(actor)).await?;

	// Provider-sourced fields are attributed to the provider; overridden ones to the
	// operator, since the value did not come from upstream at all.
	//
	// A field can legitimately appear in *both* lists: the merge pass writes the
	// provider's value and the override pass then replaces it. The override is what
	// survives in the record, so it is what provenance must name — and skipping the
	// duplicate is not cosmetic. Provenance is unique per (entity, field), so emitting
	// two rows for one field makes the insert fail and takes the whole apply down with
	// it.
	let mut rows: Vec<(MetadataField, &str, Option<String>, &'static str)> =
		merged_fields
			.iter()
			.filter(|field| !overridden_fields.contains(field))
			.map(|field| {
				(
					*field,
					candidate.provider.as_str(),
					Some(candidate.external_id.clone()),
					actor.as_str(),
				)
			})
			.collect();
	rows.extend(
		overridden_fields
			.iter()
			.map(|field| (*field, MANUAL_PROVIDER, None, ChosenBy::USER)),
	);

	record_field_sources(conn, target, &rows).await?;

	if !overridden_fields.is_empty() {
		lock_fields(conn, target, overridden_fields).await?;
	}

	Ok(())
}

/// Insert or update the single row for this (entity, provider).
///
/// A read-then-write rather than an upsert: the uniqueness is enforced by a *partial*
/// index (`WHERE media_id IS NOT NULL`), and SQLite will only use a partial index as an
/// `ON CONFLICT` target if the statement repeats its `WHERE` clause — which the query
/// builder cannot express.
async fn upsert_link<C>(
	conn: &C,
	target: EnrichmentTarget<'_>,
	candidate: &MatchCandidate,
	state: &str,
	actor: Option<ApplyActor>,
) -> Result<(), CoreError>
where
	C: ConnectionTrait,
{
	let payload = serde_json::to_string(&candidate.metadata).ok();
	let now = Utc::now();

	let existing = find_link(conn, target, &candidate.provider).await?;

	match existing {
		Some(model) => {
			// Never let a fresh candidate downgrade an accepted link. Refreshing the
			// payload is still right: the provider's data may have improved, and the
			// review grid should show the current version.
			let keep_linked =
				model.state == LinkState::LINKED && state == LinkState::CANDIDATE;
			let mut active = model.clone().into_active_model();
			active.external_id = Set(Some(candidate.external_id.clone()));
			active.payload = Set(payload);
			active.confidence = Set(Some(candidate.confidence as f64));
			active.refreshed_at = Set(Some(now));
			if !keep_linked {
				active.state = Set(state.to_string());
				if let Some(actor) = actor {
					active.chosen_by = Set(Some(actor.as_str().to_string()));
				}
			}
			external_metadata_link::Entity::update(active)
				.exec(conn)
				.await?;
		},
		None => {
			let active = external_metadata_link::ActiveModel {
				media_id: Set(target.media_id()),
				series_id: Set(target.series_id()),
				provider: Set(candidate.provider.clone()),
				external_id: Set(Some(candidate.external_id.clone())),
				payload: Set(payload),
				confidence: Set(Some(candidate.confidence as f64)),
				state: Set(state.to_string()),
				chosen_by: Set(actor.map(|a| a.as_str().to_string())),
				fetched_at: Set(now),
				..Default::default()
			};
			external_metadata_link::Entity::insert(active)
				.exec(conn)
				.await?;
		},
	}

	Ok(())
}

async fn find_link<C>(
	conn: &C,
	target: EnrichmentTarget<'_>,
	provider: &str,
) -> Result<Option<external_metadata_link::Model>, CoreError>
where
	C: ConnectionTrait,
{
	let mut query = external_metadata_link::Entity::find()
		.filter(external_metadata_link::Column::Provider.eq(provider));
	query = match target {
		EnrichmentTarget::Media(id) => {
			query.filter(external_metadata_link::Column::MediaId.eq(id))
		},
		EnrichmentTarget::Series(id) => {
			query.filter(external_metadata_link::Column::SeriesId.eq(id))
		},
	};
	Ok(query.one(conn).await?)
}

/// Replace the provenance for exactly the fields being written.
///
/// Delete-then-insert over the affected fields only: two statements per apply instead of
/// a read-modify-write per field, and fields this apply did not touch keep whatever
/// source they already had.
async fn record_field_sources<C>(
	conn: &C,
	target: EnrichmentTarget<'_>,
	rows: &[(MetadataField, &str, Option<String>, &'static str)],
) -> Result<(), CoreError>
where
	C: ConnectionTrait,
{
	if rows.is_empty() {
		return Ok(());
	}

	let fields: Vec<String> = rows.iter().map(|(field, ..)| field_key(*field)).collect();

	let mut delete = metadata_field_source::Entity::delete_many()
		.filter(metadata_field_source::Column::Field.is_in(fields));
	delete = match target {
		EnrichmentTarget::Media(id) => {
			delete.filter(metadata_field_source::Column::MediaId.eq(id))
		},
		EnrichmentTarget::Series(id) => {
			delete.filter(metadata_field_source::Column::SeriesId.eq(id))
		},
	};
	delete.exec(conn).await?;

	let now = Utc::now();
	let models: Vec<metadata_field_source::ActiveModel> = rows
		.iter()
		.map(|(field, provider, external_id, chosen_by)| {
			metadata_field_source::ActiveModel {
				media_id: Set(target.media_id()),
				series_id: Set(target.series_id()),
				field: Set(field_key(*field)),
				source_provider: Set((*provider).to_string()),
				source_external_id: Set(external_id.clone()),
				chosen_by: Set((*chosen_by).to_string()),
				applied_at: Set(now),
				..Default::default()
			}
		})
		.collect();

	metadata_field_source::Entity::insert_many(models)
		.exec(conn)
		.await?;

	Ok(())
}

/// Add fields to the entity's `locked_fields`, the existing mechanism that stops a fetch
/// overwriting a value.
///
/// Phase 2 does not invent locking — it starts *using* it, so that picking a field by
/// hand survives the next enrichment run.
async fn lock_fields<C>(
	conn: &C,
	target: EnrichmentTarget<'_>,
	fields: &[MetadataField],
) -> Result<(), CoreError>
where
	C: ConnectionTrait,
{
	match target {
		EnrichmentTarget::Media(media_id) => {
			let Some(model) = media_metadata::Entity::find()
				.filter(media_metadata::Column::MediaId.eq(media_id))
				.one(conn)
				.await?
			else {
				return Ok(());
			};
			let merged = merge_locked(&model.locked_fields, fields);
			let mut active = model.into_active_model();
			active.locked_fields = Set(Some(merged));
			media_metadata::Entity::update(active).exec(conn).await?;
		},
		EnrichmentTarget::Series(series_id) => {
			let Some(model) = series_metadata::Entity::find()
				.filter(series_metadata::Column::SeriesId.eq(series_id))
				.one(conn)
				.await?
			else {
				return Ok(());
			};
			let merged = merge_locked(&model.locked_fields, fields);
			let mut active = model.into_active_model();
			active.locked_fields = Set(Some(merged));
			series_metadata::Entity::update(active).exec(conn).await?;
		},
	}

	Ok(())
}

/// Union the existing lock list with `fields`, preserving order and dropping duplicates.
///
/// Deliberately works on raw tokens rather than parsing into `MetadataField`. A typed
/// parse is all-or-nothing: one token this build does not recognise — a field added by a
/// newer version, or renamed — makes the whole list fail to deserialize, and every
/// existing lock is silently discarded. Locks are the operator's protection against
/// their choices being overwritten, so losing them quietly is the worst available
/// outcome. Unknown tokens are carried through untouched.
fn merge_locked(
	existing: &Option<serde_json::Value>,
	fields: &[MetadataField],
) -> serde_json::Value {
	let mut locked: Vec<String> = existing
		.as_ref()
		.and_then(|value| serde_json::from_value::<Vec<String>>(value.clone()).ok())
		.unwrap_or_default();

	for field in fields {
		let key = field_key(*field);
		if !locked.contains(&key) {
			locked.push(key);
		}
	}

	serde_json::to_value(locked).unwrap_or(serde_json::Value::Null)
}

/// The fields an external media payload actually supplies.
///
/// Used when the metadata row is created rather than merged: a fresh insert writes
/// everything the provider gave us, so attribution has to enumerate what that was. The
/// merger cannot answer here because there was no existing record to merge against.
pub fn media_fields_present(ext: &ExternalMediaMetadata) -> Vec<MetadataField> {
	let mut fields = Vec::new();
	let mut mark = |present: bool, field: MetadataField| {
		if present {
			fields.push(field);
		}
	};

	mark(ext.title.is_some(), MetadataField::Title);
	mark(ext.summary.is_some(), MetadataField::Summary);
	mark(ext.page_count.is_some(), MetadataField::PageCount);
	mark(
		ext.number.is_some() || ext.number_raw.is_some(),
		MetadataField::Number,
	);
	mark(
		ext.day.is_some() || ext.month.is_some() || ext.year.is_some(),
		MetadataField::ReleaseDate,
	);
	mark(ext.year.is_some(), MetadataField::Year);
	mark(ext.genres.is_some(), MetadataField::Genres);
	mark(ext.tags.is_some(), MetadataField::Tags);
	mark(
		ext.isbn.is_some() || ext.isbn_13.is_some(),
		MetadataField::Isbn,
	);
	mark(ext.writers.is_some(), MetadataField::Writers);
	mark(ext.artists.is_some(), MetadataField::Artists);
	mark(ext.colorists.is_some(), MetadataField::Colorists);
	mark(ext.letterers.is_some(), MetadataField::Letterers);
	mark(ext.cover_artists.is_some(), MetadataField::CoverArtists);
	mark(ext.pencillers.is_some(), MetadataField::Pencillers);
	mark(ext.inkers.is_some(), MetadataField::Inkers);
	mark(ext.editors.is_some(), MetadataField::Editors);
	mark(ext.characters.is_some(), MetadataField::Characters);
	mark(ext.teams.is_some(), MetadataField::Teams);
	mark(ext.story_arc.is_some(), MetadataField::StoryArc);
	mark(ext.imprint.is_some(), MetadataField::Imprint);
	mark(ext.publisher.is_some(), MetadataField::Publisher);
	mark(ext.cover_url.is_some(), MetadataField::Cover);
	mark(ext.series_name.is_some(), MetadataField::Series);

	fields
}

/// [`media_fields_present`] for a series payload. `title` is not optional on the series
/// shape, so it is always attributed.
pub fn series_fields_present(ext: &ExternalSeriesMetadata) -> Vec<MetadataField> {
	let mut fields = vec![MetadataField::Title];
	let mut mark = |present: bool, field: MetadataField| {
		if present {
			fields.push(field);
		}
	};

	mark(ext.summary.is_some(), MetadataField::Summary);
	mark(ext.status.is_some(), MetadataField::Status);
	mark(ext.year.is_some(), MetadataField::Year);
	mark(ext.genres.is_some(), MetadataField::Genres);
	mark(ext.tags.is_some(), MetadataField::Tags);
	mark(ext.age_rating.is_some(), MetadataField::AgeRating);
	mark(ext.authors.is_some(), MetadataField::Writers);
	mark(ext.artists.is_some(), MetadataField::Artists);
	mark(ext.publisher.is_some(), MetadataField::Publisher);
	mark(ext.cover_url.is_some(), MetadataField::Cover);
	mark(ext.volume_count.is_some(), MetadataField::VolumeCount);

	fields
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn locking_a_field_keeps_what_was_already_locked() {
		let merged = merge_locked(
			&Some(serde_json::json!(["SUMMARY"])),
			&[MetadataField::PageCount],
		);
		assert_eq!(merged, serde_json::json!(["SUMMARY", "PAGE_COUNT"]));
	}

	/// A token this build does not recognise must survive. Parsing the list into typed
	/// fields would fail on it and take every real lock with it, quietly un-protecting
	/// fields the operator had chosen by hand — the exact thing locking exists to prevent.
	#[test]
	fn an_unrecognised_lock_token_is_preserved() {
		let merged = merge_locked(
			&Some(serde_json::json!(["SUMMARY", "FIELD_FROM_A_NEWER_BUILD"])),
			&[MetadataField::PageCount],
		);
		assert_eq!(
			merged,
			serde_json::json!(["SUMMARY", "FIELD_FROM_A_NEWER_BUILD", "PAGE_COUNT"])
		);
	}

	#[test]
	fn locking_the_same_field_twice_does_not_duplicate_it() {
		let merged = merge_locked(
			&Some(serde_json::json!(["PAGE_COUNT"])),
			&[MetadataField::PageCount, MetadataField::PageCount],
		);
		assert_eq!(merged, serde_json::json!(["PAGE_COUNT"]));
	}

	#[test]
	fn locking_works_from_no_previous_list() {
		let merged = merge_locked(&None, &[MetadataField::Characters]);
		assert_eq!(merged, serde_json::json!(["CHARACTERS"]));
	}

	/// A malformed `locked_fields` must not silently drop the new lock — the operator's
	/// choice is the thing being protected.
	#[test]
	fn a_corrupt_lock_list_is_replaced_rather_than_lost() {
		let merged = merge_locked(
			&Some(serde_json::json!("not an array")),
			&[MetadataField::Summary],
		);
		assert_eq!(merged, serde_json::json!(["SUMMARY"]));
	}

	/// The provenance token and the lock-list token must be the same spelling, or
	/// "which source set this?" and "is this locked?" silently stop lining up.
	#[test]
	fn field_keys_match_the_lock_list_spelling() {
		assert_eq!(field_key(MetadataField::PageCount), "PAGE_COUNT");
		let locked = serde_json::to_value(vec![MetadataField::PageCount]).expect("valid");
		assert_eq!(locked, serde_json::json!(["PAGE_COUNT"]));
	}

	#[test]
	fn a_target_sets_exactly_one_id() {
		let media = EnrichmentTarget::Media("bk_1");
		assert_eq!(media.media_id().as_deref(), Some("bk_1"));
		assert!(media.series_id().is_none());

		let series = EnrichmentTarget::Series("sr_1");
		assert_eq!(series.series_id().as_deref(), Some("sr_1"));
		assert!(series.media_id().is_none());
	}
}
