# Neural Engine — Nexus Guard Protocol

Nexus includes a Neural Engine powered by a local [Ollama](https://ollama.com) instance. Your AI runs on your own hardware. No data leaves your server.

---

## Nexus Guard Protocol

The Guard Protocol is the chat moderation system driven by the Neural Engine. When a message is sent, it is analyzed by the local LLM which returns a **toxicity score from 0 to 10**. If the score exceeds the threshold (**8 by default**), the message is automatically deleted and replaced in the UI by:

```
🤖 Nexus Guard Protocol
   Transmission neutralisée : Contenu toxique détecté
```

### What it currently filters

| Filter | Status |
|---|---|
| Profanity / insults | ✅ Functional |
| Spam (repeated text / flooding) | ✅ Functional |
| URL blocking | ⚠️ Partial — not yet reliable |
| Hate speech | ✅ Functional (model-dependent) |
| Threats | ✅ Functional (model-dependent) |

### How the score works

The LLM receives the message and returns a toxicity score between 0 and 10:

| Score | Meaning | Action |
|---|---|---|
| 0–4 | Clean / benign | Message delivered normally |
| 5–7 | Borderline | Message delivered, logged |
| 8–10 | Toxic / harmful | Message auto-deleted — Guard Protocol triggered |

The threshold is configurable. A lower threshold = more aggressive moderation.

---

## Active model

The current active model is configured in `nexus-core/neural-config.json`:

```json
{
  "activeModel": "qwen2.5:3b"
}
```

`qwen2.5:3b` is the recommended model for moderation tasks — small enough to run on modest hardware (4 GB VRAM), fast enough for real-time chat analysis.

---

## Requirements

- Ollama installed and running on the same machine as Nexus
- At least one model pulled (see recommended models below)
- Caddy configured to proxy `/ollama/` → `localhost:11434` *(for the admin panel scanner)*

---

## Setup

### 1. Install Ollama

```bash
# Linux
curl -fsSL https://ollama.com/install.sh | sh

# macOS
brew install ollama

# Windows
# Download from https://ollama.com/download
```

### 2. Pull the recommended model

```bash
ollama pull qwen2.5:3b     # recommended — fast, accurate, low VRAM
```

Alternative models:

| Model | Size | VRAM | Notes |
|---|---|---|---|
| `qwen2.5:3b` | 2.0 GB | 4 GB | **Recommended** — fast, good accuracy |
| `llama3.2:3b` | 2.0 GB | 4 GB | Good alternative |
| `mistral` | 4.1 GB | 6 GB | Better quality, heavier |
| `llama3.1:8b` | 4.9 GB | 8 GB | Best accuracy |

### 3. Configure Caddy proxy *(for admin panel)*

```caddyfile
handle /ollama/* {
    uri strip_prefix /ollama
    reverse_proxy localhost:11434
}
```

### 4. Select the model in the admin panel

1. Go to **Admin → Neural Engine**
2. Click **Scanner Ollama**
3. Click **Activer** next to the model you want to use

The selection is saved in `nexus-core/neural-config.json` and takes effect immediately.

---

## Admin panel

The Neural Engine panel is at `/admin/ai` (Admin sidebar → **Instance → Neural Engine**).

| Element | Description |
|---|---|
| Availability gauge | 12-segment bar — purple = Ollama ready, red = unreachable |
| Model list | All models detected on your Ollama instance, with size in GB |
| Active indicator | Purple dot next to the currently selected model |
| Scanner button | Re-scans Ollama for new or removed models |

---

## Privacy

The Neural Engine is built on a core principle: **your AI, your data, your rules**.

- All inference runs locally — no calls to OpenAI, Anthropic, or any external API
- Message content analyzed by the LLM never leaves your server
- Caddy proxy ensures Ollama is not exposed to the public internet
- You choose the model, and you can stop it at any time

---

## Roadmap

| Feature | Status |
|---|---|
| Ollama detection + model listing | ✅ Done |
| Model selection (admin UI + config file) | ✅ Done |
| Chat toxicity scoring (0–10) | ✅ Done |
| Auto-delete above threshold | ✅ Done |
| Guard Protocol UI | ✅ Done |
| URL blocking | ⚠️ Partial — in progress |
| Thread summarization | ⏳ Planned — Phase 4 |
| Moderation suggestions for admins | ⏳ Planned — Phase 4 |
| Configurable threshold via admin UI | ⏳ Planned — Phase 4 |
