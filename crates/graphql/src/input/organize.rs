use async_graphql::InputObject;

use longbox_core::filesystem::organizer::apply::{DecisionAction, OrganizeDecision};

#[derive(Debug, Clone, InputObject)]
pub struct OrganizeDecisionInput {
	/// Absolute source path of the file to organize.
	pub src: String,
	/// When true, skip this file (leave it in place).
	#[graphql(default)]
	pub skip: bool,
	/// Existing series to merge into (optional).
	pub series_id: Option<String>,
	pub canonical_name: Option<String>,
	pub year: Option<i32>,
	pub external_id: Option<String>,
	pub provider: Option<String>,
}

impl From<OrganizeDecisionInput> for OrganizeDecision {
	fn from(input: OrganizeDecisionInput) -> Self {
		let action = if input.skip {
			DecisionAction::Skip
		} else {
			DecisionAction::Move {
				series_id: input.series_id,
				canonical_name: input.canonical_name.unwrap_or_default(),
				year: input.year,
				external_id: input.external_id,
				provider: input.provider,
			}
		};
		OrganizeDecision {
			src: input.src,
			action,
		}
	}
}
