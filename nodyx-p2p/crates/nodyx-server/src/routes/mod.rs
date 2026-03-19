pub mod auth;
pub mod directory;
pub mod forums;
pub mod notifications;
pub mod search;
pub mod users;

use axum::{middleware, Router};
use crate::state::AppState;

pub fn build(state: AppState) -> Router {
    Router::new()
        .nest("/api",    directory::router())
        .nest("/api/v1", search::router())
        .nest("/api/v1", auth::router())
        .nest("/api/v1", users::router())
        .nest("/api/v1", forums::router())
        .nest("/api/v1", notifications::router())
        .layer(middleware::from_fn_with_state(
            state.clone(),
            directory::subdomain_redirect,
        ))
        .with_state(state)
}
