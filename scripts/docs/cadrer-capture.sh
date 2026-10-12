#!/usr/bin/env bash
# Habille une capture d'écran pour la vitrine (README, nodyx.dev) :
# 1600 px de large, coins arrondis, fin liseré, ombre douce sur fond transparent,
# WebP. Lisible sur les thèmes clair et sombre de GitHub. Les captures sources
# se prennent à 1440×900 en rendu ×2, colonne des membres repliée (aucun pseudo
# de membre réel dans la vitrine).
#
# Exemple : scripts/docs/cadrer-capture.sh accueil.png docs/img/vitrine/home.webp
set -euo pipefail
in=$1 out=$2 hmax=${3:-0}   # hmax : recadre en hauteur (0 = garder tout)
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
convert "$in" -resize 1600x "$tmp/a.png"
if [ "$hmax" -gt 0 ]; then convert "$tmp/a.png" -gravity north -crop "1600x${hmax}+0+0" +repage "$tmp/a.png"; fi
read -r W H < <(identify -format '%w %h\n' "$tmp/a.png")
R=18
convert "$tmp/a.png" \( -size "${W}x${H}" xc:none -fill white -draw "roundrectangle 0,0,$((W-1)),$((H-1)),$R,$R" \) \
  -alpha set -compose DstIn -composite "$tmp/r.png"
# Fin liseré clair : sépare la capture du fond sur un README en thème sombre.
convert "$tmp/r.png" -fill none -stroke 'rgba(255,255,255,0.10)' -strokewidth 2 \
  -draw "roundrectangle 1,1,$((W-2)),$((H-2)),$R,$R" "$tmp/r.png"
convert "$tmp/r.png" \( +clone -background 'rgba(0,0,0,0.55)' -shadow 60x22+0+14 \) +swap \
  -background none -layers merge +repage "$tmp/s.png"
convert "$tmp/s.png" -quality 88 -define webp:method=6 -define webp:alpha-quality=90 "$out"
