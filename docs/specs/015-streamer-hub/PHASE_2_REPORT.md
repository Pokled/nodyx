# Streamer Hub - Phase 2 Report

**Date de livraison** : 2026-05-10
**Branche** : `feat/streamer-hub-phase-2` (à merger dans `main` pour `v2.5.0`)
**Tampon final** : ✅ **Phase 2 fermée**
**Durée** : 2026-05-08 → 2026-05-10, ~3 jours étalés.

---

## TL;DR

Phase 2 livre le **chat unifié Twitch ↔ Nodyx** : inbound (EventSub Chat), outbound (Helix Send Chat Message), badges Twitch, emotes natives + BTTV/FFZ/7TV, lifecycle de sessions, queue Redis pour absorber les rate-limits. Vérifié en prod (277 messages reçus, 1 session live testée). **Trous Phase 1 §7 Flow B/C reportés explicitement en Phase 5** (cf spec §13).

---

## Couverture spec §6 — chat bridge

| Sous-section | Livrable | Statut |
|---|---|---|
| §6.1 Architecture EventSub Chat (in) + Helix Send (out) | Subscription `channel.chat.message` créée et `enabled` en prod. POST `/chat/messages` câblé depuis `socket/index.ts` quand un message arrive dans le channel slug `twitch-chat`. | ✅ |
| §6.2 Channel `#twitch-chat` auto, read-write | Channel créé à la première sync (`ensureTwitchChatChannel`), `is_system_managed=false` donc tous les membres peuvent y écrire (= relai outbound). | ✅ |
| §6.2 Mode "lecture seule non-streamers" optionnel | Reporté V2 (spec §16). Non-critique mono-instance. | ⏸ V2 |
| §6.3 Badges Twitch globaux + channel via Helix, cache Redis 24h | `badges.ts` : fetch `/chat/badges/global` (cache 7j) + `/chat/badges/channel` (cache 24h) avec App Access Token cache 50j. Render `<img class="streamer-badge">` préfixé au content. Channel override global. | ✅ brique 2.6 |
| §6.3 Emotes natives Twitch via fragments + CDN | `emotes.ts` `renderChatMessage` : pour chaque fragment `type==='emote'`, render `https://static-cdn.jtvnw.net/emoticons/v2/{id}/default/dark/2.0`. | ✅ brique 2.5 |
| §6.3 BTTV / FFZ / 7TV emotes, cache Redis 24h par channel | Même module : `loadChannelEmoteSet` fetch les 3 providers en parallèle (`Promise.all`), cache Redis `streamer:emotes:ch:<id>` 24h. Précédence 7TV > FFZ > BTTV (un code peut exister dans plusieurs providers). | ✅ brique 2.5 |
| §6.4 Garde-fou : check `streamer_sessions` ouverte avant send | `isStreamerLive` SELECT `streamer_sessions WHERE ended_at IS NULL`. Lifecycle (INSERT à `stream.online`, UPDATE à `stream.offline`) géré dans `ingestEvent`. | ✅ brique 2.4 |
| §6.4 Mode test bypass | `STREAMER_CHAT_TEST_MODE=1` court-circuite le check. | ✅ |
| §6.5 Limite Helix (100 req/min compte régulier) | Pas de throttle préventif (rate Nodyx normal très en dessous), mais queue Redis de recovery sur 429. | ✅ brique 2.7 |
| §6.5 Queue Redis `streamer:chat:send_queue` + backoff exponentiel | Sorted set (score = nextRetryAt), worker `setInterval(2s)` batch de 10, backoff `2^attempts * 1s` capé à 30s, drop si TTL 60s dépassé ou attempts > 5. | ✅ brique 2.7 |
| §6.5 Alerte admin si queue > 50 messages | Audit `chat_relay_queue_overflow` (failed) + `console.warn` sur chaque enqueue qui dépasse. | ✅ brique 2.7 |

---

## Briques livrées (chronologique)

| Brique | Commit | Contenu |
|---|---|---|
| 2.1 | `634e75d` | Subscription `channel.chat.message` + endpoint sync |
| 2.2 + 2.3 | `1ef1b8c` | Inbound chat → `#twitch-chat` (`pushTwitchChatMessage` + `resolveTwitchAuthor`) |
| fix | `2bb1d2c` | Dedup vs Twitch + user token pour `channel.chat.message` |
| fix | `9f3becf` | Scopes `user:bot` + `channel:bot` + cleanup auto à la reconnexion |
| fix | `602959c` | Mapping Twitch wire format → `CreatedSubscription` |
| 2.4 | `92eae2f` | Outbound chat Nodyx → Twitch (`relayMessageToTwitch`) + lifecycle `streamer_sessions` |
| 2.5 | `dccd730` | Emotes Twitch natives + BTTV/FFZ/7TV (cache 24h) |
| cleanup | `977fbc7` | Retire import redis inutilisé + commentaires obsolètes (post-audit 2026-05-10) |
| 2.8 | `082fccb` | Tests Phase 2 : bridge (12) + emotes (11) + lifecycle (9) |
| 2.7 | `e8b02e6` | Queue Redis outbound + backoff + alerte overflow (+19 tests) |
| 2.6 | `070d065` | Badges Twitch via Helix + cache Redis (+14 tests) |

---

## Vérifications prod (audit 2026-05-10)

| Élément | État |
|---|---|
| 10 EventSub subscriptions | toutes `enabled` |
| OAuth tokens chiffrés AES-256-GCM | 1 token streamer (`pokled`), 9 scopes accordés |
| Lifecycle `streamer_sessions` | testé live le 8 mai (22:59 open → 9 mai 01:13 close, 2h 13min) |
| Inbound chat | **277 messages** reçus dans `#twitch-chat` pendant la session test |
| `#streamer-events` (Phase 1) | 21 messages d'événements auto |
| Audit log alimenté | `eventsub_subscribe`, `connect_twitch`, refresh… |

---

## Tests

| Avant Phase 2 | Après Phase 2 |
|---|---|
| 204/204 verts (1 fichier streamer = `streamer-crypto.test.ts`, 10 tests Phase 1) | **269/269 verts** (5 fichiers streamer, 75 tests dont 65 nouveaux) |

Détail des nouveaux fichiers :
- `streamer-bridge.test.ts` — 14 tests (gardes, refresh, formatting, erreurs Helix, 429 → queue)
- `streamer-emotes.test.ts` — 11 tests (fragments natifs, fallback text, cache Redis, dégradation gracieuse)
- `streamer-lifecycle.test.ts` — 9 tests (chat.message bypass streamer_events, online INSERT idempotent, offline UPDATE)
- `streamer-outbound-queue.test.ts` — 17 tests (backoff, enqueue, pop, reschedule, drop, worker tick)
- `streamer-badges.test.ts` — 14 tests (global+channel résolution, override, cache 7j/24h/50j, dégradation gracieuse)

---

## Décisions techniques importantes

1. **`channel.chat.message` n'est PAS persisté dans `streamer_events`** (early-return dans `ingestEvent`). Volume potentiel 100+/min sur un stream actif, ça pourrirait la table. Les messages atterrissent directement dans `channel_messages` du channel `#twitch-chat`, qui est la persistence chat normale de Nodyx.

2. **Lifecycle session via `external_id = stream_id` Twitch** (pas broadcaster_id). Le `stream_id` change à chaque go-live → idempotent vs replays EventSub (`ON CONFLICT DO NOTHING`). À `stream.offline`, on UPDATE toutes les rows ouvertes du provider (pas de stream_id dans le payload offline).

3. **Outbound déclenché depuis `socket/index.ts`** (pas un hook DB) : quand un message socket arrive sur le channel slug `twitch-chat`, on dispatch dans une promise détachée vers `relayMessageToTwitch`. Best-effort, ne bloque pas la response socket.

4. **Préfixe `[username]` activé par défaut** (transparence pour les viewers Twitch). Désactivable via `STREAMER_CHAT_NO_PREFIX=1`.

5. **Queue Redis = recovery uniquement**, pas un throttle préventif. Le path direct (Helix immédiat) reste prioritaire. La queue n'absorbe que les 429.

6. **Audit minimaliste sur le path direct** : `stream_offline` et `no_streamer` ne sont PAS audités (états attendus, bruit). Seuls les drops effectifs (erreur Helix non-recover, message expiré, max attempts) génèrent une ligne audit.

7. **Channel override global pour les badges** : un streamer peut customiser ses badges (Subscriber 1mo, 3mo, 12mo, etc.) et Twitch les retourne via `/chat/badges/channel`. Le code applique `{ ...global, ...channel }` donc les badges custom écrasent les globaux du même `set_id:id`.

---

## Trous Phase 1 reportés explicitement en Phase 5

La spec §13 v2.3 disait Phase 1 = "OAuth viewer (3 flows)". En réalité, seul **Flow A** (lier son Twitch perso au profil Nodyx existant) a été livré. Les **Flow B** (signup auto via panel Twitch) et **Flow C** (login auto via `twitch_id` existant) sont reportés en Phase 5 où ils s'intègrent naturellement avec la Twitch Extension. La spec §13 doit être rectifiée pour ne plus annoncer "3 flows" en Phase 1.

---

## Ce qui reste pour `v2.5.0`

- [x] Briques 2.1 → 2.8 mergées
- [x] Phase 2 cleanup (commentaires obsolètes, imports inutilisés)
- [x] PHASE_2_REPORT.md (ce fichier)
- [ ] Rectification spec §13 (Phase 1 = "Flow A only")
- [ ] Merge `feat/streamer-hub-phase-2` → `main`
- [ ] Entrée CHANGELOG.md
- [ ] Tag `v2.5.0`

---

## Suite : Phase 3 — OBS Stream Deck web

Estimé 4-5 jours. Couvre :
- WebSocket v5 navigateur-direct (topologies A + B, cf spec §8.1)
- Grille drag-and-drop des scènes
- Actions essentielles (switch scene, mute/unmute sources, start/stop record, etc.)
- Doc tunnel pour le cas C (PC OBS distant)

Démarre depuis `main` après tag `v2.5.0`.
