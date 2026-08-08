// ─── Qui a le droit d'écrire l'adresse du visiteur ? ─────────────────────────
//
// Le cœur tourne derrière au moins un proxy (Caddy), souvent deux (Cloudflare +
// Caddy). Chaque proxy ajoute une ligne à X-Forwarded-For. Mais le visiteur
// peut PRÉ-écrire de fausses lignes avant que ça n'atteigne le premier proxy.
//
// Fastify calcule `request.ip` en remontant X-Forwarded-For tant que chaque
// hop est un proxy DE CONFIANCE, et s'arrête à la première adresse qui ne l'est
// pas : c'est le vrai visiteur. Tout ce qui est à sa gauche (les fausses lignes
// de l'attaquant) est ignoré.
//
// Donc la sécurité de request.ip = la justesse de cette liste de confiance.
// `trustProxy: true` (l'ancien réglage) faisait confiance à TOUT LE MONDE, y
// compris à l'attaquant : request.ip devenait la valeur la plus à gauche, qu'il
// contrôlait. C'est ce qui permettait d'usurper 127.0.0.1 et de désactiver la
// limitation de débit.
//
// La liste ci-dessous ne fait confiance qu'aux proxys légitimes :
//   - loopback / plages privées : Caddy et tout proxy interne sur la machine
//   - plages Cloudflare : quand l'instance est derrière Cloudflare (nodyx.org)
//
// La MÊME liste marche pour une instance self-host SANS Cloudflare : les plages
// Cloudflare n'y apparaissent jamais dans la chaîne, donc elles ne sautent
// jamais rien à tort. Zéro réglage par instance dans le cas courant.

// Plages IP publiées par Cloudflare (https://www.cloudflare.com/ips/).
// Stables, changent rarement. À rafraîchir si Cloudflare publie de nouvelles
// plages ; un edge non listé serait traité comme un visiteur (sur-limitation
// d'un sous-ensemble d'utilisateurs, jamais une faille de sécurité).
// Relevé : 2026-08-08.
const CLOUDFLARE_RANGES = [
  '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22',
  '141.101.64.0/18', '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20',
  '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13',
  '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22',
  '2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32',
  '2405:8100::/32', '2a06:98c0::/29', '2c0f:f248::/32',
]

// Proxys locaux (Caddy en loopback, éventuel proxy interne en plage privée).
// Noms spéciaux compris par proxy-addr (le moteur derrière Fastify trustProxy).
const LOCAL_RANGES = ['loopback', 'linklocal', 'uniquelocal']

/**
 * Valeur à passer à `Fastify({ trustProxy })`.
 *
 * Réglages d'échappatoire, pour les topologies non prévues (autre CDN, proxy
 * maison en frontal) :
 *   - TRUST_PROXY            : override COMPLET. 'true'/'false', un nombre de
 *                              hops, ou une liste d'IP/CIDR séparée par virgules.
 *   - TRUSTED_PROXIES_EXTRA  : CIDR supplémentaires à AJOUTER à la liste par
 *                              défaut (ex: l'IP d'un reverse proxy en amont).
 */
export function getTrustProxy(): boolean | number | string[] {
  const override = process.env.TRUST_PROXY?.trim()
  if (override) {
    if (override === 'true')  return true
    if (override === 'false') return false
    const n = Number(override)
    if (Number.isInteger(n) && n >= 0) return n
    return override.split(',').map((s) => s.trim()).filter(Boolean)
  }

  const extra = (process.env.TRUSTED_PROXIES_EXTRA ?? '')
    .split(',').map((s) => s.trim()).filter(Boolean)

  return [...LOCAL_RANGES, ...CLOUDFLARE_RANGES, ...extra]
}
