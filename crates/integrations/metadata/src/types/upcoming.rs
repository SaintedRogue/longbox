/// One provider-reported issue inside a release window — the raw material for
/// the release-calendar oracle. Provider-agnostic: series linkage happens in
/// core by matching `series_external_id` against stored external ids, and
/// unmatched releases are simply dropped.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UpcomingRelease {
	/// The provider's id for the *series/volume* this issue belongs to.
	pub series_external_id: String,
	/// The provider's id for the issue itself.
	pub external_id: String,
	pub number: Option<String>,
	pub title: Option<String>,
	pub cover_url: Option<String>,
	/// ISO `YYYY-MM-DD`; `None` when the provider hasn't dated the issue.
	pub release_date: Option<String>,
}
