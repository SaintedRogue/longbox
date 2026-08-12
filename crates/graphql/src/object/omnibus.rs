use async_graphql::{SimpleObject, ID};
use longbox_core::omnibus::OmnibusSetData;

use super::media::Media;

/// One omnibus set: a title, and the volumes of it that are on disk.
///
/// The volumes travel with the set rather than behind a second query. A set holds a
/// handful of books, so a page of them is on the order of a hundred rows — and carrying
/// them inline makes expanding a card pure client state, with no request and no loading
/// state for something the server already knows.
#[derive(Debug, SimpleObject)]
pub struct OmnibusSet {
	/// A stable identifier: `series:<id>` for a set that is a series, `title:<normalized>`
	/// for loose files grouped on their name.
	pub key: String,
	/// The set's display name. For a series-backed set this is the series name verbatim,
	/// matching what the Series tab shows.
	pub title: String,
	/// The series the volumes live in, when they live in one. Present even for a set keyed
	/// on its title, so the client can still link through to the series.
	pub series_id: Option<ID>,
	pub volume_count: i32,
	pub volumes: Vec<Media>,
	/// Whether the shelf this set came from was cut short by the qualifying-books ceiling.
	///
	/// Set on every returned set rather than reported once, because a paginated response
	/// has nowhere else to put it. It exists so an enormous library can say the shelf is
	/// partial instead of presenting an incomplete collection as the whole thing.
	pub truncated: bool,
}

impl OmnibusSet {
	pub fn from_data(data: OmnibusSetData, truncated: bool) -> Self {
		Self {
			key: data.key.as_id(),
			title: data.title,
			series_id: data.series_id.map(ID::from),
			volume_count: data.volumes.len() as i32,
			volumes: data.volumes.into_iter().map(Media::from).collect(),
			truncated,
		}
	}
}
