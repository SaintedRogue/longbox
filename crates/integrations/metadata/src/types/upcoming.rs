/// One provider-reported issue inside a release window — the raw material for
/// the release-calendar oracle.
///
/// Provider-agnostic, and deliberately *not* conditional on the library: core stores every
/// release a provider reports, and binds the ones it recognises to a series by matching
/// [`Self::series_external_id`] against stored external ids. A release that matches nothing
/// is still kept, because "what is coming out" is a useful answer on its own — you cannot
/// discover a series you do not already own from a calendar that only shows what you do.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UpcomingRelease {
	/// The provider's id for the *series/volume* this issue belongs to, when it reported
	/// one. `None` is common and not an error: LOCG's week views name the series without
	/// identifying it, and resolving each one costs a page fetch it caps per sweep.
	pub series_external_id: Option<String>,
	/// The provider's name for the series, used to label a release that isn't bound to a
	/// library series. Without it an unmatched release has nothing to display.
	pub series_name: Option<String>,
	/// The provider's id for the issue itself.
	pub external_id: String,
	pub number: Option<String>,
	pub title: Option<String>,
	pub cover_url: Option<String>,
	/// ISO `YYYY-MM-DD`; `None` when the provider hasn't dated the issue.
	pub release_date: Option<String>,
}
