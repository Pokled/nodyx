// ─── Garde anti-SSRF partagée ────────────────────────────────────────────────
//
// Avant ce fichier (trouvé en audit de stabilité, F-055, 2026-09-11) : trois
// implémentations indépendantes de la détection d'IP privée existaient
// (chat.ts, linkPreview.ts, directory.ts), déjà divergées entre elles. La
// version de directory.ts (validation des URLs d'instances fédérées, la
// surface la plus exposée puisqu'alimentée par d'autres instances) était la
// SEULE des trois à ne faire aucune résolution DNS : elle jugeait la chaîne du
// hostname littéral, jamais l'adresse réellement résolue. Un domaine qui
// pointe vers une IP privée au moment de la connexion (DNS rebinding) passait
// donc la validation, alors que chat.ts s'en protège explicitement depuis
// l'incident qui l'a fait naître.
//
// Ce module consolide sur la version la plus complète (chat.ts : IPv4-mappé-
// IPv6 en notation décimale ET hexadécimale, IPv6 ULA/link-local/documentation)
// et y ajoute le seul contrôle que linkPreview.ts avait en plus
// (multicast/réservé, a >= 224).

import dns from 'dns/promises'
import net from 'net'

/** Une adresse IP (v4 ou v6) est-elle privée, loopback, link-local ou réservée ? */
export function isPrivateIp(ip: string): boolean {
  // IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1 or ::ffff:7f00:1) — bypass critique
  const mapped4 = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)
  if (mapped4) return isPrivateIp(mapped4[1])
  // IPv4-in-IPv6 hex notation (e.g. ::ffff:7f00:0001 = 127.0.0.1)
  const mapped4hex = ip.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i)
  if (mapped4hex) {
    const a = parseInt(mapped4hex[1], 16)
    const b = parseInt(mapped4hex[2], 16)
    const ipv4 = `${(a >> 8) & 0xff}.${a & 0xff}.${(b >> 8) & 0xff}.${b & 0xff}`
    return isPrivateIp(ipv4)
  }

  // IPv6 loopback, ULA, link-local, plage de documentation
  if (ip === '::1' || ip === '::') return true
  if (ip.startsWith('fc') || ip.startsWith('fd')) return true  // fc00::/7 (ULA)
  if (ip.startsWith('fe80')) return true                        // link-local
  if (ip.startsWith('2001:db8')) return true                    // documentation (RFC 3849)

  // IPv4
  if (!net.isIPv4(ip)) return false
  const parts = ip.split('.').map(Number)
  const [a, b] = parts
  return (
    a === 10 ||                          // 10.0.0.0/8
    a === 127 ||                         // 127.0.0.0/8 loopback
    a === 0 ||                           // 0.0.0.0/8
    (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12
    (a === 192 && b === 168) ||          // 192.168.0.0/16
    (a === 169 && b === 254) ||          // 169.254.0.0/16 link-local (cloud metadata)
    (a === 100 && b >= 64 && b <= 127) || // 100.64.0.0/10 shared address space (CGNAT)
    a >= 224                             // multicast (224-239) + réservé (240-255)
  )
}

/**
 * Résout le hostname UNE FOIS et retourne l'IP résolue si sûre, null sinon.
 * On retourne l'IP pour que l'appelant l'utilise directement pour la
 * connexion (anti-DNS-rebinding) : re-résoudre plus tard laisserait le temps
 * à un attaquant de changer la réponse DNS entre la vérification et l'usage.
 */
export async function resolveSsrfSafe(hostname: string): Promise<string | null> {
  // Adresse IP directe — valider sans DNS
  if (net.isIP(hostname)) return isPrivateIp(hostname) ? null : hostname
  try {
    const { address } = await dns.lookup(hostname)
    return isPrivateIp(address) ? null : address
  } catch {
    return null
  }
}
