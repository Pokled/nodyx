# Streamer Hub - Phase 0 Spike Report

**Date du spike** : 2026-05-08
**Branche** : `feat/streamer-hub-spike`
**Tampon final** : ✅ **GO Phase 1** (6 / 6 critères validables)
**Durée** : ~3h, du scaffold au canary live inclus.

---

## TL;DR

Le spike a validé bout-en-bout tout ce qui était testable côté code et infra (chiffrement, HMAC, scopes, refresh, canary `stream.online` réel reçu en 2ms). La spec peut partir sur Phase 1 sans réécriture. Les 3 points §15.bis #3-#5 restants sont explicitement hors scope spike et arriveront en Phase 5.

---

## Critères d'acceptance §15.bis

| # | Question | Verdict | Détail |
|---|---|---|---|
| 1 | EventSub Chat (`user:read:chat`) accessible sans review "Chat Bot" | ✅ GO | Consent screen Twitch a accepté le scope sur une app fraîchement créée (< 24 h), aucun process de review demandé. Pipeline EventSub Chat dispo sans frottement administratif. |
| 2 | `clips:read` suffit-il à la place de `clips:edit` | ✅ GO (résolu) | Le scope `clips:read` **n'existe pas** côté Twitch (réponse 400 `invalid scope requested`). Pour lire les top clips (Helix `GET /clips`), un App Access Token suffit, aucun scope user requis. `clips:edit` reste nécessaire uniquement si on veut créer des clips depuis Nodyx (Phase 5+). Spec §4.1 à mettre à jour : retirer `clips:read` et `clips:edit` de Phase 1. |
| 3 | Scopes pour `!so @user` (Helix `GET /channels`) | ⏸ Différé | Pas testé dans le spike (hors scope canary minimal). Hypothèse : endpoint accessible avec App Access Token. À valider en Phase 5. Pas bloquant pour Phase 1-4. |
| 4 | Hosting Twitch Extension HTTPS | ⏸ Différé | Pas testé (hors scope spike). Validation manuelle à faire au moment de la submission Phase 5. Pas bloquant pour Phase 1-4. |
| 5 | TTL queue chat outbound | ⏸ Différé | Hors scope spike (la queue n'existe que côté Phase 2). Pattern à implémenter en Phase 2 selon la spec §6.5. |

## Critères techniques implicites

| # | Question | Verdict | Détail |
|---|---|---|---|
| A | Chiffrement AES-256-GCM + HKDF master + sel par row (§12.1) | ✅ GO | 10/10 tests négatifs verts (`src/tests/streamer-spike-crypto.test.ts`) : altérer master / sel / IV / tag / ciphertext fait échouer le déchiffrement. Round-trip live validé via le flow OAuth (encrypt à l'inscription + decrypt au refresh). |
| B | Nonce URL EventSub + HMAC SHA-256 (§12.2) | ✅ GO | Round-trip Twitch → handler validé en **1.6 seconde**. Verification challenge accepté, status passé `pending → enabled`. Le nonce 32 octets base64url évite tout endpoint global devinable. |
| C | Refresh tokens proactif (§12.3) | ✅ GO | `GET /refresh?id=36520358` a généré un nouveau couple access/refresh, re-chiffrés avec un nouveau sel + IV. `rotated_at` mis à jour. Ouvre la voie à la rotation forcée 30 j en Phase 5. |
| D | Canary `stream.online` (notification path) | ✅ GO | Stream test lancé live, webhook reçu en **2 ms** (POST `/eventsub/98JmfVN2B0Z…` → log `🎬 EventSub notification reçue`). HMAC ✓, dedup ✓, parsing body ✓ (broadcaster_user_id, type, started_at extraits proprement). Pipeline complet validé. |

---

## Décisions / corrections appliquées pendant le spike

1. **Variables d'env isolées** : le spike utilise `STREAMER_TWITCH_CLIENT_ID` / `STREAMER_TWITCH_CLIENT_SECRET` (pas `TWITCH_CLIENT_ID` / `_SECRET`). Pourquoi : le widget homepage a déjà ses propres credentials Twitch, partager les vars cassait le widget dès qu'on poussait l'app du Streamer Hub.

2. **Scopes Phase 0** : passés de 8 à 7 scopes après le rejet `clips:read`. Liste finale : `user:read:email`, `user:read:chat`, `user:write:chat`, `channel:read:subscriptions`, `bits:read`, `moderator:read:followers`, `channel:read:polls`.

3. **Permissions `.env`** : incident réparation `chown root:nodyx /var/www/nexus/nodyx-core/.env` après que mes Edit avaient retourné le fichier à `root:root`, rendant pm2 nodyx incapable de lire JWT_SECRET. Mémo enregistré dans `feedback_env_ownership.md` pour les futures sessions.

---

## Recommandations Phase 1

1. **Code récupérable presque tel quel.** `crypto.ts`, `store.ts` (pour la couche encrypt/decrypt), `twitchClient.ts`, et la structure `oauth.ts` / `eventsub.ts` peuvent migrer vers `src/services/streamer/` avec un refactor minimal (remplacer `store.ts` in-memory par les tables `streamer_oauth_tokens` + `streamer_eventsub_subscriptions`). Garder le content-type parser custom encapsulé pour l'EventSub.

2. **Migration 078** : appliquer le schéma de la spec §3 tel quel. Le format `enc_salt`/`enc_iv`/`enc_tag`/`key_version` est aligné avec `crypto.ts` actuel.

3. **Mettre à jour la spec §4.1** : retirer `clips:read` (n'existe pas) et `clips:edit` (Phase 5 only) des scopes Phase 1.

4. **Auth admin** : le spike a 0 garde sur les endpoints `/auth`, `/callback`, `/refresh`, `/me`. En Phase 1, `requireAuth` + `adminOnly` sur tout sauf `/callback` (qui doit rester public car appelé par Twitch) et `/eventsub/:nonce` (idem).

5. **Persistence migration** : le spike est in-memory, donc tous les tokens et subscriptions sautent au restart. Phase 1 doit persister tout ça (cf §3 spec). Une fois la migration faite, la Phase 1 peut déjà subscriber proprement aux 8 events §5.2.

6. **Phase 1 démarre depuis `main`**, pas depuis cette branche : la branche `feat/streamer-hub-spike` reste comme archive du spike (jamais merged en l'état). Phase 1 = nouveau feat branch, on importe sélectivement les helpers.

---

## Liens

- Spec : [SPEC.MD](SPEC.MD)
- Guide de déploiement spike : [PHASE_0_SPIKE.md](PHASE_0_SPIKE.md)
- Branche : <https://github.com/Pokled/nodyx/tree/feat/streamer-hub-spike>
- Commits clés du spike :
  - `c94baa0` scaffold initial
  - `849de0e` isolation `STREAMER_TWITCH_CLIENT_ID/SECRET`
  - `e68220d` retrait `clips:read`
