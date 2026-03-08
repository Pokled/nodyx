// ── nexus-turn ────────────────────────────────────────────────────────────────
// STUN/TURN server — replaces coturn in the Nexus P2P stack.
// RFC 5389 (STUN) + RFC 5766 (TURN) + RFC 6062 (TURN-over-TCP)
//
// Usage:
//   nexus-turn server --udp-port 3478 --realm nexusnode.app --public-ip 1.2.3.4
//                     --secret $TURN_SECRET
//
// Credentials (coturn use-auth-secret compatible):
//   username = "{expires_unix_ts}:{user_id}"
//   password = BASE64(HMAC-SHA1(secret, username))
//   → nexus-core generates these per user and sends them via voice:init

mod allocation;
mod auth;
mod protocol;
mod server;

use std::net::{IpAddr, SocketAddr};
use std::sync::Arc;
use anyhow::{Context, Result};
use clap::{Parser, Subcommand};
use rand::distributions::Alphanumeric;
use rand::Rng;
use tokio::net::UdpSocket;
use tracing::info;
use tracing_subscriber::EnvFilter;

use crate::allocation::new_registry;
use server::{run, run_tcp, TurnConfig};

// ── CLI ───────────────────────────────────────────────────────────────────────

#[derive(Parser)]
#[command(name = "nexus-turn", about = "Nexus STUN/TURN server (replaces coturn)")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Run the STUN/TURN server
    Server {
        /// UDP port to listen on (STUN + TURN)
        #[arg(long, env = "TURN_PORT", default_value = "3478")]
        udp_port: u16,

        /// Public IP address (sent in XOR-RELAYED-ADDRESS)
        #[arg(long, env = "TURN_PUBLIC_IP")]
        public_ip: IpAddr,

        /// TURN realm (e.g. nexusnode.app or your domain)
        #[arg(long, env = "TURN_REALM", default_value = "nexus")]
        realm: String,

        /// Shared secret for HMAC-SHA1 credential generation
        #[arg(long, env = "TURN_SECRET")]
        secret: String,

        /// Credential TTL in seconds (default 24h)
        #[arg(long, env = "TURN_TTL", default_value = "86400")]
        ttl: u64,
    },
}

// ── Entry point ───────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_env("RUST_LOG")
                .unwrap_or_else(|_| EnvFilter::new("info"))
        )
        .with_target(false)
        .init();

    let cli = Cli::parse();

    match cli.command {
        Commands::Server { udp_port, public_ip, realm, secret, ttl } => {
            let bind_addr: SocketAddr = (std::net::Ipv4Addr::UNSPECIFIED, udp_port).into();
            let socket = Arc::new(
                UdpSocket::bind(bind_addr)
                    .await
                    .with_context(|| format!("Failed to bind UDP {bind_addr}"))?
            );

            // Shared allocation registry — UDP and TCP clients share the same pool.
            let registry = new_registry();

            // Generate a fresh nonce at startup (used in 401 challenges)
            let nonce: String = rand::thread_rng()
                .sample_iter(&Alphanumeric)
                .take(32)
                .map(char::from)
                .collect();

            let cfg = Arc::new(TurnConfig {
                realm,
                secret: secret.into_bytes(),
                public_ip,
                ttl,
                nonce,
            });

            info!(
                "nexus-turn v{} — STUN/TURN on udp:{udp_port} + tcp:{udp_port} | public_ip={}",
                env!("CARGO_PKG_VERSION"),
                cfg.public_ip
            );

            // Run UDP and TCP listeners concurrently on the shared registry.
            // If either exits, the whole process exits.
            tokio::select! {
                r = run(socket, Arc::clone(&cfg), Arc::clone(&registry)) => r?,
                r = run_tcp(udp_port, Arc::clone(&cfg), Arc::clone(&registry)) => r?,
            }
        }
    }

    Ok(())
}
