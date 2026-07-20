use async_graphql::{Enum, SimpleObject};

use longbox_core::filesystem::organizer::confirm::OrganizeBucket as CoreBucket;
use longbox_core::filesystem::organizer::plan::{
	OrganizePlan, ProposedMove, UnmatchedFile,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Enum)]
pub enum OrganizeBucket {
	Confident,
	Ambiguous,
	Unmatched,
}

impl From<CoreBucket> for OrganizeBucket {
	fn from(value: CoreBucket) -> Self {
		match value {
			CoreBucket::Confident => OrganizeBucket::Confident,
			CoreBucket::Ambiguous => OrganizeBucket::Ambiguous,
			CoreBucket::Unmatched => OrganizeBucket::Unmatched,
		}
	}
}

#[derive(Debug, Clone, SimpleObject)]
pub struct OrganizeProposedMove {
	pub media_id: Option<String>,
	pub src: String,
	pub dst: String,
	pub canonical_name: String,
	pub year: Option<i32>,
	pub external_id: String,
	pub provider: String,
	pub confidence: f32,
	pub bucket: OrganizeBucket,
	pub existing_series_id: Option<String>,
}

impl From<ProposedMove> for OrganizeProposedMove {
	fn from(m: ProposedMove) -> Self {
		Self {
			media_id: m.media_id,
			src: m.src,
			dst: m.dst,
			canonical_name: m.canonical_name,
			year: m.year,
			external_id: m.external_id,
			provider: m.provider,
			confidence: m.confidence,
			bucket: m.bucket.into(),
			existing_series_id: m.existing_series_id,
		}
	}
}

#[derive(Debug, Clone, SimpleObject)]
pub struct OrganizeUnmatchedFile {
	pub media_id: Option<String>,
	pub src: String,
	pub parsed_series: Option<String>,
	pub reason: String,
}

impl From<UnmatchedFile> for OrganizeUnmatchedFile {
	fn from(u: UnmatchedFile) -> Self {
		Self {
			media_id: u.media_id,
			src: u.src,
			parsed_series: u.parsed_series,
			reason: u.reason,
		}
	}
}

#[derive(Debug, Clone, SimpleObject)]
pub struct OrganizePreview {
	pub proposed_moves: Vec<OrganizeProposedMove>,
	pub unmatched: Vec<OrganizeUnmatchedFile>,
}

impl From<OrganizePlan> for OrganizePreview {
	fn from(plan: OrganizePlan) -> Self {
		Self {
			proposed_moves: plan.proposed_moves.into_iter().map(Into::into).collect(),
			unmatched: plan.unmatched.into_iter().map(Into::into).collect(),
		}
	}
}
