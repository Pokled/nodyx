# Neural Engine

> **Status: Early Access** — Model detection and selection are functional. Active moderation features are in development.

Nexus includes a Neural Engine that connects your instance to a local [Ollama](https://ollama.com) installation. Your AI runs on your own hardware. No data leaves your server.

---

## What it does

The Neural Engine allows Nexus to use large language models hosted locally via Ollama for:

- **Model detection** — automatically scans Ollama and lists available models *(functional)*
- **Model selection** — lets the admin choose which model the instance uses *(functional — UI ready, backend route in development)*
- **Chat moderation** — AI-assisted flagging of messages in real time *(in development)*
- **Thread summarization** — automatic summaries for long forum threads *(planned)*
- **Moderation suggestions** — AI-assisted moderation decisions for admins *(planned)*

---

## Data sovereignty

> *"Aucune donnée ne quitte ton infrastructure."*

When the Neural Engine is active, all AI inference runs on **your server**, using **your GPU/CPU**. There is no call to OpenAI, Anthropic, or any external API. Your community's content stays on your hardware.

---

## Requirements

- Ollama installed and running on the same machine as Nexus (or accessible on the local network)
- At least one model pulled in Ollama
- Caddy configured to proxy `/ollama/` → `localhost:11434`

---

## Setup

### 1. Install Ollama

```bash
# Linux
curl -fsSL https://ollama.com/install.sh | sh

# macOS
brew install ollama

# Windows
# Download the installer from https://ollama.com/download
```

### 2. Pull a model

```bash
ollama pull mistral        # 4.1 GB — recommended for moderation
ollama pull llama3.2       # 2.0 GB — fast, good for short tasks
ollama pull gemma2         # 5.4 GB — strong reasoning
```

For moderation tasks, a 7B model is sufficient. Larger models give better results but require more VRAM.

| Model | Size | VRAM | Notes |
|---|---|---|---|
| `llama3.2:3b` | 2.0 GB | 4 GB | Fast, low resource |
| `mistral` | 4.1 GB | 6 GB | Good balance — recommended |
| `llama3.1:8b` | 4.9 GB | 8 GB | Strong quality |
| `gemma2:9b` | 5.4 GB | 8 GB | Strong reasoning |

### 3. Configure Caddy proxy

Add the following block to your `Caddyfile`:

```caddyfile
handle /ollama/* {
    uri strip_prefix /ollama
    reverse_proxy localhost:11434
}
```

This proxies requests from the Nexus frontend (`/ollama/api/tags`) to the local Ollama API. It ensures Ollama is only accessible through Nexus, not directly from the internet.

### 4. Enable in the admin panel

1. Go to **Admin → Neural Engine**
2. Click **Scanner Ollama**
3. Your available models will appear
4. Click **Activer** next to the model you want to use

---

## Admin panel

The Neural Engine panel is accessible at `/admin/ai` (linked from the Admin sidebar under **Instance → Neural Engine**).

| Element | Description |
|---|---|
| Availability gauge | 12-segment bar — green = Ollama ready, red = unreachable |
| Model list | All models detected on your Ollama instance, with size in GB |
| Active indicator | Purple dot next to the currently selected model |
| Scanner button | Re-scans Ollama for new or removed models |

---

## Roadmap

| Feature | Status |
|---|---|
| Ollama detection + model listing | ✅ Done |
| Model selection (admin UI) | ✅ UI done — backend in progress |
| Real-time chat moderation | 🔨 In development |
| Thread summarization | ⏳ Planned — Phase 4 |
| Moderation suggestions for admins | ⏳ Planned — Phase 4 |
| Multi-model routing | ⏳ Planned — Phase 4 |

---

## Privacy

The Neural Engine is designed around a strict principle: **your AI, your data, your rules**.

- All inference runs locally — no external API calls
- No telemetry is sent about which models you use or what content is processed
- Caddy proxy ensures Ollama is not exposed to the public internet
- You choose which model runs, and you can stop it at any time
