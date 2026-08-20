#!/usr/bin/env python3
"""Les plages autorisées à dire qui est le visiteur.

Lues depuis `client_ip.rs`, et non recopiées ici : le relais et Caddy doivent
avoir **une seule** notion de « nos propres portes ». Deux listes qui divergent,
c'est une faille qui s'ouvre le jour où l'une est mise à jour sans l'autre.

Sortie : un tableau JSON de CIDR, sur la sortie standard.
"""
import json
import re
import sys
from pathlib import Path

RUST = Path("/var/www/nexus/nodyx-p2p/crates/nexus-relay/src/client_ip.rs")

# Ce que `is_trusted_peer` accepte en plus des plages Cloudflare : nos propres
# machines. Un attaquant sur Internet ne peut pas émettre depuis ces adresses,
# donc les inclure n'ouvre rien.
LOCALES = [
    "127.0.0.0/8",
    "::1/128",
    "10.0.0.0/8",
    "172.16.0.0/12",
    "192.168.0.0/16",
    "fc00::/7",
    "fe80::/10",
]

# Une liste tronquée serait pire qu'une absence de filtre : `not remote_ip` sur
# un ensemble vide correspond à TOUT le trafic, donc Cloudflare y compris, et
# plus aucun visiteur ne serait identifié. On refuse plutôt que de dégrader.
MINIMUM_CLOUDFLARE = 20


def main() -> int:
    if not RUST.is_file():
        print(f"source introuvable : {RUST}", file=sys.stderr)
        return 1

    src = RUST.read_text()
    try:
        bloc = src.split("const CLOUDFLARE: &[Cidr] = &[")[1].split("];")[0]
    except IndexError:
        print("bloc CLOUDFLARE introuvable dans client_ip.rs", file=sys.stderr)
        return 1

    plages = []
    for a, b, c, d, p in re.findall(
        r"v4\((\d+),\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+)\)", bloc
    ):
        plages.append(f"{a}.{b}.{c}.{d}/{p}")

    for groupes, p in re.findall(r"v6\(\[([^\]]+)\],\s*(\d+)\)", bloc):
        mots = [m.strip() for m in groupes.split(",")]
        hextets = [
            f"{int(m, 16):x}" if m.startswith("0x") else f"{int(m):x}" for m in mots
        ]
        adresse = re.sub(r"(:0)+$", "::", ":".join(hextets))
        plages.append(f"{adresse}/{p}")

    if len(plages) < MINIMUM_CLOUDFLARE:
        print(
            f"seulement {len(plages)} plages Cloudflare lues, {MINIMUM_CLOUDFLARE} "
            "attendues au minimum. La lecture du Rust a échoué, on refuse de "
            "produire une liste tronquée.",
            file=sys.stderr,
        )
        return 1

    json.dump(plages + LOCALES, sys.stdout, indent=1)
    print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
