pub mod http_proxy;
pub mod registry;
pub mod tcp_listener;

use std::sync::Arc;
use tracing::info;

use registry::Registry;

pub async fn run(tcp_port: u16, http_port: u16, database_url: &str, main_slug: &str) -> anyhow::Result<()> {
    info!("Starting nexus-relay server");
    info!("  TCP relay port  : {tcp_port}");
    info!("  HTTP proxy port : {http_port}");
    info!("  Main slug       : {main_slug}");

    // Connect to PostgreSQL.
    let (pg_client, pg_conn) = tokio_postgres::connect(database_url, tokio_postgres::NoTls).await?;
    let pg = Arc::new(pg_client);

    // Spawn a task to drive the DB connection.
    tokio::spawn(async move {
        if let Err(e) = pg_conn.await {
            tracing::error!("PostgreSQL connection error: {e}");
        }
    });

    let registry = Registry::new();

    let tcp_bind = format!("0.0.0.0:{tcp_port}");
    let http_bind = format!("127.0.0.1:{http_port}");
    let main_slug = main_slug.to_owned();

    // Run TCP listener and HTTP proxy concurrently.
    tokio::try_join!(
        tcp_listener::run(&tcp_bind, registry.clone(), pg.clone()),
        http_proxy::run(&http_bind, registry.clone(), pg.clone(), main_slug),
    )?;

    Ok(())
}
