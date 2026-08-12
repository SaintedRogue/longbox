//! Which books are omnibuses, and how they collapse into sets.
//!
//! This lives in `core` rather than in the GraphQL crate for two reasons: the scan jobs
//! are here too, so a future scan-time detector that materializes sets can reuse the rule
//! without moving it; and everything interesting in here is a pure function over a name,
//! which means it is testable without a database.
//!
//! The rule is deliberately generous about *where* the word appears. A flat library names
//! the set on the folder (`Wolverine Omnibus (Marvel, 2020-...) (01-05)`) and the volumes
//! inside it `v01.cbz`, so a rule that only looked at a book's own name would miss almost
//! everything.

use std::collections::HashMap;

use models::entity::{media, media_metadata, series};
use sea_orm::{
	sea_query::{Query, SelectStatement},
	ColumnTrait, Condition,
};

/// The word that marks a collected edition as an omnibus.
pub const OMNIBUS_KEYWORD: &str = "omnibus";

/// How many qualifying books the caller should ever load at once.
///
/// Sets are grouped in memory, so this is the bound on that. It is far above any
/// realistic omnibus collection — the library this was built for has roughly 410
/// qualifying books — and exists so an enormous library degrades visibly rather than
/// silently: whoever hits it is expected to flag the result as truncated rather than
/// present a partial shelf as complete.
pub const MAX_QUALIFYING_BOOKS: u64 = 10_000;

/// File extensions stripped before a name is compared or displayed.
const BOOK_EXTENSIONS: &[&str] = &[
	"cbz", "cbr", "cb7", "cbt", "zip", "rar", "7z", "tar", "pdf", "epub",
];

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

/// Series whose own name marks them as omnibus sets, optionally within one library.
pub fn omnibus_series_query(library_id: Option<&str>) -> SelectStatement {
	let mut query = Query::select();
	query
		.distinct()
		.column(series::Column::Id)
		.from(series::Entity)
		.and_where(series::Column::Name.like(omnibus_like_pattern()))
		.and_where(series::Column::DeletedAt.is_null());

	if let Some(library_id) = library_id {
		query.and_where(series::Column::LibraryId.eq(library_id));
	}

	query.to_owned()
}

/// Series belonging to one library, for scoping the shelf to a library.
///
/// Books have no `library_id` of their own — they reach a library through their series —
/// so a library-scoped shelf necessarily excludes books with no series at all.
pub fn series_in_library_query(library_id: &str) -> SelectStatement {
	Query::select()
		.distinct()
		.column(series::Column::Id)
		.from(series::Entity)
		.and_where(series::Column::LibraryId.eq(library_id))
		.and_where(series::Column::DeletedAt.is_null())
		.to_owned()
}

/// Books that qualify as omnibuses.
///
/// `omnibus_series` is the subquery from [`omnibus_series_query`]; passing it in rather
/// than building it here keeps the library scoping decision with the caller, which is the
/// only place that knows whether one library or all of them is being browsed.
///
/// The `metadata` columns are only filterable because [`media::ModelWithMetadata::find`]
/// left-joins them.
pub fn qualifying_condition(omnibus_series: SelectStatement) -> Condition {
	let pattern = omnibus_like_pattern();

	Condition::any()
		.add(media::Column::Name.like(&pattern))
		.add(media_metadata::Column::Title.like(&pattern))
		.add(media_metadata::Column::Format.like(&pattern))
		.add(media::Column::SeriesId.in_subquery(omnibus_series))
}

/// What a set is keyed on.
///
/// Two kinds, because a flat library has both: folders that are the set, and loose files
/// that have no folder to belong to.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum SetKey {
	/// The set is a series whose own name says omnibus.
	Series(String),
	/// The set is a group of loose files sharing a normalized title.
	Title(String),
}

impl SetKey {
	/// The stable string the API and the client use to identify a set.
	pub fn as_id(&self) -> String {
		match self {
			SetKey::Series(id) => format!("series:{id}"),
			SetKey::Title(title) => format!("title:{title}"),
		}
	}
}

/// One omnibus set: a title, and the volumes of it that are on disk.
#[derive(Debug, Clone)]
pub struct OmnibusSetData {
	pub key: SetKey,
	pub title: String,
	pub series_id: Option<String>,
	pub volumes: Vec<media::ModelWithMetadata>,
}

impl OmnibusSetData {
	/// When the most recently added volume arrived, for ordering the shelf by recency.
	pub fn newest_added(&self) -> Option<sea_orm::prelude::DateTimeWithTimeZone> {
		self.volumes.iter().map(|book| book.media.created_at).max()
	}
}

/// Strip a file extension and any trailing volume markers, preserving case.
///
/// This is what makes `Wolverine Omnibus v01.cbz` and `Wolverine Omnibus v02.cbz` one set
/// rather than two. It only ever strips from the end, and it refuses to strip a name down
/// to nothing — a file called `01.cbz` keeps its name rather than becoming an empty set
/// that swallows every other unnameable book.
pub fn strip_volume_tokens(name: &str) -> String {
	let mut value = strip_extension(name).trim().to_string();

	loop {
		let trimmed = value.trim_end_matches([' ', '\t', '-', '_', ',', '.']);
		let candidate = match strip_one_trailing_token(trimmed) {
			Some(shorter) => shorter,
			None => break,
		};

		// Never strip the whole name away; a set needs something to be called.
		if candidate.trim().is_empty() {
			break;
		}

		value = candidate.trim().to_string();
	}

	collapse_whitespace(value.trim_end_matches([' ', '-', '_', ',', '.']))
}

/// The key form of a display title: lowercased, whitespace collapsed.
pub fn normalize_key(value: &str) -> String {
	collapse_whitespace(&value.to_ascii_lowercase())
}

/// Collapse books into sets, in first-seen order.
///
/// `series_names` maps a series id to its name, and must cover every series the books
/// belong to — it is how this decides whether a book's *series* is the set (the folder is
/// named for the omnibus) or whether the book has to be grouped by its own title (a loose
/// file, or one omnibus sitting in a series of ordinary issues).
///
/// That distinction is what keeps the mixed case honest: a series named plain `Batman`
/// holding a hundred issues and one `Batman Omnibus Vol 1` produces a one-volume set named
/// after the omnibus, not a hundred-volume set named `Batman`.
pub fn group_sets(
	books: Vec<media::ModelWithMetadata>,
	series_names: &HashMap<String, String>,
) -> Vec<OmnibusSetData> {
	let mut sets: Vec<OmnibusSetData> = Vec::new();
	let mut index: HashMap<SetKey, usize> = HashMap::new();

	for book in books {
		let (key, title) = set_for(
			&book.media.name,
			book.metadata
				.as_ref()
				.and_then(|metadata| metadata.title.as_deref()),
			book.media.series_id.as_deref(),
			series_names,
		);
		let series_id = book.media.series_id.clone();

		match index.get(&key) {
			Some(&position) => sets[position].volumes.push(book),
			None => {
				index.insert(key.clone(), sets.len());
				sets.push(OmnibusSetData {
					key,
					title,
					series_id,
					volumes: vec![book],
				});
			},
		}
	}

	// Volumes are named with zero-padded markers (`v01`, `v02`), so a plain name sort puts
	// them in reading order. Falling back to the name rather than the metadata number is
	// deliberate: an omnibus volume's `number` is frequently unset, and a mix of set and
	// unset numbers sorts worse than names do.
	for set in &mut sets {
		set.volumes.sort_by(|a, b| a.media.name.cmp(&b.media.name));
	}

	sets
}

/// Which set a book belongs to, and what that set is called.
///
/// Expressed over strings rather than over a database model, because that is all the rule
/// actually needs — and it means the interesting cases can be tested by naming them.
pub fn set_for(
	name: &str,
	metadata_title: Option<&str>,
	series_id: Option<&str>,
	series_names: &HashMap<String, String>,
) -> (SetKey, String) {
	if let Some(series_id) = series_id {
		if let Some(series_name) = series_names.get(series_id) {
			if matches_omnibus_name(series_name) {
				// The series name is displayed verbatim, noise and all. It is what the
				// Series tab shows, and a cleanup heuristic that guessed differently
				// would make the two tabs disagree about what a set is called.
				return (SetKey::Series(series_id.to_string()), series_name.clone());
			}
		}
	}

	let source = metadata_title
		.filter(|title| !title.trim().is_empty())
		.unwrap_or(name);

	let display = strip_volume_tokens(source);
	let display = if display.is_empty() {
		name.to_string()
	} else {
		display
	};

	(SetKey::Title(normalize_key(&display)), display)
}

fn strip_extension(name: &str) -> &str {
	match name.rsplit_once('.') {
		Some((stem, extension))
			if !stem.is_empty()
				&& BOOK_EXTENSIONS.contains(&extension.to_ascii_lowercase().as_str()) =>
		{
			stem
		},
		_ => name,
	}
}

/// Remove one trailing volume marker, or `None` if the name does not end in one.
fn strip_one_trailing_token(value: &str) -> Option<&str> {
	if let Some(stripped) = strip_trailing_bracketed(value) {
		return Some(stripped);
	}

	// A single word is the name itself; there is nothing trailing to remove.
	let (head, last) = value.rsplit_once(char::is_whitespace)?;

	let lowered = last.to_ascii_lowercase();
	let is_volume_marker = matches!(lowered.as_str(), "vol" | "vol." | "volume" | "v")
		|| is_prefixed_number(&lowered, 'v')
		|| is_prefixed_number(&lowered, '#')
		|| (!last.is_empty() && last.chars().all(|c| c.is_ascii_digit()));

	is_volume_marker.then_some(head)
}

/// Remove a trailing `(...)` or `[...]` group, respecting nesting.
fn strip_trailing_bracketed(value: &str) -> Option<&str> {
	let (open, close) = match value.chars().last()? {
		')' => ('(', ')'),
		']' => ('[', ']'),
		_ => return None,
	};

	let mut depth = 0usize;
	for (offset, character) in value.char_indices().rev() {
		if character == close {
			depth += 1;
		} else if character == open {
			depth -= 1;
			if depth == 0 {
				// A name that is *entirely* a bracketed group has no stem to keep.
				return (offset > 0).then(|| &value[..offset]);
			}
		}
	}

	None
}

fn collapse_whitespace(value: &str) -> String {
	value.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Whether a word is `prefix` followed by nothing but digits — `v01`, `#3`.
///
/// The digits are required: a bare `v` or `#` is not a volume marker, and treating it as
/// one would eat the last word of a legitimate title.
fn is_prefixed_number(word: &str, prefix: char) -> bool {
	match word.strip_prefix(prefix) {
		Some(digits) => !digits.is_empty() && digits.chars().all(|c| c.is_ascii_digit()),
		None => false,
	}
}

#[cfg(test)]
mod tests {
	use chrono::Utc;
	use models::shared::enums::FileStatus;

	use super::*;

	fn series_named(id: &str, name: &str) -> HashMap<String, String> {
		HashMap::from([(id.to_string(), name.to_string())])
	}

	/// The models don't derive `Default` — `DateTimeWithTimeZone` has no default — so a
	/// grouping test builds its books the long way.
	fn book(id: &str, name: &str, series_id: Option<&str>) -> media::ModelWithMetadata {
		media::ModelWithMetadata {
			media: media::Model {
				id: id.to_string(),
				name: name.to_string(),
				size: 0,
				extension: "cbz".to_string(),
				pages: 1,
				updated_at: None,
				created_at: Utc::now().fixed_offset(),
				modified_at: None,
				hash: None,
				koreader_hash: None,
				path: format!("/comics/{name}"),
				status: FileStatus::Ready,
				thumbnail_meta: None,
				thumbnail_path: None,
				series_id: series_id.map(String::from),
				book_group_id: None,
				book_group_locked: false,
				deleted_at: None,
			},
			metadata: None,
		}
	}

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

	#[test]
	fn volume_markers_are_stripped_from_a_set_title() {
		assert_eq!(
			strip_volume_tokens("Wolverine Omnibus v01.cbz"),
			"Wolverine Omnibus"
		);
		assert_eq!(
			strip_volume_tokens("Wolverine Omnibus V02.cbr"),
			"Wolverine Omnibus"
		);
		assert_eq!(
			strip_volume_tokens("Wolverine Omnibus #3"),
			"Wolverine Omnibus"
		);
		assert_eq!(
			strip_volume_tokens("Wolverine Omnibus Vol. 1 (2020)"),
			"Wolverine Omnibus"
		);
		assert_eq!(
			strip_volume_tokens("Wolverine Omnibus Volume 4"),
			"Wolverine Omnibus"
		);
		assert_eq!(
			strip_volume_tokens("Wolverine  Omnibus   05"),
			"Wolverine Omnibus"
		);
	}

	#[test]
	fn a_title_with_nothing_trailing_is_left_alone() {
		assert_eq!(
			strip_volume_tokens("Absolute Carnage Omnibus"),
			"Absolute Carnage Omnibus"
		);
		assert_eq!(
			strip_volume_tokens("Absolute Carnage Omnibus HC.cbz"),
			"Absolute Carnage Omnibus HC"
		);
	}

	/// Stripping is only ever allowed to shorten a name, never erase it — otherwise every
	/// numerically-named loose file would collapse into one enormous nameless set.
	#[test]
	fn stripping_never_empties_a_name() {
		assert_eq!(strip_volume_tokens("01.cbz"), "01");
		assert_eq!(strip_volume_tokens("(2020)"), "(2020)");
		assert_eq!(strip_volume_tokens("v01"), "v01");
	}

	#[test]
	fn nested_parentheses_are_stripped_as_one_group() {
		assert_eq!(
			strip_volume_tokens("Wolverine Omnibus (Marvel (US), 2020)"),
			"Wolverine Omnibus"
		);
	}

	/// The common case in a flat library: the folder is named for the omnibus.
	#[test]
	fn a_series_named_for_the_omnibus_owns_the_set() {
		let names =
			series_named("wolverine", "Wolverine Omnibus (Marvel, 2020-...) (01-05)");
		let (key, title) = set_for("v01.cbz", None, Some("wolverine"), &names);

		assert_eq!(key, SetKey::Series("wolverine".to_string()));
		assert_eq!(
			title, "Wolverine Omnibus (Marvel, 2020-...) (01-05)",
			"the series name is shown verbatim, matching the Series tab"
		);
	}

	/// The case that would break if sets were keyed on the series alone: one omnibus
	/// living in a series of ordinary issues must not drag the issues in with it.
	#[test]
	fn an_omnibus_in_an_ordinary_series_is_keyed_on_its_own_title() {
		let names = series_named("batman", "Batman");
		let (key, title) =
			set_for("Batman Omnibus Vol 1.cbz", None, Some("batman"), &names);

		assert_eq!(
			key,
			SetKey::Title("batman omnibus".to_string()),
			"keyed on the title, so a second omnibus in the same series joins it"
		);
		assert_eq!(
			title, "Batman Omnibus",
			"named for the omnibus, not for the series holding it"
		);
	}

	#[test]
	fn a_metadata_title_is_preferred_over_an_unhelpful_filename() {
		let (_, title) = set_for(
			"ac-omni-2019.cbz",
			Some("Absolute Carnage Omnibus"),
			None,
			&HashMap::new(),
		);

		assert_eq!(title, "Absolute Carnage Omnibus");
	}

	#[test]
	fn a_blank_metadata_title_falls_back_to_the_filename() {
		let (_, title) =
			set_for("Thor Omnibus v01.cbz", Some("   "), None, &HashMap::new());

		assert_eq!(title, "Thor Omnibus");
	}

	#[test]
	fn set_ids_are_prefixed_by_kind() {
		assert_eq!(SetKey::Series("abc".to_string()).as_id(), "series:abc");
		assert_eq!(
			SetKey::Title("thor omnibus".to_string()).as_id(),
			"title:thor omnibus"
		);
	}

	#[test]
	fn volumes_of_one_series_collapse_into_a_single_set_in_reading_order() {
		let names = series_named("wolverine", "Wolverine Omnibus");
		let sets = group_sets(
			vec![
				book("2", "Wolverine Omnibus v02.cbz", Some("wolverine")),
				book("1", "Wolverine Omnibus v01.cbz", Some("wolverine")),
				book("3", "Wolverine Omnibus v03.cbz", Some("wolverine")),
			],
			&names,
		);

		assert_eq!(sets.len(), 1);
		assert_eq!(sets[0].title, "Wolverine Omnibus");
		assert_eq!(sets[0].series_id.as_deref(), Some("wolverine"));
		assert_eq!(
			sets[0]
				.volumes
				.iter()
				.map(|book| book.media.id.as_str())
				.collect::<Vec<_>>(),
			["1", "2", "3"],
			"volumes are name-sorted, so zero-padded markers read in volume order"
		);
	}

	/// Loose files with no series row still group, on their normalized title.
	#[test]
	fn loose_files_group_on_their_title() {
		let sets = group_sets(
			vec![
				book("1", "Thor Omnibus v01.cbz", None),
				book("2", "Thor Omnibus v02.cbz", None),
			],
			&HashMap::new(),
		);

		assert_eq!(sets.len(), 1);
		assert_eq!(sets[0].title, "Thor Omnibus");
		assert_eq!(sets[0].key, SetKey::Title("thor omnibus".to_string()));
		assert_eq!(sets[0].volumes.len(), 2);
	}

	#[test]
	fn distinct_omnibuses_stay_distinct_and_keep_first_seen_order() {
		let mut names = series_named("wolverine", "Wolverine Omnibus");
		names.insert("thor".to_string(), "Thor Omnibus".to_string());

		let sets = group_sets(
			vec![
				book("1", "v01.cbz", Some("wolverine")),
				book("2", "v01.cbz", Some("thor")),
			],
			&names,
		);

		assert_eq!(sets.len(), 2);
		assert_eq!(sets[0].title, "Wolverine Omnibus");
		assert_eq!(sets[1].title, "Thor Omnibus");
	}

	/// A single-volume omnibus is still a set — hiding it would make the shelf undercount
	/// a book that is genuinely in the collection.
	#[test]
	fn a_lone_omnibus_is_still_a_set() {
		let sets = group_sets(
			vec![book("1", "Absolute Carnage Omnibus HC.cbz", None)],
			&HashMap::new(),
		);

		assert_eq!(sets.len(), 1);
		assert_eq!(sets[0].volumes.len(), 1);
		assert_eq!(sets[0].title, "Absolute Carnage Omnibus HC");
	}
}

/// Tests that exercise the SQL, rather than the naming rule.
///
/// The pure functions above are covered without a database, but the condition
/// [`qualifying_condition`] builds is the part that can only fail against a real schema:
/// it filters on `media_metadata` columns reachable only through a join, and on a
/// `series` subquery. A mistake there is an ambiguous-column or missing-join error at
/// runtime, which no amount of string-level testing would catch.
#[cfg(test)]
mod sql_tests {
	use chrono::Utc;
	use migrations::{Migrator, MigratorTrait};
	use models::{
		entity::{library, library_config, media, media_metadata, series},
		shared::enums::{
			FileStatus, LibraryPattern, LibraryViewMode, ReadingDirection,
			ReadingImageScaleFit, ReadingMode,
		},
	};
	use sea_orm::{
		ActiveModelTrait, Database, DatabaseConnection, EntityTrait, QueryFilter,
		QueryOrder, Set,
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
	/// key — so a scoping test cannot invent a library id.
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

	/// Run the shelf's query the way the resolver does, minus the permission scoping.
	async fn qualifying_ids(
		conn: &DatabaseConnection,
		library_id: Option<&str>,
	) -> Vec<String> {
		let books = media::ModelWithMetadata::find()
			.filter(media::Column::DeletedAt.is_null())
			.filter(qualifying_condition(omnibus_series_query(library_id)))
			.order_by_asc(media::Column::Id)
			.into_model::<media::ModelWithMetadata>()
			.all(conn)
			.await
			.expect("the shelf query runs");

		books.into_iter().map(|book| book.media.id).collect()
	}

	/// The four signals, against a real schema. `metadata.format` and the `series.name`
	/// subquery are the two that a join mistake would break.
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
			qualifying_ids(&conn, None).await,
			["by-format", "by-name", "by-series"],
			"the ordinary issue is excluded, and each of the three signals pulls its book in"
		);
	}

	#[tokio::test]
	async fn a_loose_file_with_no_series_still_qualifies() {
		let conn = mem_db().await;
		seed_book(&conn, "loose", "Thor Omnibus v01.cbz", None, None).await;

		assert_eq!(qualifying_ids(&conn, None).await, ["loose"]);
	}

	/// Library scoping runs through the series table, because a book has no library of its
	/// own. A book in another library must not appear.
	#[tokio::test]
	async fn the_series_subquery_scopes_to_one_library() {
		let conn = mem_db().await;
		seed_library(&conn, "lib-1").await;
		seed_series(&conn, "s-mine", "Wolverine Omnibus", "lib-1").await;
		seed_library(&conn, "lib-2").await;
		seed_series(&conn, "s-theirs", "Thor Omnibus", "lib-2").await;
		seed_book(&conn, "mine", "v01.cbz", Some("s-mine"), None).await;
		seed_book(&conn, "theirs", "v01.cbz", Some("s-theirs"), None).await;

		assert_eq!(
			qualifying_ids(&conn, Some("lib-1")).await,
			["mine"],
			"the other library's omnibus is not on this library's shelf"
		);
	}

	/// End to end: qualify, then group, with the series names the resolver would fetch.
	#[tokio::test]
	async fn qualifying_books_group_into_the_expected_sets() {
		let conn = mem_db().await;
		seed_library(&conn, "lib-1").await;
		seed_series(&conn, "s-omni", "Wolverine Omnibus (Marvel, 2020)", "lib-1").await;
		seed_series(&conn, "s-plain", "Batman", "lib-1").await;
		seed_book(&conn, "w-1", "v01.cbz", Some("s-omni"), None).await;
		seed_book(&conn, "w-2", "v02.cbz", Some("s-omni"), None).await;
		seed_book(
			&conn,
			"b-1",
			"Batman Omnibus Vol 1.cbz",
			Some("s-plain"),
			None,
		)
		.await;
		seed_book(&conn, "b-2", "Batman 002.cbz", Some("s-plain"), None).await;

		let books = media::ModelWithMetadata::find()
			.filter(qualifying_condition(omnibus_series_query(Some("lib-1"))))
			.order_by_asc(media::Column::Name)
			.into_model::<media::ModelWithMetadata>()
			.all(&conn)
			.await
			.expect("query runs");

		let names = series::Entity::find()
			.all(&conn)
			.await
			.expect("series load")
			.into_iter()
			.map(|row| (row.id, row.name))
			.collect::<HashMap<_, _>>();

		let sets = group_sets(books, &names);
		let mut summary = sets
			.iter()
			.map(|set| (set.title.as_str(), set.volumes.len()))
			.collect::<Vec<_>>();
		summary.sort();

		assert_eq!(
			summary,
			[
				("Batman Omnibus", 1),
				("Wolverine Omnibus (Marvel, 2020)", 2)
			],
			"the two-volume set collapses, and the omnibus inside Batman does not drag \
			 the ordinary issue in with it"
		);
	}
}
