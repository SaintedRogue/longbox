//! The release calendar and updates feed: read models over `expected_issues`
//! (provider skeletons) and the viewer's follows. Nothing here mutates media —
//! "in library" is derived by number-matching against the series' books.

use std::collections::{HashMap, HashSet};

use async_graphql::{Context, Enum, Object, Result, SimpleObject, ID};
use chrono::{Datelike, Duration, NaiveDate, Utc};
use metadata_integrations::issue_numbers_match;
use models::{
	entity::{
		expected_issue, media, media_metadata, reading_session, series, series_follow,
		user::AuthUser,
	},
	shared::enums::ReadingStatus,
};
use sea_orm::{prelude::*, QueryOrder, QuerySelect};

use crate::data::{AuthContext, CoreContext};

#[derive(Default)]
pub struct ReleaseCalendarQuery;

#[derive(Enum, Copy, Clone, Eq, PartialEq)]
pub enum CalendarScope {
	/// Only series the viewer follows — the personal pull list.
	Followed,
	/// Every series the viewer can access.
	All,
}

#[derive(SimpleObject)]
pub struct CalendarEntry {
	pub series_id: ID,
	pub series_name: String,
	pub number: Option<String>,
	pub title: Option<String>,
	pub cover_url: Option<String>,
	/// ISO `YYYY-MM-DD`.
	pub release_date: String,
	/// Whether a book with this issue number already exists in the series.
	pub in_library: bool,
}

#[derive(SimpleObject)]
pub struct CalendarDay {
	/// ISO `YYYY-MM-DD`.
	pub date: String,
	pub entries: Vec<CalendarEntry>,
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

		let accessible = accessible_series(conn, user).await?;
		let scoped_ids: Vec<String> = match scope {
			CalendarScope::All => accessible.keys().cloned().collect(),
			CalendarScope::Followed => {
				let follows = followed_series_ids_for(conn, &user.id).await?;
				accessible
					.keys()
					.filter(|id| follows.contains(*id))
					.cloned()
					.collect()
			},
		};

		let (start, end) = week_window(Utc::now().date_naive(), week_offset);
		let mut days: Vec<CalendarDay> = (0..7)
			.map(|d| CalendarDay {
				date: (start + Duration::days(d)).to_string(),
				entries: Vec::new(),
			})
			.collect();

		if scoped_ids.is_empty() {
			return Ok(days);
		}

		let expected = expected_issue::Entity::find()
			.filter(expected_issue::Column::SeriesId.is_in(scoped_ids))
			.filter(expected_issue::Column::ReleaseDate.gte(start.to_string()))
			.filter(expected_issue::Column::ReleaseDate.lte(end.to_string()))
			.order_by_asc(expected_issue::Column::ReleaseDate)
			.all(conn)
			.await?;

		// Owned issue numbers per involved series, for the in-library badge.
		let involved: Vec<String> =
			expected.iter().map(|e| e.series_id.clone()).collect();
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

		for entry in expected {
			let Some(release_date) = entry.release_date.clone() else {
				continue;
			};
			let Some(series_name) = accessible.get(&entry.series_id) else {
				continue;
			};
			let in_library = entry.number.as_deref().is_some_and(|expected_number| {
				numbers_by_series
					.get(&entry.series_id)
					.is_some_and(|owned| {
						owned
							.iter()
							.any(|n| issue_numbers_match(n, expected_number))
					})
			});
			let day_index = NaiveDate::parse_from_str(&release_date, "%Y-%m-%d")
				.ok()
				.and_then(|d| usize::try_from((d - start).num_days()).ok())
				.filter(|i| *i < 7);
			let Some(day_index) = day_index else {
				continue;
			};
			days[day_index].entries.push(CalendarEntry {
				series_id: ID::from(entry.series_id.clone()),
				series_name: series_name.clone(),
				number: entry.number,
				title: entry.title,
				cover_url: entry.cover_url,
				release_date,
				in_library,
			});
		}

		Ok(days)
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
