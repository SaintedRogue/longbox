use axum::Router;

use crate::{config::state::AppState, middleware::cache::conditional_get};

mod api;
mod kobo;
mod koreader;
mod opds;
mod spa;

pub(crate) use api::v2::auth::enforce_max_sessions;
pub(crate) use spa::relative_favicon_path;

pub async fn mount(app_state: AppState) -> Router<AppState> {
	let mut app_router = Router::new();

	if app_state.config.enable_koreader_sync {
		app_router = app_router.merge(koreader::mount(app_state.clone()));
	}

	if app_state.config.enable_kobo_sync {
		app_router = app_router.merge(kobo::mount(app_state.clone()));
	}

	app_router
		.merge(spa::mount(app_state.clone()))
		.merge(api::mount(app_state.clone()).await)
		.merge(opds::mount(app_state))
		// Applied to everything, but a no-op for any response that doesn't carry an `ETag`
		.layer(axum::middleware::from_fn(conditional_get))
}
