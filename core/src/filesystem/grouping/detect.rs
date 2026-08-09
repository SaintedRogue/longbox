//! Reading a library's loose books, grouping them, and writing the result back.
//!
//! The only part of this module with side effects. It is idempotent by construction: a
//! second run over unchanged input reproduces exactly the same rows, because groups are
//! matched by their `source_key` before any new one is created.

use metadata_integrations::filename::parse_comic_filename;
use models::{
	entity::{book_group, library, media, media_metadata, series},
	shared::enums::BookGroupSource,
};
use sea_orm::{
	prelude::*, ActiveValue::Set, Condition, DatabaseTransaction, QuerySelect,
	QueryTrait, TransactionTrait,
};

use crate::CoreResult;

use super::cluster::{cluster, GroupSignal};

/// What a detection run did.
#[derive(Debug, Default, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectBookGroupsOutput {
	pub groups_created: u32,
	pub groups_matched: u32,
	pub groups_pruned: u32,
	pub books_grouped: u32,
	pub books_standalone: u32,
	/// Books skipped because a person had already decided their grouping.
	pub books_locked: u32,
}

/// Find the library's loose-file bucket series, if it has one.
///
/// Structural, not name-based: the bucket is the series whose path equals its own
/// library's path, which is what the scanner produces when books sit directly in the
/// library root.
async fn find_bucket_series<C: ConnectionTrait>(
	conn: &C,
	library_id: &str,
) -> CoreResult<Option<series::Model>> {
	let Some(lib) = library::Entity::find_by_id(library_id.to_string())
		.one(conn)
		.await?
	else {
		return Ok(None);
	};

	let bucket = series::Entity::find()
		.filter(series::Column::LibraryId.eq(library_id))
		.filter(series::Column::Path.eq(lib.path))
		.filter(series::Column::DeletedAt.is_null())
		.one(conn)
		.await?;

	Ok(bucket)
}

/// Reduce a book to the fields grouping cares about.
///
/// Embedded metadata wins when it has a series; otherwise the filename is parsed. There
/// is deliberately no third fallback to a bare filename prefix — on the library this was
/// built for, that path produced 115 groups of one and made browsing worse than the
/// single junk bucket it replaced. A book we cannot confidently name simply stays
/// standalone.
fn signal_for(
	book: &media::Model,
	metadata: Option<&media_metadata::Model>,
) -> Option<GroupSignal> {
	let tagged_series = metadata
		.and_then(|m| m.series.as_deref())
		.map(str::trim)
		.filter(|series| !series.is_empty());

	let parsed = parse_comic_filename(&book.name);

	let (raw_title, source) = match tagged_series {
		Some(series) => (series.to_string(), BookGroupSource::Metadata),
		None => (parsed.series.clone()?, BookGroupSource::Filename),
	};

	let number = metadata
		.and_then(|m| m.number)
		.map(|number| number.normalize().to_string())
		.or_else(|| parsed.number.clone());

	let year = metadata.and_then(|m| m.year).or(parsed.year);

	Some(GroupSignal {
		media_id: book.id.clone(),
		raw_title,
		source,
		number,
		year,
	})
}

/// Group a library's loose books into virtual shelves.
///
/// Offline and synchronous — pure string work over at most a few hundred rows, so there
/// is no job queue and nothing that can block on a metadata provider. The whole write is
/// one transaction; because no file moves, there is no partial-failure state to
/// reconcile.
///
/// Rows with `book_group_locked` set are never read and never written. That single flag
/// is what makes a manual correction survive both a re-run of this function and any
/// later library scan — the scanner does not know the column exists.
pub async fn detect_book_groups(
	conn: &DatabaseConnection,
	library_id: &str,
) -> CoreResult<DetectBookGroupsOutput> {
	let Some(bucket) = find_bucket_series(conn, library_id).await? else {
		// No loose books in this library: nothing to group, and nothing to undo.
		return Ok(DetectBookGroupsOutput::default());
	};

	let txn = conn.begin().await?;
	let output = detect_in_txn(&txn, library_id, &bucket.id).await?;
	txn.commit().await?;

	Ok(output)
}

async fn detect_in_txn(
	txn: &DatabaseTransaction,
	library_id: &str,
	bucket_series_id: &str,
) -> CoreResult<DetectBookGroupsOutput> {
	let books = media::Entity::find()
		.filter(media::Column::SeriesId.eq(bucket_series_id))
		.filter(media::Column::DeletedAt.is_null())
		.find_also_related(media_metadata::Entity)
		.all(txn)
		.await?;

	let locked = books
		.iter()
		.filter(|(book, _)| book.book_group_locked)
		.count() as u32;

	let signals = books
		.iter()
		.filter(|(book, _)| !book.book_group_locked)
		.filter_map(|(book, metadata)| signal_for(book, metadata.as_ref()))
		.collect::<Vec<_>>();

	let clusters = cluster(&signals);

	let mut output = DetectBookGroupsOutput {
		books_locked: locked,
		..Default::default()
	};

	let existing = book_group::Entity::find()
		.filter(book_group::Column::LibraryId.eq(library_id))
		.all(txn)
		.await?;

	let mut grouped_media_ids = Vec::new();

	for proposed in &clusters {
		let matched = existing.iter().find(|group| {
			group.source_key.as_deref() == Some(proposed.source_key.as_str())
		});

		let group_id = match matched {
			Some(group) => {
				output.groups_matched += 1;
				group.id.clone()
			},
			None => {
				let inserted = book_group::ActiveModel {
					library_id: Set(library_id.to_string()),
					name: Set(proposed.name.clone()),
					source: Set(proposed.source),
					source_key: Set(Some(proposed.source_key.clone())),
					..Default::default()
				}
				.insert(txn)
				.await?;

				output.groups_created += 1;
				inserted.id
			},
		};

		media::Entity::update_many()
			.col_expr(
				media::Column::BookGroupId,
				Expr::value(Some(group_id.clone())),
			)
			.filter(media::Column::Id.is_in(proposed.media_ids.clone()))
			.filter(media::Column::BookGroupLocked.eq(false))
			.exec(txn)
			.await?;

		output.books_grouped += proposed.media_ids.len() as u32;
		grouped_media_ids.extend(proposed.media_ids.iter().cloned());
	}

	// Anything unlocked in the bucket that no longer lands in a shelf goes back to
	// standalone. Without this, a group would only ever accumulate and a book could never
	// be demoted after its metadata was corrected.
	let mut demote = Condition::all()
		.add(media::Column::SeriesId.eq(bucket_series_id))
		.add(media::Column::BookGroupLocked.eq(false))
		.add(media::Column::BookGroupId.is_not_null());
	if !grouped_media_ids.is_empty() {
		demote = demote.add(media::Column::Id.is_not_in(grouped_media_ids.clone()));
	}

	media::Entity::update_many()
		.col_expr(media::Column::BookGroupId, Expr::value(None::<String>))
		.filter(demote)
		.exec(txn)
		.await?;

	// Drop detected groups that ended up with no members. Manual groups are left alone
	// even when empty -- someone made them on purpose and may still be filling them.
	let empty_detected = book_group::Entity::find()
		.filter(book_group::Column::LibraryId.eq(library_id))
		.filter(book_group::Column::Source.ne(BookGroupSource::Manual))
		.filter(
			book_group::Column::Id.not_in_subquery(
				media::Entity::find()
					.select_only()
					.column(media::Column::BookGroupId)
					.filter(media::Column::BookGroupId.is_not_null())
					.into_query(),
			),
		)
		.all(txn)
		.await?;

	for group in &empty_detected {
		book_group::Entity::delete_by_id(group.id.clone())
			.exec(txn)
			.await?;
		output.groups_pruned += 1;
	}

	let bucket_total = books.len() as u32;
	output.books_standalone = bucket_total
		.saturating_sub(output.books_grouped)
		.saturating_sub(locked);

	Ok(output)
}
