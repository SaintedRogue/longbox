#[derive(Debug, Clone)]
pub struct SearchQuery {
	pub title: String,
	pub author: Option<String>,
	pub isbn: Option<String>,
	pub year: Option<i32>,
	pub limit: Option<u32>,
	// comic-issue matching signals
	pub series_name: Option<String>,
	pub number: Option<String>,
	pub publisher: Option<String>,
	pub series_year: Option<i32>,
	/// Known ComicVine issue ID (from media_metadata.comicvine_id, Stream C) —
	/// providers that can resolve it directly should skip fuzzy search.
	pub comicvine_id: Option<String>,
	/// Known Metron issue ID (from media_metadata.metron_id) — Metron resolves
	/// it directly, skipping both the cv_id bridge and fuzzy search.
	pub metron_id: Option<String>,
}

impl Default for SearchQuery {
	fn default() -> Self {
		Self {
			title: String::new(),
			author: None,
			isbn: None,
			year: None,
			limit: Some(10),
			series_name: None,
			number: None,
			publisher: None,
			series_year: None,
			comicvine_id: None,
			metron_id: None,
		}
	}
}
