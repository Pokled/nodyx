#!/usr/bin/env bash
# Laisse passer le CSP a nonce que SvelteKit genere deja correctement, au lieu
# de le remplacer par un `unsafe-inline` statique.
#
# Ce que ce script corrige, precisement :
#
#   nodyx-frontend genere un CSP par requete, avec un nonce different a chaque
#   fois : `script-src 'self' ... 'nonce-XXXX'`, sans unsafe-inline. Verifie en
#   direct sur le port du backend, avant Caddy.
#
#   Caddy pose ensuite son PROPRE en-tete Content-Security-Policy, statique,
#   AVEC unsafe-inline, sur les hotes SvelteKit. `response.set` avec
#   `deferred: true` REMPLACE ce que le backend a envoye, il ne complete pas :
#   le nonce du backend est simplement jete, unsafe-inline s'applique sans
#   condition.
#
# Le meme bloc pose aussi HSTS, X-Frame-Options, Referrer-Policy,
# Permissions-Policy, X-Content-Type-Options, et retire l'en-tete Server. Ces
# cinq-la sont de bonnes protections independantes du backend : on ne les
# touche PAS. Seule la cle Content-Security-Policy est retiree de la carte
# `set`, via un DELETE cible sur le chemin JSON exact. Caddy, prive de cette
# cle, laisse alors passer telle quelle la valeur du backend.
#
# Portee volontairement limitee aux QUATRE hotes SvelteKit prouves emettre leur
# propre CSP a nonce : nodyx.org, demo, sleemstudio, vieuxlooters. olympus,
# signet, library et extensions gardent le CSP statique de Caddy, qui reste
# aujourd'hui leur SEULE protection : leur backend ne pose rien du tout
# (verifie sur nodyx-hub:7777, aucun en-tete Content-Security-Policy en
# reponse). Y toucher demanderait une verification separee, hote par hote.
set -euo pipefail

API="${CADDY_API:-http://localhost:2019}"
SAUVE="${CADDY_SAUVE:-/var/backups/nodyx/caddy}"
ICI="$(cd "$(dirname "$0")" && pwd)"

HOTES_SVELTEKIT=(nodyx.org demo.nodyx.org sleemstudio.nodyx.org vieuxlooters.nodyx.org)

# Retrouve le chemin JSON exact du bloc CSP pour un hote, quel que soit
# l'index de sa route : les index peuvent avoir bouge depuis la derniere fois.
chemin_pour() {
  local hote="$1"
  curl -sf -m 15 "$API/config/apps/http/servers/srv1/routes" | python3 -c "
import json, sys
routes = json.load(sys.stdin)
hote = '$hote'
for i, r in enumerate(routes):
    hotes = {h for m in r.get('match', []) for h in m.get('host', [])}
    if hote not in hotes: continue
    for hi, h in enumerate(r.get('handle', [])):
        if h.get('handler') != 'subroute': continue
        for j, sr in enumerate(h.get('routes', [])):
            for hhi, hh in enumerate(sr.get('handle', [])):
                if hh.get('handler') == 'headers' and 'Content-Security-Policy' in (hh.get('response') or {}).get('set', {}):
                    print(f'apps/http/servers/srv1/routes/{i}/handle/{hi}/routes/{j}/handle/{hhi}/response/set/Content-Security-Policy')
                    sys.exit(0)
sys.exit(1)
"
}

echo "=== 0. le correctif est-il deja pose ? ==="
DEJA=true
for h in "${HOTES_SVELTEKIT[@]}"; do
  chemin_pour "$h" >/dev/null 2>&1 && DEJA=false
done
if $DEJA; then
  echo "  Deja pose sur les 4 hotes. Rien a faire."
  echo "  Pour revenir a l'ancien CSP statique : $ICI/annuler-csp-nonce.sh"
  exit 0
fi

echo
echo "=== 1. sauvegarde prealable ==="
"$ICI/sauvegarder.sh" "$SAUVE"

echo
echo "=== 2. releves de reference ==="
"$ICI/verifier.sh" --releve > /dev/null && echo "  domaine : releve pris"
"$ICI/verifier-identification.sh" | tail -1 | sed 's/^/  identification avant : /'

echo
echo "=== 3. retrait cible de la cle CSP, hote par hote ==="
for h in "${HOTES_SVELTEKIT[@]}"; do
  CHEMIN=$(chemin_pour "$h") || { echo "  $h : bloc CSP introuvable, deja retire ou route inattendue, on saute" ; continue; }
  curl -sf -X DELETE "$API/config/$CHEMIN" \
    && echo "  $h : cle Content-Security-Policy retiree" \
    || { echo "  $h : ECHEC du retrait, configuration en cours intacte pour cet hote" >&2; exit 1; }
done

echo
echo "=== 4. verification : le nonce passe-t-il vraiment ? ==="
sleep 2
ECHEC=0
for h in "${HOTES_SVELTEKIT[@]}"; do
  ENTETE=$(curl -sI -m 10 "https://$h/" | grep -i '^content-security-policy:' || echo "")
  if echo "$ENTETE" | grep -q "'nonce-" && ! echo "$ENTETE" | grep -q "script-src[^;]*unsafe-inline"; then
    echo "  ok        $h : nonce present, script-src sans unsafe-inline"
  else
    echo "  ECHEC     $h : toujours pas de nonce propre"
    ECHEC=1
  fi
done

"$ICI/verifier.sh" | tail -2 | sed 's/^/  /' || ECHEC=1
"$ICI/verifier-identification.sh" | tail -1 | sed 's/^/  /' || ECHEC=1

if [ "$ECHEC" -ne 0 ]; then
  echo
  echo "!!! ECART DETECTE, retour arriere automatique !!!" >&2
  "$ICI/annuler-csp-nonce.sh"
  exit 1
fi

echo
echo "Pour revenir a l'ancien CSP statique : $ICI/annuler-csp-nonce.sh"
