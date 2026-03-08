/// Auto-reconnecting PostgreSQL wrapper.
///
/// `tokio-postgres` uses a single long-lived connection. If PostgreSQL drops
/// the connection (idle timeout, restart, network blip), the `Client` becomes
/// permanently broken and every subsequent query fails.
///
/// This wrapper stores the database URL and retries the connection on every
/// failed query, so the relay server survives PostgreSQL restarts without
/// needing a manual `systemctl restart nexus-relay`.

use std::sync::Arc;
use tokio::sync::Mutex;
use tokio_postgres::{Client, NoTls, Row};
use tracing::{info, warn};

pub struct DbPool {
    database_url: String,
    client: Arc<Mutex<Option<Client>>>,
}

impl DbPool {
    /// Connect and return a pool. Fails if the initial connection fails.
    pub async fn connect(database_url: &str) -> anyhow::Result<Self> {
        let client = Self::new_connection(database_url).await?;
        Ok(Self {
            database_url: database_url.to_owned(),
            client: Arc::new(Mutex::new(Some(client))),
        })
    }

    /// Run an optional-result query. On failure, reconnects once and retries.
    pub async fn query_opt(
        &self,
        sql: &str,
        params: &[&(dyn tokio_postgres::types::ToSql + Sync)],
    ) -> anyhow::Result<Option<Row>> {
        // First attempt.
        {
            let guard = self.client.lock().await;
            if let Some(c) = guard.as_ref() {
                match c.query_opt(sql, params).await {
                    Ok(row) => return Ok(row),
                    Err(e) => warn!("DB query failed ({e}), reconnecting…"),
                }
            }
        }

        // Reconnect.
        match Self::new_connection(&self.database_url).await {
            Ok(fresh) => {
                let row = fresh.query_opt(sql, params).await?;
                *self.client.lock().await = Some(fresh);
                Ok(row)
            }
            Err(e) => {
                *self.client.lock().await = None;
                Err(e)
            }
        }
    }

    async fn new_connection(database_url: &str) -> anyhow::Result<Client> {
        let (client, conn) = tokio_postgres::connect(database_url, NoTls).await?;
        tokio::spawn(async move {
            if let Err(e) = conn.await {
                warn!("PostgreSQL background connection ended: {e}");
            }
        });
        info!("PostgreSQL connection established");
        Ok(client)
    }
}
