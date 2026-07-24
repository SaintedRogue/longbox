use async_graphql::{
	dataloader::DataLoader, ComplexObject, Context, Result, SimpleObject,
};

use crate::{
	data::AuthContext,
	loader::character::{CharacterMediaLoader, CharacterMediaLoaderKey},
	object::media::Media,
};

#[derive(Debug, SimpleObject)]
#[graphql(complex)]
pub struct Character {
	pub name: String,
	/// The number of books this character appears in, within the scope the character
	/// was queried in (e.g., a library). This is derived at query time from the
	/// `media_metadata.characters` CSV column, not a stored/denormalized value.
	pub book_count: Option<i64>,
	// Note: This is kinda a hack, I basically use this as a means of scoping down
	// when set. The idea is when querying through a library node, it will be set
	// to that library's ID. When querying characters at query root, it won't.
	#[graphql(skip)]
	pub library_id: Option<String>,
}

#[ComplexObject]
impl Character {
	async fn books(&self, ctx: &Context<'_>) -> Result<Vec<Media>> {
		let AuthContext { user, .. } = ctx.data::<AuthContext>()?;
		let loader = ctx.data::<DataLoader<CharacterMediaLoader>>()?;

		let key = CharacterMediaLoaderKey {
			character_name: self.name.clone(),
			library_id: self.library_id.clone(),
			user_id: user.id.clone(),
		};

		let media = loader.load_one(key).await?.unwrap_or_default();
		Ok(media)
	}
}
