pub(crate) mod auth;
pub(crate) mod emoji;
pub(crate) mod epub;
pub(crate) mod library;
pub(crate) mod media;
mod oidc;
mod series;
mod user;

use axum::{
	extract::State,
	routing::{get, post},
	Json, Router,
};
use models::entity;
use sea_orm::prelude::*;
use serde::{Deserialize, Serialize};

use crate::{config::state::AppState, errors::APIResult};

pub(crate) fn mount(app_state: AppState) -> Router<AppState> {
	Router::new()
		.merge(auth::mount(app_state.clone()))
		.merge(oidc::mount())
		.merge(emoji::mount(app_state.clone()))
		.merge(media::mount(app_state.clone()))
		.merge(epub::mount(app_state.clone()))
		.merge(series::mount(app_state.clone()))
		.merge(library::mount(app_state.clone()))
		.merge(user::mount(app_state))
		.route("/claim", get(claim))
		.route("/ping", get(ping))
		.route("/version", post(version))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaimResponse {
	pub is_claimed: bool,
}

async fn claim(State(ctx): State<AppState>) -> APIResult<Json<ClaimResponse>> {
	let is_claimed = entity::user::Entity::find()
		.count(ctx.conn.as_ref())
		.await?
		> 0;

	Ok(Json(ClaimResponse { is_claimed }))
}

async fn ping() -> APIResult<String> {
	Ok("pong".to_string())
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LongboxVersion {
	pub semver: String,
	// E.g., nightly, experimental, unstable, etc.
	pub build_channel: Option<String>,
	pub rev: String,
	pub compile_time: String,
}

async fn version() -> APIResult<Json<LongboxVersion>> {
	Ok(Json(LongboxVersion {
		semver: env!("CARGO_PKG_VERSION").to_string(),
		build_channel: option_env!("BUILD_CHANNEL").map(|s| s.to_string()),
		rev: env!("GIT_REV").to_string(),
		compile_time: env!("STATIC_BUILD_DATE").to_string(),
	}))
}
