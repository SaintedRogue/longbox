use async_graphql::{ComplexObject, SimpleObject};

use models::{entity::user_preferences, shared::arrangement::Arrangement};

#[derive(Debug, SimpleObject)]
#[graphql(complex)]
pub struct UserPreferences {
	#[graphql(flatten)]
	pub model: user_preferences::Model,
}

impl From<user_preferences::Model> for UserPreferences {
	fn from(entity: user_preferences::Model) -> Self {
		Self { model: entity }
	}
}

#[ComplexObject]
impl UserPreferences {
	async fn home_arrangement(&self) -> Arrangement {
		self.model
			.home_arrangement
			.clone()
			.unwrap_or(Arrangement::default_home())
	}

	/// A stored arrangement is reconciled against the current set of system
	/// sections on read, so a newly added one shows up for users who customised
	/// their navigation before it existed. Their order and visibility are kept.
	async fn navigation_arrangement(&self) -> Arrangement {
		self.model
			.navigation_arrangement
			.clone()
			.map(Arrangement::with_missing_system_sections)
			.unwrap_or(Arrangement::default_navigation())
	}
}
