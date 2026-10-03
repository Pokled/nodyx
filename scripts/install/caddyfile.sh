#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
#  Caddyfile de Nodyx (installation standard) : génération et reconnaissance.
#  Chargé par install.sh après le clonage du dépôt (installation ET mise à
#  jour), et par scripts/tests/caddyfile.test.sh qui le fait valider et
#  tourner par un vrai Caddy.
#
#  ── L'IP du visiteur (correctif du 03/10/2026) ────────────────────────────────
#  L'ancien modèle retirait X-Forwarded-For (`header_up -X-Forwarded-For`) :
#  le core ne recevait AUCUNE IP et voyait tout Internet comme 127.0.0.1. La
#  limitation de débit générale se désactivait (son exemption « boucle locale
#  sans en-tête » couvrait tout le monde), celle des connexions devenait
#  commune à toute l'instance (5 connexions / 15 min pour tous), et un
#  CF-Connecting-IP forgé par le visiteur était cru en premier par le core.
#
#  Désormais Caddy calcule lui-même l'IP du visiteur ({client_ip}) et
#  ÉCRASE X-Forwarded-For et X-Real-IP avec elle ; CF-Connecting-IP n'est
#  jamais transmis. Rien de ce que le visiteur écrit dans ses en-têtes ne
#  peut donc se faire passer pour son adresse.
#   - domaine direct : Caddy est en bordure, {client_ip} = l'adresse TCP du
#     visiteur ;
#   - relais : le visiteur arrive par Cloudflare puis par le tunnel, que le
#     client relais livre depuis 127.0.0.1. On ne croit CF-Connecting-IP que
#     venant de là (trusted_proxies), jamais d'une autre machine du réseau.
# ═══════════════════════════════════════════════════════════════════════════════

# nodyx_caddyfile <direct|relay> <domaine> : écrit le Caddyfile sur la sortie.
nodyx_caddyfile() {
  local mode="$1" domain="$2" site hsts trust
  case "$mode" in
    direct)
      site="$domain"
      # HSTS seulement quand Caddy maîtrise le TLS de bout en bout.
      hsts='Strict-Transport-Security "max-age=31536000; includeSubDomains"'
      trust='' ;;
    relay)
      site=':80'
      hsts=''
      trust='trusted_proxies static 127.0.0.1/8 ::1/128
        client_ip_headers CF-Connecting-IP' ;;
    *) echo "nodyx_caddyfile: mode inconnu « $mode »" >&2; return 2 ;;
  esac
  [[ "$mode" == relay || -n "$domain" ]] || { echo "nodyx_caddyfile: domaine manquant" >&2; return 2; }

  cat <<CADDY
{
    servers {
        ${trust}
        # Cap header size so slow-header DoS can't keep workers busy. 16KB
        # comfortably fits cookies + Authorization (JWT ~500B) + proxy chain.
        max_header_size 16KB
    }
}

(security_headers) {
    header {
        X-Content-Type-Options    "nosniff"
        X-Frame-Options           "SAMEORIGIN"
        Referrer-Policy           "strict-origin-when-cross-origin"
        Permissions-Policy        "camera=(self), microphone=(self), geolocation=(self)"
        Content-Security-Policy   "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; media-src 'self' blob:; font-src 'self' data:; connect-src 'self' wss: https:; frame-src https://www.youtube.com https://www.youtube-nocookie.com https://player.vimeo.com https://geo.dailymotion.com https://player.twitch.tv https://clips.twitch.tv https://w.soundcloud.com https://open.spotify.com; object-src 'none'; base-uri 'self'; form-action 'self';"
        ${hsts}
        -Server
    }
}

# IP du visiteur : calculée par Caddy, jamais recopiée de la requête.
(client_ip) {
    header_up X-Forwarded-For {client_ip}
    header_up X-Real-IP {client_ip}
    header_up -CF-Connecting-IP
}

(proxy_backend) {
    reverse_proxy 127.0.0.1:3000 {
        import client_ip
        # 5s dial is huge for loopback; 30s response_header covers Socket.IO
        # long-poll without cutting WebSocket upgrades short.
        transport http {
            dial_timeout 5s
            response_header_timeout 30s
        }
    }
}

(proxy_frontend) {
    reverse_proxy 127.0.0.1:4173 {
        import client_ip
        transport http {
            dial_timeout 5s
            response_header_timeout 30s
        }
    }
}

${site} {
    encode gzip

    import security_headers

    @honeypot path_regexp hp ^/(\.env|\.env\.|\.git/|\.htaccess|\.htpasswd|wp-admin|wp-login\.php|wp-config\.php|xmlrpc\.php|phpmyadmin|pma/|adminer|myadmin|shell\.php|cmd\.php|c99\.php|r57\.php|webshell|config\.php|configuration\.php|web\.config|settings\.php|backup\.sql|dump\.sql|db\.sql|database\.sql|install\.php|setup\.php|installer|console|manager/|administrator|eval\.php|debug|id_rsa|credentials|config\.json|database\.yml|\.aws|\.ssh)
    handle @honeypot {
        rewrite * /api/v1/_hp?p={http.request.uri.path}
        import proxy_backend
    }

    handle /api/* {
        import proxy_backend
    }
    handle /uploads/* {
        import proxy_backend
    }
    handle /socket.io/* {
        import proxy_backend
    }

    handle {
        import proxy_frontend
    }
}
CADDY
}

# nodyx_caddy_sites <fichier> : adresses des sites de premier niveau (sans le
# bloc global ni les fragments « (nom) »), une par ligne.
nodyx_caddy_sites() {
  [[ -f "$1" ]] || return 0
  awk '
    { line=$0; sub(/#.*/, "", line) }
    depth==0 && line ~ /\{[[:space:]]*$/ {
      head=line; sub(/\{[[:space:]]*$/, "", head); gsub(/^[[:space:]]+|[[:space:]]+$/, "", head)
      if (head != "" && head !~ /^\(/) { n=split(head, a, /[ ,]+/); for (i=1;i<=n;i++) if (a[i]!="") print a[i] }
    }
    { o=gsub(/\{/, "{", line); c=gsub(/\}/, "}", line); depth+=o-c }
  ' "$1"
}

# nodyx_caddyfile_is_ours <fichier> <domaine> : vrai si le fichier ne sert QUE
# Nodyx (son domaine, ou :80 en mode relais). Faux s'il contient d'autres sites :
# on ne le réécrit alors jamais automatiquement.
nodyx_caddyfile_is_ours() {
  local file="$1" domain="$2" s h found=false
  while read -r s; do
    [[ -z "$s" ]] && continue
    h="${s#http://}"; h="${h#https://}"
    [[ "$h" == ":80" || ( -n "$domain" && "$h" == "$domain" ) ]] || return 1
    found=true
  done < <(nodyx_caddy_sites "$file")
  $found
}

# nodyx_caddyfile_needs_ip_fix <fichier> : vrai si le Caddyfile porte encore
# l'ancien réglage qui privait le core de l'IP du visiteur.
nodyx_caddyfile_needs_ip_fix() {
  [[ -f "$1" ]] && grep -qE '^[[:space:]]*header_up[[:space:]]+-X-Forwarded-For[[:space:]]*$' "$1"
}

# ── Migration des installations existantes ────────────────────────────────────
# nodyx_migrate_client_ip <dossier-nodyx>
# Appelée par `install.sh --upgrade|--repair` et par nodyx-update. Idempotente :
# ne fait rien de ce qui est déjà en place. Ne réécrit le Caddyfile que s'il ne
# sert QUE Nodyx ; sinon, elle explique la modification à faire à la main.
# Variables d'environnement (pour les tests) : NODYX_CADDYFILE (défaut
# /etc/caddy/Caddyfile), NODYX_CADDY_RELOAD (défaut « systemctl reload caddy »).
_nx_msg() { case "${NODYX_LANG:-${LANG:-}}" in fr*) printf '%s\n' "$1" ;; *) printf '%s\n' "$2" ;; esac; }

nodyx_migrate_client_ip() {
  local dir="$1" env="$1/nodyx-core/.env" eco="$1/ecosystem.config.js"
  local cf="${NODYX_CADDYFILE:-/etc/caddy/Caddyfile}" reload="${NODYX_CADDY_RELOAD:-systemctl reload caddy}"
  local secret domain mode new bak

  [[ -f "$env" ]] || { _nx_msg "  ⚠  $env introuvable : migration de l'IP visiteur ignorée" "  ⚠  $env not found: visitor IP migration skipped"; return 0; }

  # 1. Secret partagé frontend <-> core (appels internes du rendu serveur).
  secret="$(grep -m1 '^INTERNAL_API_SECRET=' "$env" | cut -d= -f2- || true)"
  if [[ -z "$secret" ]]; then
    secret="$(openssl rand -hex 32)"
    printf '\n# Secret partagé frontend <-> core (appels internes du rendu serveur)\nINTERNAL_API_SECRET=%s\n' "$secret" >> "$env"
    _nx_msg "  ✔  Secret interne frontend <-> core ajouté" "  ✔  Internal frontend <-> core secret added"
  fi

  # 2. ecosystem.config.js : le frontend reçoit le secret et l'IP du visiteur.
  if [[ -f "$eco" ]] && ! grep -q 'INTERNAL_API_SECRET' "$eco"; then
    cp -p "$eco" "$eco.avant-ip-visiteur"
    sed -i -E "s#(PRIVATE_API_SSR_URL: '[^']*')( \},)#\1, INTERNAL_API_SECRET: '${secret}', ADDRESS_HEADER: 'x-forwarded-for', XFF_DEPTH: '1'\2#" "$eco"
    if node -e "
      const a = require(process.argv[1]).apps.find(x => x.name === 'nodyx-frontend')
      process.exit(a && a.env.INTERNAL_API_SECRET === process.argv[2] && a.env.ADDRESS_HEADER === 'x-forwarded-for' ? 0 : 1)" "$eco" "$secret" 2>/dev/null; then
      rm -f "$eco.avant-ip-visiteur"
      _nx_msg "  ✔  ecosystem.config.js : le frontend reçoit l'IP du visiteur" "  ✔  ecosystem.config.js: the frontend now receives the visitor IP"
    else
      mv -f "$eco.avant-ip-visiteur" "$eco"
      _nx_msg "  ⚠  ecosystem.config.js de forme inattendue : laissé tel quel. Ajoute à l'env de nodyx-frontend : INTERNAL_API_SECRET (même valeur que nodyx-core/.env), ADDRESS_HEADER: 'x-forwarded-for', XFF_DEPTH: '1'" \
              "  ⚠  Unexpected ecosystem.config.js layout: left as is. Add to the nodyx-frontend env: INTERNAL_API_SECRET (same value as nodyx-core/.env), ADDRESS_HEADER: 'x-forwarded-for', XFF_DEPTH: '1'"
    fi
  fi

  # 3. Fichiers de secrets : jamais lisibles par les autres utilisateurs.
  chmod o-rwx "$env" "$eco" "$dir/nodyx-frontend/.env" 2>/dev/null || true

  # 4. Caddyfile.
  nodyx_caddyfile_needs_ip_fix "$cf" || return 0
  if [[ "$cf" == /etc/caddy/Caddyfile ]] && command -v systemctl >/dev/null && systemctl cat caddy 2>/dev/null | grep -q -- '--resume'; then
    _nx_msg "  ⚠  Caddy tourne avec une configuration sauvegardée (--resume) : Caddyfile non modifié." "  ⚠  Caddy runs from a saved configuration (--resume): Caddyfile not modified."
    return 0
  fi
  domain="$(grep -m1 '^FRONTEND_URL=' "$env" | cut -d= -f2- | sed -E 's#^[a-z]+://##; s#[/:].*$##')"
  if ! nodyx_caddyfile_is_ours "$cf" "$domain"; then
    _nx_msg "  ⚠  Ton Caddyfile cache encore l'IP des visiteurs à Nodyx (limitation de débit inopérante), mais il sert d'autres sites : il n'a pas été réécrit. Dans chaque reverse_proxy vers Nodyx (ports 3000 et 4173), remplace « header_up -X-Forwarded-For » par ces trois lignes : « header_up X-Forwarded-For {client_ip} », « header_up X-Real-IP {client_ip} », « header_up -CF-Connecting-IP », puis : sudo systemctl reload caddy" \
            "  ⚠  Your Caddyfile still hides visitor IPs from Nodyx (rate limiting ineffective), but it serves other sites: it was not rewritten. In every reverse_proxy to Nodyx (ports 3000 and 4173), replace \"header_up -X-Forwarded-For\" with these three lines: \"header_up X-Forwarded-For {client_ip}\", \"header_up X-Real-IP {client_ip}\", \"header_up -CF-Connecting-IP\", then: sudo systemctl reload caddy"
    return 0
  fi
  if nodyx_caddy_sites "$cf" | grep -qx ':80'; then mode=relay; else mode=direct; fi
  new="$(mktemp "$(dirname "$cf")/.Caddyfile.nodyx.XXXXXX")"
  nodyx_caddyfile "$mode" "$domain" > "$new"
  if ! caddy validate --config "$new" --adapter caddyfile >/dev/null 2>&1; then
    rm -f "$new"
    _nx_msg "  ✘  Nouveau Caddyfile refusé par caddy validate : l'actuel est conservé. Signale-le : https://github.com/Pokled/nodyx/issues" \
            "  ✘  New Caddyfile rejected by caddy validate: the current one is kept. Please report it: https://github.com/Pokled/nodyx/issues"
    return 1
  fi
  bak="$cf.avant-ip-visiteur-$(date +%Y%m%d-%H%M%S)"
  cp -p "$cf" "$bak"
  install -m 644 "$new" "$cf"; rm -f "$new"
  if $reload >/dev/null 2>&1; then
    _nx_msg "  ✔  Caddyfile mis à jour : l'IP des visiteurs parvient à Nodyx (limitation de débit et bannissements opérationnels). Ancien fichier : $bak" \
            "  ✔  Caddyfile updated: visitor IPs now reach Nodyx (rate limiting and bans work). Previous file: $bak"
  else
    cp -p "$bak" "$cf"; $reload >/dev/null 2>&1 || true
    _nx_msg "  ✘  Caddy n'a pas accepté le rechargement : ancien Caddyfile remis en place." "  ✘  Caddy refused the reload: previous Caddyfile restored."
    return 1
  fi
}
