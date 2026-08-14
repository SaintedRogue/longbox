use std::sync::Arc;

use axum::{
	extract::{Path, Query as AxumQuery, State},
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
		image::{
			generate_book_thumbnail, page_preview, thumbnail_variant,
			GenerateThumbnailOptions,
		},
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
	utils::{
		http::{ImageCachePolicy, ImageResponse},
		serve_media,
	},
};

/// Optional sizing for thumbnail routes: `?width=` restricted to
/// [`longbox_core::filesystem::image::THUMBNAIL_VARIANT_WIDTHS`]. Anything else
/// serves the full thumbnail unchanged.
#[derive(serde::Deserialize)]
pub(crate) struct ThumbnailQuery {
	pub width: Option<u32>,
}

/// Optional sizing for the reader page route: `?width=` restricted to the same
/// [`longbox_core::filesystem::image::THUMBNAIL_VARIANT_WIDTHS`] whitelist. Anything else serves
/// the full-resolution page unchanged.
///
/// This exists for the reader's page-preview strip, which paints ~100 CSS px wide thumbnails: it
/// was fetching the untouched source page for each one, i.e. megabytes of 2000x3000 JPEG per
/// preview, decoded on the main thread and thrown away at 5% scale.
#[derive(serde::Deserialize)]
struct PageQuery {
	/// Kept as a string and parsed by [`PageQuery::preview_width`] rather than typed as
	/// `Option<u32>`: a typed field makes axum reject the *whole request* with a 400 when the
	/// value doesn't parse, so `?width=abc` would fail a page request that used to succeed (this
	/// route ignored every query string before). "Anything else serves the full page" should hold
	/// for malformed input too, not just for well-formed integers outside the whitelist.
	width: Option<String>,
}

impl PageQuery {
	fn preview_width(&self) -> Option<u32> {
		self.width.as_deref().and_then(|width| width.parse().ok())
	}
}

/// Swap a thumbnail response for its width variant when one was requested and
/// can be (or already is) derived. Failure stand-ins are never resized — they
/// must stay no-store and be retried, not cached under a variant name.
pub(crate) async fn apply_thumbnail_variant(
	ctx: &Ctx,
	entity_id: &str,
	width: Option<u32>,
	response: ImageResponse,
) -> ImageResponse {
	let Some(width) = width else {
		return response;
	};
	if response.policy != ImageCachePolicy::Derived {
		return response;
	}
	match thumbnail_variant(
		&ctx.config.get_thumbnails_dir(),
		entity_id,
		width,
		&response.data,
	)
	.await
	{
		Some(bytes) => ImageResponse::new(ContentType::WEBP, bytes),
		None => response,
	}
}

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
	AxumQuery(params): AxumQuery<ThumbnailQuery>,
) -> APIResult<ImageResponse> {
	let response = get_media_thumbnail_by_id(&ctx, &req.user(), id.clone()).await?;
	Ok(apply_thumbnail_variant(&ctx, &id, params.width, response).await)
}

async fn get_media_page(
	Path((id, page)): Path<(String, u32)>,
	State(ctx): State<AppState>,
	Extension(req): Extension<AuthContext>,
	AxumQuery(params): AxumQuery<PageQuery>,
) -> APIResult<ImageResponse> {
	let book = media::Entity::find_for_user(&req.user())
		.filter(media::Column::Id.eq(id.clone()))
		.into_model::<media::MediaIdentSelect>()
		.one(ctx.conn.as_ref())
		.await?
		.ok_or(APIError::NotFound("Book not found".to_string()))?;

	let preview_width = params.preview_width();

	// A preview is a few hundred pixels wide, so rendering a PDF's neighbouring pages to produce
	// one is pure waste -- the same reasoning `get_media_thumbnail` uses for its own adjusted config.
	let config = match preview_width {
		Some(_) => Arc::new(LongboxConfig {
			pdf_prerender_range: 0,
			..ctx.config.as_ref().clone()
		}),
		None => ctx.config.clone(),
	};

	let (content_type, bytes) =
		match get_page_async(&book.path, page.try_into()?, config.as_ref()).await {
			Ok(result) => result,
			Err(e) => {
				if matches!(e, FileError::NoImageError) {
					return Err(APIError::NotFound("Page not found".to_string()));
				}
				return Err(APIError::InternalServerError(e.to_string()));
			},
		};

	let (content_type, bytes) = match preview_width {
		Some(width) => match page_preview(&bytes, width).await {
			Some(preview) => (ContentType::WEBP, preview),
			None => (content_type, bytes),
		},
		None => (content_type, bytes),
	};

	// The book file is the true source of a page, so its mtime is a valid `Last-Modified`. That
	// holds for a preview too: it is a pure function of the same file, page and requested width.
	Ok(ImageResponse::source_page(content_type, bytes)
		.with_source_file(&book.path)
		.await)
}

#[cfg(test)]
mod page_query_tests {
	use super::PageQuery;

	fn query(width: Option<&str>) -> PageQuery {
		PageQuery {
			width: width.map(str::to_string),
		}
	}

	#[test]
	fn parses_a_numeric_width() {
		assert_eq!(query(Some("320")).preview_width(), Some(320));
	}

	#[test]
	fn treats_no_width_as_a_full_page_request() {
		assert_eq!(query(None).preview_width(), None);
	}

	/// A malformed width must degrade to "serve the full page", not fail the request. Typing the
	/// field as `Option<u32>` would make axum reject the whole request with a 400 instead -- and
	/// this route served every one of these fine before it took a query at all.
	#[test]
	fn treats_a_malformed_width_as_absent() {
		for width in ["", "abc", "-1", "320px", "1.5"] {
			assert_eq!(query(Some(width)).preview_width(), None, "width={width:?}");
		}
	}
}
