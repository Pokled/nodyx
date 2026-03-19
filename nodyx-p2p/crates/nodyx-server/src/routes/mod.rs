pub mod admin;
pub mod auth;
pub mod communities;
pub mod directory;
pub mod forums;
pub mod notifications;
pub mod polls;
pub mod search;
pub mod tasks;
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
        .nest("/api/v1", polls::router())
        .nest("/api/v1", tasks::router())
        .nest("/api/v1", communities::router())
        .nest("/api/v1", admin::router())
        .layer(middleware::from_fn_with_state(
            state.clone(),
            directory::subdomain_redirect,
        ))
        .with_state(state)
}
