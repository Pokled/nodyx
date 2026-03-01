mod client;
mod protocol;
mod server;

use clap::{Parser, Subcommand};
use tracing_subscriber::{EnvFilter, fmt};

// ── CLI ───────────────────────────────────────────────────────────────────────

#[derive(Parser)]
#[command(
    name = "nexus-relay",
    version,
    about = "Nexus P2P relay — tunnel Nexus instances without open ports or a domain",
    long_about = None,
)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Run the relay server (on nexusnode.app VPS).
    Server {
        /// TCP port for relay client connections.
        #[arg(long, default_value = "7443")]
        tcp_port: u16,

        /// HTTP port for Caddy reverse proxy.
        #[arg(long, default_value = "7001")]
        http_port: u16,

        /// PostgreSQL connection string.
        /// Defaults to DATABASE_URL environment variable.
        #[arg(long, env = "DATABASE_URL")]
        database_url: String,

        /// The main community slug hosted on this VPS (excluded from relay routing).
        /// Defaults to RELAY_MAIN_SLUG environment variable.
        #[arg(long, env = "RELAY_MAIN_SLUG", default_value = "nexusnode")]
        main_slug: String,
    },

    /// Run the relay client (on a user's Nexus instance).
    Client {
        /// Address of the relay server.
        #[arg(long, default_value = "relay.nexusnode.app:7443")]
        server: String,

        /// The slug to register (e.g. "moncommunaute").
        #[arg(long)]
        slug: String,

        /// Authentication token from nexusnode.app directory registration.
        #[arg(long, env = "NEXUS_RELAY_TOKEN")]
        token: String,

        /// Local HTTP port to forward traffic to.
        #[arg(long, default_value = "80")]
        local_port: u16,
    },
}

// ── Main ──────────────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Initialize structured logging. RUST_LOG controls the filter.
    fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("nexus_relay=info")),
        )
        .with_target(false)
        .compact()
        .init();

    let cli = Cli::parse();

    match cli.command {
        Commands::Server {
            tcp_port,
            http_port,
            database_url,
            main_slug,
        } => {
            server::run(tcp_port, http_port, &database_url, &main_slug).await?;
        }

        Commands::Client {
            server,
            slug,
            token,
            local_port,
        } => {
            client::run(&server, &slug, &token, local_port).await?;
        }
    }

    Ok(())
}
