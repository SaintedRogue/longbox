use async_graphql::dataloader::Loader;
use models::entity::{media, media_metadata, user};
use sea_orm::prelude::*;
use std::{collections::HashMap, sync::Arc};

use crate::{
	object::media::Media,
	utils::{parse_comma_separated_list, series_in_library_subquery},
};

pub struct CharacterMediaLoader {
	conn: Arc<DatabaseConnection>,
}

impl CharacterMediaLoader {
	pub fn new(conn: Arc<DatabaseConnection>) -> Self {
		Self { conn }
	}
}

/// Key for loading media by character name, optionally scoped to a library and user
#[derive(Clone, PartialEq, Eq, Hash, Debug)]
pub struct CharacterMediaLoaderKey {
	pub character_name: String,
	pub library_id: Option<String>,
	pub user_id: String,
}

impl Loader<CharacterMediaLoaderKey> for CharacterMediaLoader {
	type Value = Vec<Media>;
	type Error = Arc<sea_orm::error::DbErr>;

	async fn load(
		&self,
		keys: &[CharacterMediaLoaderKey],
	) -> Result<HashMap<CharacterMediaLoaderKey, Self::Value>, Self::Error> {
		if keys.is_empty() {
			return Ok(HashMap::new());
		}

		let mut grouped: HashMap<(Option<String>, String), Vec<String>> = HashMap::new();
		for key in keys {
			grouped
				.entry((key.library_id.clone(), key.user_id.clone()))
				.or_default()
				.push(key.character_name.clone());
		}

		let mut result: HashMap<CharacterMediaLoaderKey, Vec<Media>> = HashMap::new();

		for key in keys {
			result.insert(key.clone(), Vec::new());
		}

		let mut user_map = HashMap::<String, user::AuthUser>::new();

		// Most likely there will only be one user per batch, so fetching in a loop would be pointlessly expensive
		let user_ids: Vec<String> =
			grouped.keys().map(|(_, user_id)| user_id.clone()).collect();

		let login_users = user::LoginUser::find()
			.filter(user::Column::Id.is_in(user_ids))
			.into_model::<user::LoginUser>()
			.all(self.conn.as_ref())
			.await?;

		for login_user in login_users {
			user_map
				.entry(login_user.id.clone())
				.or_insert(login_user.into());
		}

		for ((library_id, user_id), character_names) in grouped {
			let Some(auth_user) = user_map.get(&user_id) else {
				continue;
			};

			let mut query = media::ModelWithMetadata::find_for_user(auth_user)
				.filter(media_metadata::Column::Characters.is_not_null());

			if let Some(ref lib_id) = library_id {
				query = query.filter(
					media::Column::SeriesId
						.in_subquery(series_in_library_subquery(lib_id.clone())),
				);
			}

			let models = query
				.into_model::<media::ModelWithMetadata>()
				.all(self.conn.as_ref())
				.await?;

			let character_names_lower: HashMap<String, String> = character_names
				.iter()
				.map(|n| (n.to_lowercase(), n.clone()))
				.collect();

			for model in models {
				if let Some(ref metadata) = model.metadata {
					if let Some(ref characters) = metadata.characters {
						let media_characters = parse_comma_separated_list(characters);
						for character in &media_characters {
							let character_lower = character.to_lowercase();
							if let Some(original_name) =
								character_names_lower.get(&character_lower)
							{
								let key = CharacterMediaLoaderKey {
									character_name: original_name.clone(),
									library_id: library_id.clone(),
									user_id: user_id.clone(),
								};
								if let Some(media_list) = result.get_mut(&key) {
									media_list.push(Media::from(model.clone()));
								}
							}
						}
					}
				}
			}
		}

		Ok(result)
	}
}
