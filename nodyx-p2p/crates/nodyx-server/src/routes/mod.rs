pub mod directory;

use axum::{middleware, Router};
use crate::state::AppState;

pub fn build(state: AppState) -> Router {
    Router::new()
        .nest("/api", directory::router())
        .layer(middleware::from_fn_with_state(
            state.clone(),
            directory::subdomain_redirect,
        ))
        .with_state(state)
}
