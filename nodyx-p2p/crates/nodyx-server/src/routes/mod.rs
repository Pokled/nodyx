pub mod auth;
pub mod directory;
pub mod search;

use axum::{middleware, Router};
use crate::state::AppState;

pub fn build(state: AppState) -> Router {
    Router::new()
        .nest("/api", directory::router())
        .nest("/api/v1", search::router())
        .nest("/api/v1", auth::router())
        .layer(middleware::from_fn_with_state(
            state.clone(),
            directory::subdomain_redirect,
        ))
        .with_state(state)
}
