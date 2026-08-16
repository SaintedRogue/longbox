//! The release calendar and updates feed: read models over `expected_issues`
//! (provider skeletons) and the viewer's follows. Nothing here mutates media —
//! "in library" is derived by number-matching against the series' books.

use std::collections::{HashMap, HashSet};

use async_graphql::{Context, Enum, Object, Result, SimpleObject, ID};
use chrono::{Datelike, Duration, NaiveDate, Utc};
use longbox_core::filesystem::metadata::sweep_in_flight;
use metadata_integrations::issue_numbers_match;
use models::{
	entity::{
		expected_issue, media, media_metadata, reading_session, scheduled_job, series,
		series_follow, server_config, user::AuthUser,
	},
	shared::enums::{ReadingStatus, ScheduledJobKind},
};
use sea_orm::{prelude::*, QueryOrder, QuerySelect};

use crate::data::{AuthContext, CoreContext};

#[derive(Default)]
pub struct ReleaseCalendarQuery;

#[derive(Enum, Copy, Clone, Eq, PartialEq)]
pub enum CalendarScope {
	/// Only series the viewer follows — the personal pull list.
	Followed,
	/// Every series in the viewer's library, followed or not.
	Library,
	/// Every release the providers reported, whether or not anything here corresponds to
	/// it. This is the "what is coming out" question, which is not a question about the
	/// library: a calendar that only lists what you already own cannot show you anything
	/// you might want to start.
	Everything,
}

#[derive(SimpleObject)]
pub struct CalendarEntry {
	/// The library series this release belongs to, or null when none does — either
	/// because nothing here matches it, or because the viewer cannot see the series that
	/// does. Null means there is nothing to link to and nothing to follow.
	pub series_id: Option<ID>,
	/// The library's name for the series when it is bound, otherwise the provider's.
	pub series_name: String,
	pub number: Option<String>,
	pub title: Option<String>,
	pub cover_url: Option<String>,
	/// ISO `YYYY-MM-DD`.
	pub release_date: String,
	/// Whether a book with this issue number already exists in the series.
	pub in_library: bool,
	/// Whether the viewer follows this series. Drives the subscribe control, and is what
	/// lets the "all releases" view offer to subscribe to something it is showing you.
	pub is_followed: bool,
}

/// How far ahead the upcoming view may look. Matches the sweep's own forward window —
/// asking for more than the oracle ever writes would just render empty days.
const MAX_UPCOMING_DAYS: i32 = 90;

/// Most entries any one day will return.
///
/// Only [`CalendarScope::Everything`] gets near it: a single new-comic Wednesday is several
/// hundred releases across the providers, and a month grid asks for forty-two days at once.
/// Capping per day rather than per query is what makes that bounded without truncating the
/// far end of the window — the days a reader cares about are still all present.
const MAX_ENTRIES_PER_DAY: usize = 50;

/// The state of the calendar's own data: is it refreshing, and how stale is it.
#[derive(SimpleObject)]
pub struct ReleaseCalendarStatus {
	/// A sweep is in flight right now. Starting a second one is refused.
	pub is_running: bool,
	/// RFC 3339 of the last *successful* sync, by any route. Null if it has never run.
	pub last_synced_at: Option<String>,
	/// Whether an enabled schedule exists, so the UI can say whether this refreshes on
	/// its own or only when asked.
	pub is_scheduled: bool,
}

#[derive(SimpleObject)]
pub struct CalendarDay {
	/// ISO `YYYY-MM-DD`.
	pub date: String,
	/// How many releases this day actually has, before [`MAX_ENTRIES_PER_DAY`]. Counts
	/// stay truthful even where the list is trimmed, so a day badge never under-reports.
	pub total: i32,
	pub entries: Vec<CalendarEntry>,
}

/// Assemble one day's cell, ordered so that trimming can only ever drop the releases the
/// viewer has least stake in: followed series first, then owned, then anything bound to the
/// library at all, then alphabetically.
fn build_day(date: String, mut entries: Vec<CalendarEntry>) -> CalendarDay {
	let total = entries.len() as i32;
	entries.sort_by(|a, b| {
		b.is_followed
			.cmp(&a.is_followed)
			.then_with(|| b.in_library.cmp(&a.in_library))
			.then_with(|| b.series_id.is_some().cmp(&a.series_id.is_some()))
			.then_with(|| a.series_name.cmp(&b.series_name))
			.then_with(|| a.number.cmp(&b.number))
	});
	entries.truncate(MAX_ENTRIES_PER_DAY);
	CalendarDay {
		date,
		total,
		entries,
	}
}

/// A month as a calendar actually draws one: six whole weeks of cells, including the tail
/// of the previous month and the head of the next.
#[derive(SimpleObject)]
pub struct CalendarMonth {
	/// ISO `YYYY-MM-01` for the month being shown — the frontend compares each cell's
	/// date against this to know which cells are padding.
	pub month_start: String,
	/// e.g. "August 2026".
	pub label: String,
	/// Always 42 cells, oldest first. A grid that changed height month to month would
	/// make the page jump on every page-through.
	pub days: Vec<CalendarDay>,
}

#[derive(SimpleObject)]
pub struct UpdateItem {
	pub media_id: ID,
	pub series_id: ID,
	pub series_name: String,
	pub media_name: String,
	/// RFC 3339.
	pub created_at: String,
	pub is_read: bool,
}

#[derive(SimpleObject)]
pub struct UpdatesFeed {
	pub items: Vec<UpdateItem>,
	/// True when the window held more items than the cap.
	pub capped: bool,
}

/// Sunday-aligned week window (UTC): offset 0 is the current week.
pub(crate) fn week_window(today: NaiveDate, week_offset: i32) -> (NaiveDate, NaiveDate) {
	let days_from_sunday = today.weekday().num_days_from_sunday() as i64;
	let start =
		today - Duration::days(days_from_sunday) + Duration::weeks(week_offset as i64);
	(start, start + Duration::days(6))
}

/// The first of the month `month_offset` months from `today`'s month.
pub(crate) fn month_start(today: NaiveDate, month_offset: i32) -> NaiveDate {
	// Work in absolute months so the arithmetic can't produce a month 0 or 13.
	let absolute = today.year() * 12 + (today.month0() as i32) + month_offset;
	let year = absolute.div_euclid(12);
	let month0 = absolute.rem_euclid(12) as u32;
	NaiveDate::from_ymd_opt(year, month0 + 1, 1).unwrap_or(today)
}

/// The Sunday-aligned grid a month is drawn on: whole weeks, so every row has seven
/// cells, padded with the tail of the previous month and the head of the next.
///
/// Six rows rather than five-or-six. A grid that changes height month to month makes the
/// whole page jump when you page through it, and a calendar is something you page through.
pub(crate) fn month_grid_window(month_start: NaiveDate) -> (NaiveDate, NaiveDate) {
	let lead = month_start.weekday().num_days_from_sunday() as i64;
	let start = month_start - Duration::days(lead);
	(start, start + Duration::days(41))
}

/// Accessible series for the viewer, as `id -> name`. Library exclusions and
/// age restrictions apply exactly as in the series browser.
async fn accessible_series(
	conn: &DatabaseConnection,
	user: &AuthUser,
) -> Result<HashMap<String, String>> {
	Ok(series::Entity::find_for_user(user)
		.all(conn)
		.await?
		.into_iter()
		.map(|s| (s.id, s.name))
		.collect())
}

async fn followed_series_ids_for(
	conn: &DatabaseConnection,
	user_id: &str,
) -> Result<HashSet<String>> {
	Ok(series_follow::Entity::find()
		.filter(series_follow::Column::UserId.eq(user_id))
		.all(conn)
		.await?
		.into_iter()
		.map(|f| f.series_id)
		.collect())
}

/// Every expected issue the viewer can see between `start` and `end`, oldest first.
///
/// Shared by the week grid and the upcoming list: they differ only in the window they ask
/// for and how they group the answer, so the scoping, the in-library match and the follow
/// lookup all live here rather than being kept in step in two places.
async fn entries_between(
	conn: &DatabaseConnection,
	user: &AuthUser,
	scope: CalendarScope,
	start: NaiveDate,
	end: NaiveDate,
) -> Result<Vec<CalendarEntry>> {
	let accessible = accessible_series(conn, user).await?;
	let follows = followed_series_ids_for(conn, &user.id).await?;

	let windowed = expected_issue::Entity::find()
		.filter(expected_issue::Column::ReleaseDate.gte(start.to_string()))
		.filter(expected_issue::Column::ReleaseDate.lte(end.to_string()));

	// `Everything` deliberately applies no series filter — an unbound release has no
	// series to scope by, and it is exactly what that scope exists to show.
	let query = match scope {
		CalendarScope::Everything => windowed,
		CalendarScope::Library | CalendarScope::Followed => {
			let scoped_ids: Vec<String> = match scope {
				CalendarScope::Followed => accessible
					.keys()
					.filter(|id| follows.contains(*id))
					.cloned()
					.collect(),
				_ => accessible.keys().cloned().collect(),
			};
			if scoped_ids.is_empty() {
				return Ok(vec![]);
			}
			windowed.filter(expected_issue::Column::SeriesId.is_in(scoped_ids))
		},
	};

	let expected = query
		.order_by_asc(expected_issue::Column::ReleaseDate)
		.all(conn)
		.await?;

	// Owned issue numbers per involved series, for the in-library badge. Only series the
	// viewer can actually see are asked about.
	let involved: Vec<String> = expected
		.iter()
		.filter_map(|e| e.series_id.clone())
		.filter(|id| accessible.contains_key(id))
		.collect();
	let mut numbers_by_series: HashMap<String, Vec<String>> = HashMap::new();
	if !involved.is_empty() {
		let books = media::Entity::find()
			.filter(media::Column::SeriesId.is_in(involved))
			.select_only()
			.column(media::Column::Id)
			.column(media::Column::SeriesId)
			.into_tuple::<(String, Option<String>)>()
			.all(conn)
			.await?;
		let media_ids: Vec<String> = books.iter().map(|(id, _)| id.clone()).collect();
		let series_by_media: HashMap<String, String> = books
			.into_iter()
			.filter_map(|(id, sid)| sid.map(|sid| (id, sid)))
			.collect();
		let metadata_numbers = media_metadata::Entity::find()
			.filter(media_metadata::Column::MediaId.is_in(media_ids))
			.all(conn)
			.await?;
		for row in metadata_numbers {
			let (Some(media_id), Some(number)) = (row.media_id, row.number) else {
				continue;
			};
			if let Some(series_id) = series_by_media.get(&media_id) {
				numbers_by_series
					.entry(series_id.clone())
					.or_default()
					.push(number.normalize().to_string());
			}
		}
	}

	Ok(expected
		.into_iter()
		.filter_map(|entry| {
			let release_date = entry.release_date.clone()?;

			// A row bound to a series the viewer cannot see is presented as an unbound
			// release rather than dropped or linked: the release itself is public
			// knowledge from the provider, while the fact that *this* server holds the
			// series is not the calendar's to disclose.
			let bound = entry
				.series_id
				.as_ref()
				.filter(|id| accessible.contains_key(*id));

			let (series_id, series_name, is_followed, in_library) = match bound {
				Some(id) => {
					let in_library =
						entry.number.as_deref().is_some_and(|expected_number| {
							numbers_by_series.get(id).is_some_and(|owned| {
								owned
									.iter()
									.any(|n| issue_numbers_match(n, expected_number))
							})
						});
					(
						Some(ID::from(id.clone())),
						// The library's name wins over the provider's: it is the one the
						// user filed the series under and the one they will recognise.
						accessible.get(id).cloned().unwrap_or_default(),
						follows.contains(id),
						in_library,
					)
				},
				// Falling back through the issue title covers providers that name the
				// series only inside it; a release with neither is still worth a date.
				None => (
					None,
					entry
						.series_name
						.clone()
						.or_else(|| entry.title.clone())
						.unwrap_or_else(|| "Unknown series".to_string()),
					false,
					false,
				),
			};

			Some(CalendarEntry {
				series_id,
				series_name,
				is_followed,
				number: entry.number,
				title: entry.title,
				cover_url: entry.cover_url,
				release_date,
				in_library,
			})
		})
		.collect())
}

#[Object]
impl ReleaseCalendarQuery {
	/// Series ids the viewer follows.
	async fn followed_series_ids(&self, ctx: &Context<'_>) -> Result<Vec<ID>> {
		let AuthContext { user, .. } = ctx.data::<AuthContext>()?;
		let conn = ctx.data::<CoreContext>()?.conn.as_ref();
		let mut ids: Vec<String> = followed_series_ids_for(conn, &user.id)
			.await?
			.into_iter()
			.collect();
		ids.sort();
		Ok(ids.into_iter().map(ID::from).collect())
	}

	/// One Sunday-aligned week of expected releases, day by day (all seven days
	/// are present, empty or not, so the grid renders without gap logic).
	async fn release_calendar(
		&self,
		ctx: &Context<'_>,
		#[graphql(default = 0)] week_offset: i32,
		#[graphql(default_with = "CalendarScope::Followed")] scope: CalendarScope,
	) -> Result<Vec<CalendarDay>> {
		let AuthContext { user, .. } = ctx.data::<AuthContext>()?;
		let conn = ctx.data::<CoreContext>()?.conn.as_ref();

		let (start, end) = week_window(Utc::now().date_naive(), week_offset);
		let mut by_index: Vec<Vec<CalendarEntry>> = (0..7).map(|_| Vec::new()).collect();

		for entry in entries_between(conn, user, scope, start, end).await? {
			let day_index = NaiveDate::parse_from_str(&entry.release_date, "%Y-%m-%d")
				.ok()
				.and_then(|d| usize::try_from((d - start).num_days()).ok())
				.filter(|i| *i < 7);
			let Some(day_index) = day_index else {
				continue;
			};
			by_index[day_index].push(entry);
		}

		Ok(by_index
			.into_iter()
			.enumerate()
			.map(|(index, entries)| {
				build_day((start + Duration::days(index as i64)).to_string(), entries)
			})
			.collect())
	}

	/// A month laid out as a grid: six whole weeks of cells, every one present whether or
	/// not it has anything on it, so the frontend renders rows without gap logic.
	async fn release_calendar_month(
		&self,
		ctx: &Context<'_>,
		#[graphql(default = 0)] month_offset: i32,
		#[graphql(default_with = "CalendarScope::Followed")] scope: CalendarScope,
	) -> Result<CalendarMonth> {
		let AuthContext { user, .. } = ctx.data::<AuthContext>()?;
		let conn = ctx.data::<CoreContext>()?.conn.as_ref();

		let start_of_month = month_start(Utc::now().date_naive(), month_offset);
		let (start, end) = month_grid_window(start_of_month);

		let mut by_date: HashMap<String, Vec<CalendarEntry>> = HashMap::new();
		for entry in entries_between(conn, user, scope, start, end).await? {
			by_date
				.entry(entry.release_date.clone())
				.or_default()
				.push(entry);
		}

		let days = (0..42)
			.map(|offset| {
				let date = (start + Duration::days(offset)).to_string();
				let entries = by_date.remove(&date).unwrap_or_default();
				build_day(date, entries)
			})
			.collect();

		Ok(CalendarMonth {
			month_start: start_of_month.to_string(),
			label: start_of_month.format("%B %Y").to_string(),
			days,
		})
	}

	/// Everything expected from today onward, grouped by day.
	///
	/// Unlike the week grid this omits days with nothing on them: it is a list of what is
	/// coming, and a run of empty dates carries no information in that framing.
	async fn upcoming_releases(
		&self,
		ctx: &Context<'_>,
		#[graphql(default = 90)] days: i32,
		#[graphql(default_with = "CalendarScope::Followed")] scope: CalendarScope,
	) -> Result<Vec<CalendarDay>> {
		let AuthContext { user, .. } = ctx.data::<AuthContext>()?;
		let conn = ctx.data::<CoreContext>()?.conn.as_ref();

		let today = Utc::now().date_naive();
		let end = today + Duration::days(days.clamp(1, MAX_UPCOMING_DAYS) as i64);

		let mut grouped: Vec<(String, Vec<CalendarEntry>)> = Vec::new();
		for entry in entries_between(conn, user, scope, today, end).await? {
			// `entries_between` returns oldest first, so the run of entries for one date is
			// contiguous and only the last group can ever match.
			match grouped.last_mut() {
				Some((date, entries)) if *date == entry.release_date => {
					entries.push(entry)
				},
				_ => grouped.push((entry.release_date.clone(), vec![entry])),
			}
		}

		Ok(grouped
			.into_iter()
			.map(|(date, entries)| build_day(date, entries))
			.collect())
	}

	/// Whether the calendar is syncing, and when it last did.
	async fn release_calendar_status(
		&self,
		ctx: &Context<'_>,
	) -> Result<ReleaseCalendarStatus> {
		let core = ctx.data::<CoreContext>()?;
		let conn = core.conn.as_ref();

		let last_synced_at = server_config::Entity::find()
			.one(conn)
			.await?
			.and_then(|config| config.last_release_calendar_sync_at)
			.map(|t| t.to_rfc3339());

		let schedule = scheduled_job::Entity::find()
			.filter(scheduled_job::Column::Kind.eq(ScheduledJobKind::ReleaseCalendarSync))
			.one(conn)
			.await?;

		Ok(ReleaseCalendarStatus {
			is_running: sweep_in_flight(),
			last_synced_at,
			is_scheduled: schedule.is_some_and(|job| job.enabled),
		})
	}

	/// New books in followed series, newest first — 30-day window, hard cap.
	async fn updates_feed(
		&self,
		ctx: &Context<'_>,
		#[graphql(default = 30)] days: i32,
		#[graphql(default = 500)] cap: i32,
	) -> Result<UpdatesFeed> {
		let AuthContext { user, .. } = ctx.data::<AuthContext>()?;
		let conn = ctx.data::<CoreContext>()?.conn.as_ref();

		let days = days.clamp(1, 365);
		let cap = cap.clamp(1, 1000) as usize;

		let accessible = accessible_series(conn, user).await?;
		let follows = followed_series_ids_for(conn, &user.id).await?;
		let scoped: Vec<String> = follows
			.into_iter()
			.filter(|id| accessible.contains_key(id))
			.collect();
		if scoped.is_empty() {
			return Ok(UpdatesFeed {
				items: vec![],
				capped: false,
			});
		}

		let cutoff = Utc::now() - Duration::days(days as i64);
		let mut books = media::Entity::find()
			.filter(media::Column::SeriesId.is_in(scoped))
			.filter(media::Column::CreatedAt.gte(cutoff))
			.filter(media::Column::DeletedAt.is_null())
			.order_by_desc(media::Column::CreatedAt)
			.order_by_desc(media::Column::Id)
			.limit((cap + 1) as u64)
			.all(conn)
			.await?;
		let capped = books.len() > cap;
		books.truncate(cap);

		let media_ids: Vec<String> = books.iter().map(|b| b.id.clone()).collect();
		let finished: HashSet<String> = reading_session::Entity::find()
			.filter(reading_session::Column::UserId.eq(&user.id))
			.filter(reading_session::Column::MediaId.is_in(media_ids))
			.filter(reading_session::Column::Status.eq(ReadingStatus::Finished))
			.all(conn)
			.await?
			.into_iter()
			.map(|s| s.media_id)
			.collect();

		let items = books
			.into_iter()
			.filter_map(|book| {
				let series_id = book.series_id.clone()?;
				let series_name = accessible.get(&series_id)?.clone();
				Some(UpdateItem {
					is_read: finished.contains(&book.id),
					media_id: ID::from(book.id),
					series_id: ID::from(series_id),
					series_name,
					media_name: book.name,
					created_at: book.created_at.to_rfc3339(),
				})
			})
			.collect();

		Ok(UpdatesFeed { items, capped })
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	fn day(year: i32, month: u32, day: u32) -> NaiveDate {
		NaiveDate::from_ymd_opt(year, month, day).unwrap()
	}

	#[test]
	fn month_start_snaps_to_the_first() {
		assert_eq!(month_start(day(2026, 8, 15), 0), day(2026, 8, 1));
		assert_eq!(month_start(day(2026, 8, 1), 0), day(2026, 8, 1));
		assert_eq!(month_start(day(2026, 8, 31), 0), day(2026, 8, 1));
	}

	/// Naive month arithmetic overflows into a month 0 or 13 at the year boundary; this
	/// works in absolute months so it cannot.
	#[test]
	fn month_start_crosses_years_in_both_directions() {
		assert_eq!(month_start(day(2026, 12, 10), 1), day(2027, 1, 1));
		assert_eq!(month_start(day(2026, 1, 10), -1), day(2025, 12, 1));
		assert_eq!(month_start(day(2026, 8, 15), 12), day(2027, 8, 1));
		assert_eq!(month_start(day(2026, 8, 15), -20), day(2024, 12, 1));
	}

	/// Every row must have seven cells, so the grid starts on the Sunday on or before the
	/// first of the month.
	#[test]
	fn month_grid_starts_on_a_sunday_and_is_always_six_weeks() {
		for (year, month) in [(2026, 8), (2026, 2), (2027, 1), (2024, 2)] {
			let first = day(year, month, 1);
			let (start, end) = month_grid_window(first);

			assert_eq!(
				start.weekday().num_days_from_sunday(),
				0,
				"{year}-{month} grid must start on a Sunday"
			);
			assert!(start <= first, "grid must not start after the 1st");
			assert_eq!(
				(end - start).num_days(),
				41,
				"{year}-{month} grid must be exactly six weeks"
			);
			// The whole month has to fit inside the six rows.
			let next_month = month_start(first, 1);
			assert!(
				end >= next_month - Duration::days(1),
				"{year}-{month} grid must cover the whole month"
			);
		}
	}

	/// A month that starts on a Sunday must not gain a blank leading week.
	#[test]
	fn a_month_starting_on_sunday_has_no_leading_padding() {
		// 2026-11-01 is a Sunday.
		let first = day(2026, 11, 1);
		assert_eq!(first.weekday().num_days_from_sunday(), 0);
		assert_eq!(month_grid_window(first).0, first);
	}

	#[test]
	fn week_window_is_sunday_aligned() {
		// 2026-08-09 is a Sunday.
		let sunday = NaiveDate::from_ymd_opt(2026, 8, 9).unwrap();
		assert_eq!(
			week_window(sunday, 0),
			(sunday, NaiveDate::from_ymd_opt(2026, 8, 15).unwrap())
		);
		// Mid-week snaps back to the same Sunday; offsets move whole weeks.
		let wednesday = NaiveDate::from_ymd_opt(2026, 8, 12).unwrap();
		assert_eq!(week_window(wednesday, 0).0, sunday);
		assert_eq!(
			week_window(wednesday, 1).0,
			NaiveDate::from_ymd_opt(2026, 8, 16).unwrap()
		);
		assert_eq!(
			week_window(wednesday, -1).0,
			NaiveDate::from_ymd_opt(2026, 8, 2).unwrap()
		);
	}
}
