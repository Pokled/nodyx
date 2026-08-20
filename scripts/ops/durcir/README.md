# Réduire ce qui est joignable depuis Internet

Un service qui écoute sur `0.0.0.0` derrière un mandataire local n'a **qu'une**
ligne de défense : la règle de pare-feu. Une seule erreur dans cette règle et
l'API est publiée. Le faire écouter sur `127.0.0.1` en pose une seconde, dans le
noyau, que personne ne peut contourner par une faute de frappe.

## Ce qui a été fermé le 20 août 2026

| service | port | avant | après |
|---|---|---|---|
| `nodyx-core` | 3000 | `0.0.0.0` | `127.0.0.1` |
| `demo-core` | 3001 | `0.0.0.0` | `127.0.0.1` |
| Caddy `srv0` | 3099 | `:3099` | `127.0.0.1:3099` |
| `nodyx-server` | 3100 | codé en dur `0.0.0.0` | `127.0.0.1` par défaut |

`sleemstudio-core` (3002) et `vieuxlooters-core` (3003) étaient déjà en loopback :
leur `.env` portait `HOST=127.0.0.1`. C'est ce mécanisme qui a été appliqué aux
deux autres, pas un nouveau.

Restent publics, et c'est voulu : `22` (administration), `80` et `443` (Caddy),
`3478` plus la plage relais `49152:65535/udp` (TURN), `7443` (porte historique du
tunnel), `40000:40999` (médias du SFU).

## Comment chaque service décide

- **`nodyx-core`** : `HOST` dans son `.env`, lu par `src/index.ts`
  (`process.env.HOST || '0.0.0.0'`). Le défaut du code reste `0.0.0.0`, mais
  `install.sh` écrit désormais `HOST=127.0.0.1` pour toute nouvelle instance.
- **Caddy `srv0`** : `caddy-srv0-loopback.sh`, avec `--annuler` pour revenir.
- **`nodyx-server`** : `DIRECTORY_HOST`, du même acabit que `DIRECTORY_PORT`.
  **Le défaut est le loopback**, et une valeur illisible y retombe aussi : une
  faute de frappe doit fermer une porte, jamais en ouvrir une.

## Le fil rouge

`verifier-services.sh` sonde ce que les visiteurs utilisent réellement : chaque
site, son API, la poignée de main Socket.IO, et le tunnel. Regarder `ss` ne
suffirait pas : un service peut écouter au bon endroit sans être joignable par
Caddy.

```bash
./verifier-services.sh --releve   # avant de toucher à quoi que ce soit
./verifier-services.sh            # après
```

Les adresses d'écoute sont affichées pour mémoire mais **jamais comparées** :
les changer est le but, les voir bouger n'est pas une panne.

Retours arrière :

```bash
./caddy-srv0-loopback.sh --annuler          # Caddy srv0
./ufw-restaurer.sh                          # règles de pare-feu
# un .env : les copies datées sont dans /var/backups/nodyx/durcir/
```

`ufw-restaurer.sh` **refuse** une sauvegarde qui ne contiendrait aucune règle
pour le port 22 : restaurer ça transformerait un incident en perte d'accès.

## Consolidation du pare-feu

Cinq règles retirées, de 23 à 18.

**Quatre règles pour le port 5349** (TURN TLS, v4 et v6, TCP et UDP) : rien
n'écoute derrière. Elles ouvraient un port mort.

**Une règle `DENY` sur `2a06:98c0:3600::103`**, posée contre un scanner
WordPress. Elle était **inerte** : dans la chaîne `ip6tables`, l'`ACCEPT` du port
443 est en ligne 5 et ce `DROP` en ligne 13. La première règle qui correspond
gagne, donc le trafic web de cette adresse était accepté bien avant que le
blocage soit évalué.

Vérifié en base : ce scanner n'a **jamais cessé**, 20 à 32 coups par jour, tous
les jours, y compris le jour de ce constat. La règle rassurait sans protéger.

Elle n'a pas été « réparée » en la remontant en tête. L'adresse appartient à
`2a06:98c0::/29`, une plage Cloudflare : un blocage au niveau réseau ne lit pas
les en-têtes et couperait aussi les visiteurs légitimes routés par cette arête.
Un scanner qui frappe des chemins de pot de miel est du bruit que le pot de miel
est fait pour enregistrer, pas une raison de risquer une coupure silencieuse.

**Ce qui n'a pas été touché.** La plage `49152:65535/udp` semble énorme, mais
elle est réellement utilisée : 44 sockets alloués au moment de la mesure, et
c'est le défaut du code (`TURN_MIN_PORT` / `TURN_MAX_PORT`). La resserrer
risquerait l'épuisement d'allocation, donc des appels coupés, pour un gain de
sécurité faible : rien n'écoute sur ces ports en dehors d'une allocation vivante,
elle-même protégée par l'authentification TURN.
