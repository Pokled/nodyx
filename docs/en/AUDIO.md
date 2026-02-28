# Nexus Audio Engine

Nexus includes a client-side audio processing chain designed to deliver broadcast-quality voice in any voice channel — without dedicated hardware, without external services, and without sending your audio anywhere but directly to your peers.

---

## How it works

When you join a voice channel, your microphone signal passes through a chain of Web Audio API nodes before reaching the WebRTC peer connection:

```
Microphone
    │
    ▼
[GainNode]           ← Mic boost / attenuation (0.1×–2.0×)
    │
    ▼
[BiquadFilterNode]   ← High-pass filter at 80 Hz (optional)
    │
    ▼
[RNNoise WASM]       ← AI noise suppression (optional)
    │
    ▼
[BiquadFilterNode ×3] ← Broadcast EQ — 3-band (optional)
    │
    ▼
WebRTC PeerConnection → peers
```

Everything runs **in your browser**. No audio is processed server-side.

---

## Settings

All settings are accessible via the ⚙ button in the voice bar (VoicePanel), persisted automatically in `localStorage`.

---

### Mic Gain

**Range:** 0.1× – 2.0× (default: 1.0×)

Adjusts the input volume of your microphone before any processing.

- `1.0` = no change (nominal level)
- `2.0` = doubles the signal (+6 dB) — useful for quiet microphones
- `0.5` = cuts the signal in half (−6 dB) — useful for loud/saturating mics

---

### High-pass filter (80 Hz)

**Default: enabled**

A `highpass` BiquadFilter cutting everything below 80 Hz. Eliminates:
- PC fan rumble
- Air conditioning hum
- Mechanical vibrations from the desk
- Low-frequency handling noise

Virtually no impact on voice intelligibility. Recommended to leave on.

---

### RNNoise — AI noise suppression

**Default: disabled** *(requires `@jitsi/rnnoise-wasm`)*

RNNoise is a neural network model (trained by Mozilla/Xiph) compiled to WebAssembly. It runs entirely in your browser, analyzes your audio in 10 ms frames, and suppresses background noise in real time.

It is effective against:
- Keyboard and mouse clicks
- Street noise
- Background music
- Crowd noise

> **Note:** RNNoise requires the `@jitsi/rnnoise-wasm` package. If not installed, the toggle is disabled in the UI. Enable it in production by running `npm install @jitsi/rnnoise-wasm` in `nexus-frontend/`.

---

### Broadcast Mode — 3-band EQ

**Default: disabled — Intensity: 60%**

This is the audio feature that sets Nexus apart. Broadcast Mode applies a three-band equalizer tuned for the human voice, replicating the processing chain used in professional podcasting and radio broadcasting.

#### The three bands

| Band | Type | Frequency | Gain | Purpose |
|---|---|---|---|---|
| Low mid cut | Peaking | 200 Hz | −3 dB | Removes "mud" and boxiness |
| Presence boost | Peaking | 3 000 Hz | +4 dB | Adds clarity, cuts through the mix |
| Air | High shelf | 8 000 Hz | +3 dB | Adds "air" and brightness |

#### Intensity slider

The **Intensity** slider (0–100%) scales all three band gains proportionally. At 0% the EQ is flat. At 100% the gains are applied at full strength. The default of 60% is a balanced setting suitable for most microphones.

#### Before / after

| Without Broadcast Mode | With Broadcast Mode |
|---|---|
| Flat, slightly boomy | Clear, present, radio-quality |
| Voice buried in low mids | Voice sits forward in the mix |
| Lacks sparkle | Natural brightness |

> Discord does not offer any client-side EQ for voice. Broadcast Mode provides podcast-level audio quality with zero additional hardware.

---

### Opus Bitrate

**Options:** 32 kbps / **64 kbps** (default) / 128 kbps

Controls the Opus codec bitrate applied to the next peer connection.

| Bitrate | Use case |
|---|---|
| 32 kbps | Low bandwidth, voice only |
| 64 kbps | Default — excellent quality/bandwidth balance |
| 128 kbps | High-quality audio, music, or recording streams |

Changes take effect on the **next connection** (reconnect to the voice channel to apply).

---

## Summary

| Feature | Technology | Runs on |
|---|---|---|
| Mic Gain | Web Audio GainNode | Browser |
| High-pass filter | Web Audio BiquadFilter | Browser |
| AI noise suppression | RNNoise WASM (Mozilla/Xiph) | Browser |
| Broadcast EQ | Web Audio BiquadFilter ×3 | Browser |
| Voice codec | Opus (WebRTC standard) | Browser → Peers |

All processing is **local and private**. No audio data is sent to any server beyond your direct P2P peer connections.
