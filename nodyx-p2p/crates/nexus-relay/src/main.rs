mod client;
mod client_ip;
mod keepalive;
mod protocol;
mod server;

use clap::{Parser, Subcommand};
use tracing_subscriber::{EnvFilter, fmt};

// ── CLI ───────────────────────────────────────────────────────────────────────

#[derive(Parser)]
#[command(
    name = "nodyx-relay",
    version,
    about = "Nodyx P2P relay — tunnel Nodyx instances without open ports or a domain",
    long_about = None,
)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Run the relay server (on nodyx.org VPS).
    Server {
        /// TCP port for relay client connections.
        #[arg(long, default_value = "7443")]
        tcp_port: u16,

        /// Address the relay listens on for client connections.
        ///
        /// Defaults to `[::]`, which on Linux accepts BOTH IPv6 and IPv4 as long
        /// as `net.ipv6.bindv6only` is 0 (the kernel default, and not overridden
        /// anywhere in /etc/sysctl.d on the production VPS). Before this default,
        /// the relay bound `0.0.0.0` and was unreachable from an IPv6-only
        /// network.
        ///
        /// Kept configurable on purpose: if a host ever sets `bindv6only=1`, a
        /// `[::]` socket silently stops accepting IPv4, which would strand every
        /// existing instance. Setting `--tcp-bind 0.0.0.0` restores the old
        /// behaviour without rebuilding.
        #[arg(long, env = "RELAY_TCP_BIND", default_value = "[::]")]
        tcp_bind: String,

        /// Loopback port for the WebSocket door, reverse-proxied by Caddy.
        ///
        /// Never exposed publicly: Caddy terminates TLS in front of it, and a
        /// public bind would offer an unauthenticated upgrade with no TLS.
        #[arg(long, default_value = "7002")]
        ws_port: u16,

        /// HTTP port for Caddy reverse proxy.
        #[arg(long, default_value = "7001")]
        http_port: u16,

        /// PostgreSQL connection string.
        /// Defaults to DATABASE_URL environment variable.
        #[arg(long, env = "DATABASE_URL")]
        database_url: String,

        /// The main community slug hosted on this VPS (excluded from relay routing).
        /// Defaults to RELAY_MAIN_SLUG environment variable.
        #[arg(long, env = "RELAY_MAIN_SLUG", default_value = "nodyxnode")]
        main_slug: String,
    },

    /// Run the relay client (on a user's Nodyx instance).
    Client {
        /// Address of the relay server.
        #[arg(long, default_value = "relay.nodyx.org:7443")]
        server: String,

        /// The slug to register (e.g. "moncommunaute").
        #[arg(long)]
        slug: String,

        /// Authentication token from nodyx.org directory registration.
        #[arg(long, env = "NODYX_RELAY_TOKEN")]
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
                .unwrap_or_else(|_| EnvFilter::new("nodyx_relay=info")),
        )
        .with_target(false)
        .compact()
        .init();

    let cli = Cli::parse();

    match cli.command {
        Commands::Server {
            tcp_port,
            tcp_bind,
            ws_port,
            http_port,
            database_url,
            main_slug,
        } => {
            server::run(&tcp_bind, tcp_port, ws_port, http_port, &database_url, &main_slug).await?;
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
