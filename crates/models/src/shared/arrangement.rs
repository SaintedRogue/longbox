use async_graphql::{Enum, InputObject, Json, OneofObject, SimpleObject, Union};
use sea_orm::{prelude::*, DeriveActiveEnum, EnumIter, FromJsonQueryResult};
use serde::{Deserialize, Serialize};
use strum::{Display, EnumString};

fn default_true() -> bool {
	true
}

#[derive(
	Eq,
	Copy,
	Hash,
	Debug,
	Clone,
	EnumIter,
	PartialEq,
	DeriveActiveEnum,
	Enum,
	EnumString,
	Display,
	Serialize,
	Deserialize,
)]
#[sea_orm(
	rs_type = "String",
	rename_all = "SCREAMING_SNAKE_CASE",
	db_type = "String(StringLen::None)"
)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[strum(serialize_all = "SCREAMING_SNAKE_CASE")]
pub enum SystemArrangement {
	Home,
	Explore,
	Series,
	Libraries,
	SmartLists,
	BookClubs,
}

impl SystemArrangement {
	/// The quick-action links a section carries when it is first created.
	///
	/// Only the variants you can create something in get one - there is no
	/// "create a series", they come from scanning a library.
	pub fn default_links(&self) -> Vec<FilterableArrangementEntityLink> {
		match self {
			SystemArrangement::Libraries
			| SystemArrangement::SmartLists
			| SystemArrangement::BookClubs => {
				vec![FilterableArrangementEntityLink::Create]
			},
			SystemArrangement::Home
			| SystemArrangement::Explore
			| SystemArrangement::Series => vec![],
		}
	}
}

#[derive(
	Debug, Clone, PartialEq, Eq, Serialize, Deserialize, SimpleObject, InputObject,
)]
#[graphql(input_name = "SystemArrangementConfigInput")]
pub struct SystemArrangementConfig {
	variant: SystemArrangement,
	#[graphql(default)]
	links: Vec<FilterableArrangementEntityLink>,
}

#[derive(
	Eq,
	Copy,
	Default,
	Hash,
	Debug,
	Clone,
	EnumIter,
	PartialEq,
	DeriveActiveEnum,
	Enum,
	EnumString,
	Display,
	Serialize,
	Deserialize,
)]
#[sea_orm(
	rs_type = "String",
	rename_all = "SCREAMING_SNAKE_CASE",
	db_type = "String(StringLen::None)"
)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[strum(serialize_all = "SCREAMING_SNAKE_CASE")]
pub enum FilterableArrangementEntity {
	#[default]
	Books,
	Libraries,
	Series,
	SmartLists,
	BookClubs,
}

// TODO: Rename since I am now using this for both home and navigation arrangements.
#[derive(
	Eq,
	Copy,
	Hash,
	Debug,
	Clone,
	EnumIter,
	PartialEq,
	DeriveActiveEnum,
	Enum,
	EnumString,
	Display,
	Serialize,
	Deserialize,
)]
#[sea_orm(
	rs_type = "String",
	rename_all = "SCREAMING_SNAKE_CASE",
	db_type = "String(StringLen::None)"
)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[strum(serialize_all = "SCREAMING_SNAKE_CASE")]
pub enum FilterableArrangementEntityLink {
	Create,
	ShowAll,
}

#[derive(
	Debug,
	Clone,
	Default,
	PartialEq,
	Eq,
	Serialize,
	Deserialize,
	SimpleObject,
	InputObject,
)]
#[graphql(input_name = "FilterableArrangementEntityLinkInput")]
pub struct CustomArrangementConfig {
	entity: FilterableArrangementEntity,
	name: Option<String>,
	// TODO(custom-arrangement): Support typed filters
	filter: Option<Json<serde_json::Value>>,
	order_by: Option<String>,
	#[graphql(default)]
	links: Vec<FilterableArrangementEntityLink>,
}

#[derive(
	Debug,
	Clone,
	Default,
	PartialEq,
	Eq,
	Serialize,
	Deserialize,
	SimpleObject,
	InputObject,
)]
#[graphql(input_name = "InProgressBooksInput")]
pub struct InProgressBooks {
	name: Option<String>,
	// filter: Option<Json<serde_json::Value>>,
	#[graphql(default)]
	links: Vec<FilterableArrangementEntityLink>,
}

#[derive(
	Debug,
	Clone,
	Default,
	PartialEq,
	Eq,
	Serialize,
	Deserialize,
	SimpleObject,
	InputObject,
)]
#[graphql(input_name = "RecentlyAddedInput")]
pub struct RecentlyAdded {
	entity: FilterableArrangementEntity,
	name: Option<String>,
	// filter: Option<Json<serde_json::Value>>,
	#[graphql(default)]
	links: Vec<FilterableArrangementEntityLink>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Union, OneofObject)]
#[graphql(input_name = "ArrangementConfigInput")]
#[serde(untagged)]
pub enum ArrangementConfig {
	System(SystemArrangementConfig),
	InProgressBooks(InProgressBooks),
	RecentlyAdded(RecentlyAdded),
	Custom(CustomArrangementConfig),
}

#[derive(
	Debug, Clone, PartialEq, Eq, Serialize, Deserialize, SimpleObject, InputObject,
)]
#[graphql(input_name = "ArrangementSectionInput")]
pub struct ArrangementSection {
	config: ArrangementConfig,
	#[serde(default = "default_true")]
	#[graphql(default_with = "default_true()")]
	visible: bool,
}

// TODO(graphql): There is enough distinction between sidebar/navigation and home arrangements that they should just be separate types.
// I'll aim to tackle this one I am closer to the end of the migration, as it is not the most important thing right now.

#[derive(
	Debug, Clone, SimpleObject, PartialEq, Eq, Serialize, Deserialize, FromJsonQueryResult,
)]
pub struct Arrangement {
	pub locked: bool,
	pub sections: Vec<ArrangementSection>,
}

impl Arrangement {
	pub fn default_home() -> Arrangement {
		Arrangement {
			locked: true,
			sections: vec![
				ArrangementSection {
					config: ArrangementConfig::InProgressBooks(InProgressBooks::default()),
					visible: true,
				},
				ArrangementSection {
					config: ArrangementConfig::RecentlyAdded(RecentlyAdded {
						entity: FilterableArrangementEntity::Books,
						..Default::default()
					}),
					visible: true,
				},
				ArrangementSection {
					config: ArrangementConfig::RecentlyAdded(RecentlyAdded {
						entity: FilterableArrangementEntity::Series,
						..Default::default()
					}),
					visible: true,
				},
			],
		}
	}

	pub fn default_navigation() -> Arrangement {
		Arrangement {
			locked: true,
			sections: vec![
				ArrangementSection {
					config: ArrangementConfig::System(SystemArrangementConfig {
						variant: SystemArrangement::Home,
						links: vec![],
					}),
					visible: true,
				},
				ArrangementSection {
					config: ArrangementConfig::System(SystemArrangementConfig {
						variant: SystemArrangement::Explore,
						links: vec![],
					}),
					visible: true,
				},
				ArrangementSection {
					config: ArrangementConfig::System(SystemArrangementConfig {
						variant: SystemArrangement::Series,
						links: vec![],
					}),
					visible: true,
				},
				ArrangementSection {
					config: ArrangementConfig::System(SystemArrangementConfig {
						variant: SystemArrangement::Libraries,
						links: vec![FilterableArrangementEntityLink::Create],
					}),
					visible: true,
				},
				ArrangementSection {
					config: ArrangementConfig::System(SystemArrangementConfig {
						variant: SystemArrangement::SmartLists,
						links: vec![FilterableArrangementEntityLink::Create],
					}),
					visible: true,
				},
				ArrangementSection {
					config: ArrangementConfig::System(SystemArrangementConfig {
						variant: SystemArrangement::BookClubs,
						links: vec![FilterableArrangementEntityLink::Create],
					}),
					visible: true,
				},
			],
		}
	}

	/// Append any system sections this arrangement has never heard of.
	///
	/// A user's navigation arrangement is persisted the moment they reorder or
	/// hide anything, which freezes the set of sections they had at the time.
	/// Adding a `SystemArrangement` variant would otherwise be invisible to every
	/// existing user forever - their stored JSON simply has no entry for it.
	///
	/// New sections are appended rather than inserted at their default position:
	/// the stored order is a deliberate choice by the user, and shuffling it to
	/// match a new default would be a worse surprise than a new item at the end.
	/// Existing sections keep their order, visibility and links untouched.
	pub fn with_missing_system_sections(mut self) -> Arrangement {
		// sea-orm's `Iterable`, not strum's `IntoEnumIterator`: the `EnumIter`
		// derive on `SystemArrangement` comes from sea-orm, and there is more than
		// one strum version in the dependency graph.
		use sea_orm::Iterable;

		let present = self
			.sections
			.iter()
			.filter_map(|section| match &section.config {
				ArrangementConfig::System(config) => Some(config.variant),
				_ => None,
			})
			.collect::<std::collections::HashSet<_>>();

		for variant in SystemArrangement::iter() {
			if !present.contains(&variant) {
				self.sections.push(ArrangementSection {
					config: ArrangementConfig::System(SystemArrangementConfig {
						variant,
						links: variant.default_links(),
					}),
					visible: true,
				});
			}
		}

		self
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	fn system_section(
		variant: SystemArrangement,
		visible: bool,
		links: Vec<FilterableArrangementEntityLink>,
	) -> ArrangementSection {
		ArrangementSection {
			config: ArrangementConfig::System(SystemArrangementConfig { variant, links }),
			visible,
		}
	}

	fn variants_of(arrangement: &Arrangement) -> Vec<SystemArrangement> {
		arrangement
			.sections
			.iter()
			.filter_map(|section| match &section.config {
				ArrangementConfig::System(config) => Some(config.variant),
				_ => None,
			})
			.collect()
	}

	/// The case that motivated this: a user customised their navigation before
	/// `Series` existed, so their stored arrangement has no entry for it and
	/// would never grow one.
	#[test]
	fn test_missing_system_section_is_appended() {
		let stored = Arrangement {
			locked: false,
			sections: vec![
				system_section(SystemArrangement::Libraries, true, vec![]),
				system_section(SystemArrangement::Home, true, vec![]),
			],
		};

		let reconciled = stored.with_missing_system_sections();
		let variants = variants_of(&reconciled);

		// The user's own order survives - Libraries before Home, not the default.
		assert_eq!(variants[0], SystemArrangement::Libraries);
		assert_eq!(variants[1], SystemArrangement::Home);
		assert!(variants.contains(&SystemArrangement::Series));
		assert!(variants.contains(&SystemArrangement::BookClubs));
	}

	#[test]
	fn test_reconciliation_preserves_visibility_and_links() {
		let stored = Arrangement {
			locked: false,
			sections: vec![
				// Deliberately hidden, and stripped of its create link.
				system_section(SystemArrangement::BookClubs, false, vec![]),
			],
		};

		let reconciled = stored.with_missing_system_sections();
		let book_clubs = reconciled
			.sections
			.iter()
			.find(|section| match &section.config {
				ArrangementConfig::System(c) => c.variant == SystemArrangement::BookClubs,
				_ => false,
			})
			.expect("book clubs section missing");

		assert!(!book_clubs.visible, "a hidden section must stay hidden");
		match &book_clubs.config {
			ArrangementConfig::System(c) => assert!(
				c.links.is_empty(),
				"reconciliation must not re-add links the user removed"
			),
			_ => panic!("expected a system section"),
		}
	}

	#[test]
	fn test_reconciliation_is_idempotent() {
		let once = Arrangement::default_navigation().with_missing_system_sections();
		let twice = once.clone().with_missing_system_sections();

		assert_eq!(
			once.sections.len(),
			twice.sections.len(),
			"running twice must not duplicate sections"
		);
	}

	/// Newly added variants carry the links they would have had by default, so a
	/// backfilled Libraries section still offers "create".
	#[test]
	fn test_backfilled_sections_get_their_default_links() {
		let stored = Arrangement {
			locked: false,
			sections: vec![system_section(SystemArrangement::Home, true, vec![])],
		};

		let reconciled = stored.with_missing_system_sections();
		let libraries = reconciled
			.sections
			.iter()
			.find(|section| match &section.config {
				ArrangementConfig::System(c) => c.variant == SystemArrangement::Libraries,
				_ => false,
			})
			.expect("libraries section missing");

		match &libraries.config {
			ArrangementConfig::System(c) => {
				assert_eq!(c.links, vec![FilterableArrangementEntityLink::Create])
			},
			_ => panic!("expected a system section"),
		}
	}
}
