//! # nodyx-sfu-mediasoup — adaptateur mediasoup + daemon SFU
//!
//! - [`engine`] : `MediasoupEngine`, l'implémentation du trait `MediaEngine`
//!   (étage 3 de la séparation hexagonale, CDC §18).
//! - bin `spike` : les scénarios de preuve (cerveau × moteur réel, pipe fédéré,
//!   WebRtcTransport).
//! - bin `nodyx-sfud` : le daemon (API interne localhost consommée par
//!   nodyx-core, CDC §3 "le SFU expose une API interne ; nodyx-core relaie").

pub mod engine;
