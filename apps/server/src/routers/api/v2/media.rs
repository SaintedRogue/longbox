use axum::{
	extract::{Path, State},
	http::HeaderMap,
	middleware,
	response::IntoResponse,
	routing::get,
	Extension, Router,
};
use graphql::data::AuthContext;
use longbox_core::{
	config::LongboxConfig,
	filesystem::{
		get_saved_thumbnail, get_thumbnail,
		image::{generate_book_thumbnail, GenerateThumbnailOptions},
		media::get_page_async,
		ContentType, FileError,
	},
	Ctx,
};
use models::{
	entity::{library, library_config, media, series, user::AuthUser},
	shared::image_processor_options::ImageProcessorOptions,
};
use sea_orm::{prelude::*, sea_query::Query, QuerySelect};

use crate::{
	config::state::AppState,
	errors::{APIError, APIResult},
	middleware::auth::auth_middleware,
	utils::{http::ImageResponse, serve_media},
};

pub(crate) fn mount(app_state: AppState) -> Router<AppState> {
	Router::new()
		.nest(
			"/media/{id}",
			Router::new()
				.route("/thumbnail", get(get_media_thumbnail_handler))
				.route("/page/{page}", get(get_media_page))
				.route("/file", get(get_media_file)),
		)
		.layer(middleware::from_fn_with_state(app_state, auth_middleware))
}

/// Download the file associated with the media.
pub(crate) async fn get_media_file(
	Path(id): Path<String>,
	State(ctx): State<AppState>,
	Extension(req): Extension<AuthContext>,
	headers: HeaderMap,
) -> APIResult<impl IntoResponse> {
	serve_media::serve_media_file(req, headers, ctx.conn.as_ref(), id).await
}

pub(crate) async fn get_media_thumbnail(
	book: &media::MediaThumbSelect,
	image_options: Option<ImageProcessorOptions>,
	config: &LongboxConfig,
	conn: &DatabaseConnection,
) -> APIResult<ImageResponse> {
	// Note: This doesn't hard-fail because if the saved thumbnail is missing or corrupt, we want
	// to just pull something else instead of erroring out entirely.
	if let Some(path) = &book.thumbnail_path {
		match get_saved_thumbnail(std::path::Path::new(path)).await {
			Ok(result) => {
				return Ok(ImageResponse::from(result).with_source_file(path).await)
			},
			Err(_) => {
				tracing::warn!(path = ?path, "Failed to get saved thumbnail");
			},
		}
	}

	// The book has no thumbnail on disk yet and its library never configured thumbnail
	// generation. Without a real fallback we would serve (and re-decode, on every single
	// request) the full-resolution source page as the "thumbnail".
	let image_options =
		image_options.unwrap_or_else(ImageProcessorOptions::thumbnail_default);

	let generated_thumb = get_thumbnail(
		config.get_thumbnails_dir(),
		&book.id,
		Some(image_options.format),
	)
	.await?;

	if let Some((content_type, bytes)) = generated_thumb {
		return Ok(ImageResponse::new(content_type, bytes));
	}

	let adjusted_config = LongboxConfig {
		pdf_prerender_range: 0, // Disable PDF prerendering for thumbnails since we only need the first page
		..config.clone()
	};

	// No cached thumbnail exists on disk yet -- generate and persist a real one now (same
	// generation path the batch job uses) so every request after this one is served from disk
	// instead of re-decoding the full source page on every single view.
	let generate_options = GenerateThumbnailOptions {
		image_options: image_options.clone(),
		core_config: adjusted_config.clone(),
		force_regen: false,
		filename: None,
	};
	match generate_book_thumbnail(book, conn, generate_options).await {
		Ok((bytes, ..)) => Ok(ImageResponse::new(
			ContentType::from(image_options.format),
			bytes,
		)),
		Err(error) => {
			tracing::warn!(
				?error,
				book_id = %book.id,
				"Failed to self-heal missing thumbnail; falling back to raw page"
			);
			// A failure stand-in: no-store, so the next request retries the real
			// thumbnail instead of this fallback being cached for its max-age.
			let (content_type, bytes) =
				get_page_async(&book.path, 1, &adjusted_config).await?;
			Ok(ImageResponse::uncacheable(content_type, bytes))
		},
	}
}

pub(crate) async fn get_media_thumbnail_by_id(
	ctx: &Ctx,
	user: &AuthUser,
	book_id: String,
) -> APIResult<ImageResponse> {
	let book = media::Entity::find_for_user(user)
		.columns(media::MediaThumbSelect::columns())
		.filter(media::Column::Id.eq(book_id))
		.into_model::<media::MediaThumbSelect>()
		.one(ctx.conn.as_ref())
		.await?
		.ok_or(APIError::NotFound("Book not found".to_string()))?;

	// Note: This doesn't hard-fail because if the saved thumbnail is missing or corrupt, we want
	// to just pull something else instead of erroring out entirely.
	if let Some(path) = &book.thumbnail_path {
		match get_saved_thumbnail(std::path::Path::new(path)).await {
			Ok(result) => {
				return Ok(ImageResponse::from(result).with_source_file(path).await)
			},
			Err(_) => {
				tracing::warn!(path = ?path, "Failed to get saved thumbnail");
			},
		}
	}

	let library_config = library_config::Entity::find()
		.filter(
			library_config::Column::LibraryId.in_subquery(
				Query::select()
					.column(library::Column::Id)
					.from(library::Entity)
					.and_where(
						library::Column::Id.in_subquery(
							Query::select()
								.column(series::Column::LibraryId)
								.from(series::Entity)
								.and_where(series::Column::Id.eq(book.series_id.clone()))
								.to_owned(),
						),
					)
					.to_owned(),
			),
		)
		.one(ctx.conn.as_ref())
		.await?;
	let image_options = library_config.and_then(|o| o.thumbnail_config);

	get_media_thumbnail(&book, image_options, ctx.config.as_ref(), ctx.conn.as_ref())
		.await
}

pub(crate) async fn get_media_thumbnail_handler(
	Path(id): Path<String>,
	State(ctx): State<AppState>,
	Extension(req): Extension<AuthContext>,
) -> APIResult<ImageResponse> {
	get_media_thumbnail_by_id(&ctx, &req.user(), id).await
}

async fn get_media_page(
	Path((id, page)): Path<(String, u32)>,
	State(ctx): State<AppState>,
	Extension(req): Extension<AuthContext>,
) -> APIResult<ImageResponse> {
	let book = media::Entity::find_for_user(&req.user())
		.filter(media::Column::Id.eq(id.clone()))
		.into_model::<media::MediaIdentSelect>()
		.one(ctx.conn.as_ref())
		.await?
		.ok_or(APIError::NotFound("Book not found".to_string()))?;

	let (content_type, bytes) =
		match get_page_async(&book.path, page.try_into()?, ctx.config.as_ref()).await {
			Ok(result) => result,
			Err(e) => {
				if matches!(e, FileError::NoImageError) {
					return Err(APIError::NotFound("Page not found".to_string()));
				}
				return Err(APIError::InternalServerError(e.to_string()));
			},
		};

	// The book file is the true source of a page, so its mtime is a valid `Last-Modified`
	Ok(ImageResponse::source_page(content_type, bytes)
		.with_source_file(&book.path)
		.await)
}
