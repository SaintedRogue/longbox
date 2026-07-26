use async_graphql::{Context, Object, Result, ID};
use chrono::Utc;
use longbox_core::{
	filesystem::{
		canonical_path_within,
		image::{generate_book_thumbnail, remove_thumbnails, GenerateThumbnailOptions},
		is_storage_root_available,
		media::analysis::{AnalysisJobConfig, MediaAnalysisJobScope},
		path_presence, PathPresence,
	},
	job::longbox_job::LongboxJob,
};
use models::{
	entity::{favorite_media, library, library_config, media, series},
	shared::{enums::UserPermission, image_processor_options::ImageProcessorOptions},
};
use sea_orm::{
	prelude::*,
	sea_query::{OnConflict, Query},
	IntoActiveModel, QuerySelect, Set,
};

use crate::{
	data::{AuthContext, CoreContext},
	guard::PermissionGuard,
	input::thumbnail::PageBasedThumbnailInput,
	object::media::Media,
};

#[derive(Default)]
pub struct MediaMutation;

#[Object]
impl MediaMutation {
	#[graphql(guard = "PermissionGuard::one(UserPermission::ManageLibrary)")]
	async fn analyze_media(
		&self,
		ctx: &Context<'_>,
		id: ID,
		#[graphql(default = false)] force_reanalysis: bool,
	) -> Result<bool> {
		let AuthContext { user, .. } = ctx.data::<AuthContext>()?;
		let core = ctx.data::<CoreContext>()?;
		let conn = core.conn.as_ref();

		let model = media::Entity::find_for_user(user)
			.select_only()
			.columns(vec![media::Column::Id, media::Column::Path])
			.filter(media::Column::Id.eq(id.to_string()))
			.into_model::<media::MediaIdentSelect>()
			.one(conn)
			.await?
			.ok_or("Media not found")?;

		core.enqueue(LongboxJob::analyze_media(AnalysisJobConfig {
			force_reanalysis,
			scope: MediaAnalysisJobScope::Book(model.id),
		}))
		.await?;

		Ok(true)
	}

	// TODO: Support converting other formats in the future
	#[graphql(guard = "PermissionGuard::one(UserPermission::ManageLibrary)")]
	async fn convert_media(&self, ctx: &Context<'_>, id: ID) -> Result<bool> {
		let AuthContext { user, .. } = ctx.data::<AuthContext>()?;
		let core = ctx.data::<CoreContext>()?;
		let conn = core.conn.as_ref();

		let _model = media::Entity::find_for_user(user)
			.select_only()
			.columns(vec![media::Column::Id, media::Column::Path])
			.filter(media::Column::Id.eq(id.to_string()))
			.into_model::<media::MediaIdentSelect>()
			.one(conn)
			.await?
			.ok_or("Media not found")?;

		// if media.extension != "cbr" || media.extension != "rar" {
		//     return Err(APIError::BadRequest(String::from(
		//         "Longbox only supports RAR to ZIP conversions at this time",
		//     )));
		// }

		Err("Not implemented".into())
	}

	/// Soft delete a book. The record is flagged as deleted and hidden from the library, but
	/// is kept in the database and the file on disk is untouched — this acts like a trash bin.
	/// See `deleteMediaPermanently` to remove a book for good.
	#[graphql(guard = "PermissionGuard::one(UserPermission::ManageLibrary)")]
	async fn delete_media(&self, ctx: &Context<'_>, id: ID) -> Result<Media> {
		let AuthContext { user, .. } = ctx.data::<AuthContext>()?;
		let core = ctx.data::<CoreContext>()?;
		let conn = core.conn.as_ref();

		let model = media::ModelWithMetadata::find_for_user(user)
			.filter(media::Column::Id.eq(id.to_string()))
			.into_model::<media::ModelWithMetadata>()
			.one(conn)
			.await?
			.ok_or("Media not found")?;
		let mut active_model = model.media.clone().into_active_model();
		active_model.deleted_at = Set(Some(Utc::now().into()));
		let deleted_book = active_model.update(conn).await?;

		Ok(Media::from(media::ModelWithMetadata {
			media: deleted_book,
			..model
		}))
	}

	/// Permanently delete a book. Unlike `deleteMedia`, which is a reversible soft delete,
	/// this removes the database record and its thumbnails outright. When `deleteFile` is
	/// true the underlying file is also erased from disk. **This cannot be undone.**
	///
	/// The file is removed *before* the record: if the filesystem refuses, the mutation fails
	/// with the library still describing reality. The reverse order could leave a file on
	/// disk that no longer appears anywhere in Longbox.
	///
	/// A book whose file is already gone can always be removed, since that is the exact
	/// situation this exists to resolve.
	#[graphql(guard = "PermissionGuard::one(UserPermission::DeleteLibrary)")]
	async fn delete_media_permanently(
		&self,
		ctx: &Context<'_>,
		id: ID,
		#[graphql(default = false)] delete_file: bool,
	) -> Result<Media> {
		let AuthContext { user, .. } = ctx.data::<AuthContext>()?;
		let core = ctx.data::<CoreContext>()?;
		let conn = core.conn.as_ref();

		let model = media::ModelWithMetadata::find_for_user(user)
			.filter(media::Column::Id.eq(id.to_string()))
			.into_model::<media::ModelWithMetadata>()
			.one(conn)
			.await?
			.ok_or("Media not found")?;

		if delete_file {
			let series_id = model
				.media
				.series_id
				.clone()
				.ok_or("Book is not associated with a series")?;

			let library = library::Entity::find_for_user(user)
				.filter(
					library::Column::Id.in_subquery(
						Query::select()
							.column(series::Column::LibraryId)
							.from(series::Entity)
							.and_where(series::Column::Id.eq(series_id))
							.to_owned(),
					),
				)
				.into_model::<library::LibraryIdentSelect>()
				.one(conn)
				.await?
				.ok_or("Associated library for book not found")?;

			// Guard the whole operation on the library's storage being attached. Without
			// this, an unmounted share would make the book look already-deleted and we would
			// quietly drop a record for a file that still exists
			if !is_storage_root_available(&library.path).await {
				tracing::error!(
					library_path = ?library.path,
					book_id = ?model.media.id,
					"Refusing to delete a book while its library storage is unavailable"
				);
				return Err(
					"The library's storage is not available right now, so this book cannot be deleted"
						.into(),
				);
			}

			match path_presence(&model.media.path).await {
				// The ghost case: the file was removed outside of Longbox. There is nothing
				// to erase, and dropping the record below is precisely the fix
				PathPresence::Missing => {
					tracing::warn!(
						path = ?model.media.path,
						book_id = ?model.media.id,
						"Book file is already gone; removing the record only"
					);
				},
				PathPresence::Indeterminate => {
					return Err(
						"Could not determine whether this book's file still exists"
							.into(),
					);
				},
				PathPresence::Present => {
					// Security: `media.path` is untrusted. It is written by the scanner, but
					// also by the organizer and uploads, and a symlink or `..` segment could
					// have it resolve anywhere on the host. Nothing is removed unless it
					// provably resolves inside this book's own library
					let target = canonical_path_within(&library.path, &model.media.path)
						.await
						.map_err(|error| {
							tracing::error!(
								?error,
								path = ?model.media.path,
								library_path = ?library.path,
								book_id = ?model.media.id,
								"Refusing to delete a book file outside of its library"
							);
							async_graphql::Error::new(error.to_string())
						})?;

					// Operate on the verified path rather than the stored one
					let metadata = tokio::fs::metadata(&target).await?;
					if !metadata.is_file() {
						tracing::error!(
							?target,
							"Refusing to delete a book path that is not a file"
						);
						return Err("The book's path is not a file".into());
					}

					tokio::fs::remove_file(&target).await.map_err(|error| {
						tracing::error!(?error, ?target, "Failed to delete book file");
						async_graphql::Error::new(format!(
							"Failed to delete the file on disk: {error}"
						))
					})?;
					tracing::debug!(?target, "Deleted book file from disk");
				},
			}
		}

		model.media.clone().delete(conn).await?;

		if let Err(error) = remove_thumbnails(
			std::slice::from_ref(&model.media.id),
			&core.config.get_thumbnails_dir(),
		)
		.await
		{
			// The record is already gone, so a leftover thumbnail is cosmetic and not worth
			// failing the mutation over
			tracing::error!(?error, "Failed to remove thumbnails for deleted book");
		}

		// Note: We return the full node so the ID may be pulled to properly update the cache.
		// For obvious reasons, certain fields will error if accessed.
		Ok(Media::from(model))
	}

	async fn favorite_media(
		&self,
		ctx: &Context<'_>,
		id: ID,
		is_favorite: bool,
	) -> Result<Media> {
		let AuthContext { user, .. } = ctx.data::<AuthContext>()?;
		let core = ctx.data::<CoreContext>()?;
		let conn = core.conn.as_ref();

		let model = media::ModelWithMetadata::find_for_user(user)
			.filter(
				media::Column::Id
					.eq(id.to_string())
					.and(media::Column::DeletedAt.is_null()),
			)
			.into_model::<media::ModelWithMetadata>()
			.one(conn)
			.await?
			.ok_or("Media not found")?;

		if is_favorite {
			let last_insert_id =
				favorite_media::Entity::insert(favorite_media::ActiveModel {
					user_id: Set(user.id.clone()),
					media_id: Set(model.media.id.clone()),
					favorited_at: Set(DateTimeWithTimeZone::from(Utc::now())),
				})
				.on_conflict(OnConflict::new().do_nothing().to_owned())
				.exec(core.conn.as_ref())
				.await?
				.last_insert_id;
			tracing::debug!(?last_insert_id, "Added favorite media");
		} else {
			let affected_rows = favorite_media::Entity::delete_many()
				.filter(
					favorite_media::Column::UserId
						.eq(user.id.clone())
						.and(favorite_media::Column::MediaId.eq(model.media.id.clone())),
				)
				.exec(core.conn.as_ref())
				.await?
				.rows_affected;
			tracing::debug!(?affected_rows, "Removed favorite media");
		}

		Ok(model.into())
	}

	/// Update the thumbnail for a book. This will replace the existing thumbnail with the the one
	/// associated with the provided input (book). If the book does not have a thumbnail, one
	/// will be generated based on the library's thumbnail configuration.
	#[graphql(guard = "PermissionGuard::one(UserPermission::EditThumbnails)")]
	async fn update_media_thumbnail(
		&self,
		ctx: &Context<'_>,
		id: ID,
		input: PageBasedThumbnailInput,
	) -> Result<Media> {
		let core = ctx.data::<CoreContext>()?;
		let AuthContext { user, .. } = ctx.data::<AuthContext>()?;

		let book = media::ModelWithMetadata::find_for_user(user)
			.filter(media::Column::Id.eq(id.to_string()))
			.into_model::<media::ModelWithMetadata>()
			.one(core.conn.as_ref())
			.await?
			.ok_or("Book not found")?;

		let series_id = book
			.media
			.series_id
			.clone()
			.ok_or("Series ID not set on book")?;

		let (_library, config) = library::Entity::find_for_user(user)
			.filter(
				library::Column::Id.in_subquery(
					Query::select()
						.column(series::Column::LibraryId)
						.from(series::Entity)
						.and_where(series::Column::Id.eq(series_id))
						.to_owned(),
				),
			)
			.find_also_related(library_config::Entity)
			.one(core.conn.as_ref())
			.await?
			.ok_or("Associated library for book not found")?;

		let page = input.page();

		if book.media.extension == "epub" && page > 1 {
			return Err("Cannot set thumbnail from EPUB chapter".into());
		}

		// Note: `unwrap_or_default` here would mean "don't resize at all", i.e. store the
		// full-resolution page as the thumbnail. Libraries are created with a null
		// `thumbnail_config`, so that is the common case rather than the edge case.
		let image_options = config
			.ok_or("Library config not found")?
			.thumbnail_config
			.unwrap_or_else(ImageProcessorOptions::thumbnail_default)
			.with_page(page);

		let (_, path_buf, _) = generate_book_thumbnail(
			&book.media.clone().into(),
			core.conn.as_ref(),
			GenerateThumbnailOptions {
				image_options,
				core_config: core.config.as_ref().clone(),
				force_regen: true,
				filename: Some(id.to_string()),
			},
		)
		.await?;
		tracing::debug!(path = ?path_buf, "Generated book thumbnail");

		Ok(book.into())
	}
}
