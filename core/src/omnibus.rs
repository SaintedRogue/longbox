//! Which books are omnibuses.
//!
//! This lives in `core` rather than in the GraphQL crate so that a future scan-time
//! detector — the scan jobs are here too — can reuse the rule without moving it.
//!
//! The rule is deliberately generous about *where* the word appears. A flat library names
//! the set on the folder (`Wolverine Omnibus (Marvel, 2020-...) (01-05)`) and the volumes
//! inside it `v01.cbz`, so a rule that only looked at a book's own name would miss almost
//! everything.

use models::entity::{media, media_metadata, series};
use sea_orm::{
	sea_query::{Query, SelectStatement},
	ColumnTrait, Condition,
};

/// The word that marks a collected edition as an omnibus.
pub const OMNIBUS_KEYWORD: &str = "omnibus";

/// Whether a name marks its book as an omnibus.
pub fn matches_omnibus_name(value: &str) -> bool {
	value.to_ascii_lowercase().contains(OMNIBUS_KEYWORD)
}

/// The SQL `LIKE` pattern matching an omnibus name.
///
/// SQLite's `LIKE` is case-insensitive for ASCII by default, which is what lets this be a
/// single pattern rather than a lowered comparison on both sides.
pub fn omnibus_like_pattern() -> String {
	format!("%{OMNIBUS_KEYWORD}%")
}

/// Series whose own name marks them as omnibus sets.
///
/// Unscoped by library on purpose: this is only ever used inside a larger condition on
/// `media`, and whatever library scoping the caller wants is expressed there.
fn omnibus_series_query() -> SelectStatement {
	Query::select()
		.distinct()
		.column(series::Column::Id)
		.from(series::Entity)
		.and_where(series::Column::Name.like(omnibus_like_pattern()))
		.and_where(series::Column::DeletedAt.is_null())
		.to_owned()
}

/// Books that qualify as omnibuses: the book's own name, its metadata title, its metadata
/// format, or its series' name says so.
///
/// The series clause is what covers a flat library, where the folder carries the name and
/// the files inside it are called `v01.cbz`. The `metadata` columns are only filterable
/// because [`media::ModelWithMetadata::find`] left-joins them, so this condition belongs
/// only on a query that does.
pub fn qualifying_condition() -> Condition {
	let pattern = omnibus_like_pattern();

	Condition::any()
		.add(media::Column::Name.like(&pattern))
		.add(media_metadata::Column::Title.like(&pattern))
		.add(media_metadata::Column::Format.like(&pattern))
		.add(media::Column::SeriesId.in_subquery(omnibus_series_query()))
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn the_keyword_is_matched_regardless_of_case() {
		assert!(matches_omnibus_name("Wolverine Omnibus"));
		assert!(matches_omnibus_name("WOLVERINE OMNIBUS VOL. 1"));
		assert!(matches_omnibus_name("absolute carnage omnibus hc"));
		assert!(matches_omnibus_name(
			"Wolverine Omnibus (Marvel, 2020-...) (01-05)"
		));
	}

	#[test]
	fn ordinary_books_do_not_match() {
		assert!(!matches_omnibus_name("Absolute Batman #1"));
		assert!(!matches_omnibus_name("Saga Volume 1"));
		assert!(!matches_omnibus_name("Batman: The Killing Joke"));
	}
}

/// Tests that exercise the SQL, rather than the naming rule.
///
/// [`qualifying_condition`] filters on `media_metadata` columns reachable only through a
/// join, and on a `series` subquery. A mistake there is an ambiguous-column or missing-join
/// error at runtime, which no amount of string-level testing would catch.
#[cfg(test)]
mod sql_tests {
	use chrono::Utc;
	use migrations::{Migrator, MigratorTrait};
	use models::{
		entity::{
			library, library_config, media, media_metadata, series, user::AuthUser,
		},
		shared::enums::{
			FileStatus, LibraryPattern, LibraryViewMode, ReadingDirection,
			ReadingImageScaleFit, ReadingMode,
		},
	};
	use sea_orm::{
		ActiveModelTrait, Database, DatabaseConnection, QueryFilter, QueryOrder, Set,
	};

	use super::*;

	async fn mem_db() -> DatabaseConnection {
		let conn = Database::connect("sqlite::memory:")
			.await
			.expect("connects");
		Migrator::up(&conn, None).await.expect("migrates");
		conn
	}

	/// Libraries carry a mandatory config row, and `series.library_id` is a real foreign
	/// key — so a series cannot reference a library id out of thin air.
	async fn seed_library(conn: &DatabaseConnection, id: &str) {
		let config = library_config::ActiveModel {
			convert_rar_to_zip: Set(false),
			hard_delete_conversions: Set(false),
			default_reading_dir: Set(ReadingDirection::Ltr),
			default_reading_mode: Set(ReadingMode::Paged),
			default_reading_image_scale_fit: Set(ReadingImageScaleFit::Height),
			generate_file_hashes: Set(false),
			generate_koreader_hashes: Set(false),
			process_metadata: Set(true),
			watch: Set(false),
			library_pattern: Set(LibraryPattern::SeriesBased),
			default_library_view_mode: Set(LibraryViewMode::Series),
			hide_series_view: Set(false),
			skip_book_overview: Set(false),
			process_thumbnail_colors_even_without_config: Set(false),
			..Default::default()
		}
		.insert(conn)
		.await
		.expect("library config inserts");

		library::ActiveModel {
			id: Set(id.to_string()),
			name: Set(format!("Library {id}")),
			path: Set(format!("/comics/{id}")),
			status: Set(FileStatus::Ready),
			config_id: Set(config.id),
			..Default::default()
		}
		.insert(conn)
		.await
		.expect("library inserts");
	}

	async fn seed_series(conn: &DatabaseConnection, id: &str, name: &str, library: &str) {
		series::ActiveModel {
			id: Set(id.to_string()),
			name: Set(name.to_string()),
			path: Set(format!("/comics/{id}")),
			library_id: Set(Some(library.to_string())),
			..Default::default()
		}
		.insert(conn)
		.await
		.expect("series inserts");
	}

	/// `media.size`, `pages` and `status` are NOT NULL with no defaults.
	async fn seed_book(
		conn: &DatabaseConnection,
		id: &str,
		name: &str,
		series_id: Option<&str>,
		format: Option<&str>,
	) {
		media::ActiveModel {
			id: Set(id.to_string()),
			name: Set(name.to_string()),
			path: Set(format!("/comics/{id}.cbz")),
			extension: Set("cbz".to_string()),
			size: Set(1024),
			pages: Set(1),
			status: Set(FileStatus::Ready),
			series_id: Set(series_id.map(String::from)),
			created_at: Set(Utc::now().fixed_offset()),
			..Default::default()
		}
		.insert(conn)
		.await
		.expect("media inserts");

		media_metadata::ActiveModel {
			media_id: Set(Some(id.to_string())),
			format: Set(format.map(String::from)),
			..Default::default()
		}
		.insert(conn)
		.await
		.expect("metadata inserts");
	}

	async fn qualifying_ids(conn: &DatabaseConnection) -> Vec<String> {
		let books = media::ModelWithMetadata::find()
			.filter(media::Column::DeletedAt.is_null())
			.filter(qualifying_condition())
			.order_by_asc(media::Column::Id)
			.into_model::<media::ModelWithMetadata>()
			.all(conn)
			.await
			.expect("the shelf query runs");

		books.into_iter().map(|book| book.media.id).collect()
	}

	/// The four signals, against a real schema. `metadata.format` and the `series.name`
	/// subquery are the two a join mistake would break.
	#[tokio::test]
	async fn every_signal_finds_its_book() {
		let conn = mem_db().await;
		seed_library(&conn, "lib-1").await;
		seed_series(&conn, "s-omni", "Wolverine Omnibus (Marvel, 2020)", "lib-1").await;
		seed_series(&conn, "s-plain", "Batman", "lib-1").await;

		// Qualifies through its series' name, despite an unhelpful file name.
		seed_book(&conn, "by-series", "v01.cbz", Some("s-omni"), None).await;
		// Qualifies on its own name, inside an ordinary series.
		seed_book(
			&conn,
			"by-name",
			"Batman Omnibus Vol 1.cbz",
			Some("s-plain"),
			None,
		)
		.await;
		// Qualifies on the ComicInfo format field alone.
		seed_book(
			&conn,
			"by-format",
			"btm-001.cbz",
			Some("s-plain"),
			Some("Omnibus"),
		)
		.await;
		// Qualifies on nothing.
		seed_book(&conn, "ordinary", "Batman 001.cbz", Some("s-plain"), None).await;

		assert_eq!(
			qualifying_ids(&conn).await,
			["by-format", "by-name", "by-series"],
			"the ordinary issue is excluded, and each signal pulls its book in"
		);
	}

	/// An omnibus that is a loose file, with no series row to name it.
	#[tokio::test]
	async fn a_loose_file_with_no_series_still_qualifies() {
		let conn = mem_db().await;
		seed_book(&conn, "loose", "Thor Omnibus v01.cbz", None, None).await;

		assert_eq!(qualifying_ids(&conn).await, ["loose"]);
	}

	/// Every volume of a set qualifies on its own. The shelf is a list of books, so a
	/// five-volume omnibus is five cards — each one has to be found individually, even
	/// though only the folder carries the word.
	#[tokio::test]
	async fn every_volume_of_a_set_qualifies_on_its_own() {
		let conn = mem_db().await;
		seed_library(&conn, "lib-1").await;
		seed_series(&conn, "s-omni", "Wolverine Omnibus", "lib-1").await;
		for volume in 1..=3 {
			seed_book(
				&conn,
				&format!("w-{volume}"),
				&format!("v0{volume}.cbz"),
				Some("s-omni"),
				None,
			)
			.await;
		}

		assert_eq!(qualifying_ids(&conn).await, ["w-1", "w-2", "w-3"]);
	}

	fn owner() -> AuthUser {
		AuthUser {
			id: "owner".to_string(),
			avatar_path: None,
			avatar_url: None,
			username: "owner".to_string(),
			is_server_owner: true,
			is_locked: false,
			permissions: vec![],
			age_restriction: None,
			preferences: None,
		}
	}

	/// The production query path, joins and all.
	///
	/// [`qualifying_ids`] above uses the bare `find`, but every real caller goes through
	/// `find_for_user`, which adds the library-exclusion and series-metadata joins on top.
	/// Those extra joins are exactly where an ambiguous-column error would appear, and they
	/// are not present in any other test here.
	#[tokio::test]
	async fn the_condition_survives_the_permission_scoped_query() {
		let conn = mem_db().await;
		seed_library(&conn, "lib-1").await;
		seed_series(&conn, "s-omni", "Wolverine Omnibus", "lib-1").await;
		seed_book(&conn, "w-1", "v01.cbz", Some("s-omni"), None).await;
		seed_book(&conn, "ordinary", "Batman 001.cbz", Some("s-omni"), None).await;

		let user = owner();
		let books = media::ModelWithMetadata::find_for_user(&user)
			.filter(media::Column::DeletedAt.is_null())
			.filter(qualifying_condition())
			.order_by_asc(media::Column::Id)
			.into_model::<media::ModelWithMetadata>()
			.all(&conn)
			.await
			.expect("the permission-scoped shelf query runs");

		assert_eq!(
			books
				.iter()
				.map(|book| book.media.id.as_str())
				.collect::<Vec<_>>(),
			["ordinary", "w-1"],
			"both are in an omnibus-named series, so both are volumes of it"
		);
	}
}
