/**
 * OSINT Enrichment Service — Nodyx Security
 *
 * Enrichit automatiquement les IPs capturées par le honeypot via :
 *   - AbuseIPDB  → score d'abus, signalements, Tor/proxy
 *   - VirusTotal → détections antivirus, catégories
 *   - Shodan     → ports ouverts, vulnérabilités, OS (optionnel)
 *
 * Variables d'environnement :
 *   ABUSEIPDB_API_KEY   → clé API AbuseIPDB (gratuit : 1000 req/jour)
 *   VIRUSTOTAL_API_KEY  → clé API VirusTotal (gratuit : 500 req/jour)
 *   SHODAN_API_KEY      → clé API Shodan (optionnel — 1 req/jour free)
 */

import { redis } from '../config/database.js'

const OSINT_CACHE_TTL = 24 * 60 * 60  // 24 heures

// ── Interfaces ────────────────────────────────────────────────────────────────

export interface AbuseIPDBResult {
  score:         number         // 0-100 (100 = malveillant confirmé)
  totalReports:  number
  lastReported:  string | null
  isTor:         boolean
  isPublicProxy: boolean
  usageType:     string
  domain:        string
  isp:           string
  countryCode:   string
}

export interface VirusTotalResult {
  malicious:        number
  suspicious:       number
  harmless:         number
  undetected:       number
  categories:       string[]
  lastAnalysisDate: string | null
}

export interface ShodanResult {
  ports:      number[]
  hostnames:  string[]
  tags:       string[]
  vulns:      string[]
  os:         string | null
  lastUpdate: string | null
  org:        string | null
}

export interface ThreatFactor {
  label:   string
  points:  number
  detail?: string
}

export interface OSINTResult {
  ip:           string
  enriched_at:  string
  abuseipdb:    AbuseIPDBResult | null
  virustotal:   VirusTotalResult | null
  shodan:       ShodanResult | null
  threat_score: number                   // 0-100 calculé
  threat_level: 'low' | 'medium' | 'high' | 'critical'
  factors:      ThreatFactor[]           // détail par contributeur
  summary:      string
}

// ── AbuseIPDB ─────────────────────────────────────────────────────────────────

async function queryAbuseIPDB(ip: string): Promise<AbuseIPDBResult | null> {
  const key = process.env.ABUSEIPDB_API_KEY
  if (!key) return null

  try {
    const url = new URL('https://api.abuseipdb.com/api/v2/check')
    url.searchParams.set('ipAddress', ip)
    url.searchParams.set('maxAgeInDays', '90')

    const res = await fetch(url.toString(), {
      headers: { 'Key': key, 'Accept': 'application/json' },
      signal:  AbortSignal.timeout(6000),
    })
    if (!res.ok) return null

    const json = await res.json() as {
      data: {
        abuseConfidenceScore: number
        totalReports:         number
        lastReportedAt:       string | null
        isTor:                boolean
        isPublicProxy:        boolean
        usageType:            string
        domain:               string
        isp:                  string
        countryCode:          string
      }
    }
    const d = json.data
    return {
      score:         d.abuseConfidenceScore,
      totalReports:  d.totalReports,
      lastReported:  d.lastReportedAt,
      isTor:         d.isTor         ?? false,
      isPublicProxy: d.isPublicProxy ?? false,
      usageType:     d.usageType     || '—',
      domain:        d.domain        || '—',
      isp:           d.isp           || '—',
      countryCode:   d.countryCode   || '—',
    }
  } catch {
    return null
  }
}

// ── VirusTotal ────────────────────────────────────────────────────────────────

async function queryVirusTotal(ip: string): Promise<VirusTotalResult | null> {
  const key = process.env.VIRUSTOTAL_API_KEY
  if (!key) return null

  try {
    const res = await fetch(`https://www.virustotal.com/api/v3/ip_addresses/${ip}`, {
      headers: { 'x-apikey': key, 'Accept': 'application/json' },
      signal:  AbortSignal.timeout(8000),
    })
    if (!res.ok) return null

    const json = await res.json() as {
      data?: {
        attributes?: {
          last_analysis_stats?: {
            malicious?:  number
            suspicious?: number
            harmless?:   number
            undetected?: number
          }
          categories?:        Record<string, string>
          last_analysis_date?: number
        }
      }
    }

    const attrs = json.data?.attributes
    if (!attrs) return null

    const stats      = attrs.last_analysis_stats ?? {}
    const allCats    = attrs.categories ? Object.values(attrs.categories) : []
    const uniqueCats = [...new Set(allCats)].slice(0, 6)

    return {
      malicious:        stats.malicious  ?? 0,
      suspicious:       stats.suspicious ?? 0,
      harmless:         stats.harmless   ?? 0,
      undetected:       stats.undetected ?? 0,
      categories:       uniqueCats,
      lastAnalysisDate: attrs.last_analysis_date
        ? new Date(attrs.last_analysis_date * 1000).toISOString()
        : null,
    }
  } catch {
    return null
  }
}

// ── Shodan ────────────────────────────────────────────────────────────────────

async function queryShodan(ip: string): Promise<ShodanResult | null> {
  const key = process.env.SHODAN_API_KEY
  if (!key) return null

  try {
    const res = await fetch(`https://api.shodan.io/shodan/host/${encodeURIComponent(ip)}?key=${encodeURIComponent(key)}`, {
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return null

    const json = await res.json() as {
      ports?:       number[]
      hostnames?:   string[]
      tags?:        string[]
      vulns?:       string[]
      os?:          string | null
      last_update?: string
      org?:         string
    }

    return {
      ports:      json.ports      ?? [],
      hostnames:  json.hostnames  ?? [],
      tags:       json.tags       ?? [],
      vulns:      json.vulns      ?? [],
      os:         json.os         ?? null,
      lastUpdate: json.last_update ?? null,
      org:        json.org         ?? null,
    }
  } catch {
    return null
  }
}

// ── Score de menace ───────────────────────────────────────────────────────────

function computeThreatScore(
  abuse:      AbuseIPDBResult | null,
  vt:         VirusTotalResult | null,
  shodan:     ShodanResult | null,
  recurrence: number = 0,
): { score: number; factors: ThreatFactor[] } {
  const factors: ThreatFactor[] = []
  let score = 0

  if (abuse) {
    // Score AbuseIPDB : contribution principale (0-55 pts)
    const abuseContrib = Math.round(abuse.score * 0.55)
    if (abuseContrib > 0) {
      factors.push({
        label:  'Score AbuseIPDB',
        points: abuseContrib,
        detail: `${abuse.score}% de confiance — ${abuse.totalReports} signalement(s) sur 90 jours`,
      })
      score += abuseContrib
    }

    if (abuse.isTor) {
      factors.push({ label: 'Nœud Tor confirmé', points: 12 })
      score += 12
    }

    if (abuse.isPublicProxy) {
      factors.push({ label: 'Proxy public', points: 6 })
      score += 6
    }

    if (abuse.totalReports > 500) {
      factors.push({ label: 'Récidiviste massif (+500 signalements)', points: 10 })
      score += 10
    } else if (abuse.totalReports > 100) {
      factors.push({ label: 'Récidiviste (+100 signalements)', points: 5 })
      score += 5
    }

    const datacenterTypes = ['data center', 'web hosting', 'transit', 'content delivery network']
    if (datacenterTypes.some(t => (abuse.usageType ?? '').toLowerCase().includes(t))) {
      factors.push({ label: 'IP datacenter/hébergement', points: 10, detail: abuse.usageType })
      score += 10
    }
  }

  if (vt) {
    const total   = vt.malicious + vt.suspicious + vt.harmless + vt.undetected
    const vtScore = total > 0 ? ((vt.malicious + vt.suspicious * 0.5) / total) * 100 : 0
    const vtContrib = Math.round(vtScore * 0.35)
    if (vtContrib > 0) {
      factors.push({
        label:  'Détections VirusTotal',
        points: vtContrib,
        detail: `${vt.malicious} moteur(s) malveillant(s), ${vt.suspicious} suspect(s)`,
      })
      score += vtContrib
    }
  }

  if (shodan) {
    if (shodan.vulns.length > 3) {
      factors.push({
        label:  'CVEs critiques (Shodan)',
        points: 13,
        detail: shodan.vulns.slice(0, 5).join(', '),
      })
      score += 13
    } else if (shodan.vulns.length > 0) {
      factors.push({
        label:  'CVEs connues (Shodan)',
        points: 8,
        detail: shodan.vulns.join(', '),
      })
      score += 8
    }
    if (shodan.ports.length > 15) {
      factors.push({ label: 'Exposition réseau élevée (>15 ports ouverts)', points: 3 })
      score += 3
    }
  }

  // Récurrence honeypot
  if (recurrence >= 10) {
    factors.push({ label: `Récidiviste honeypot (${recurrence} visites)`, points: 10 })
    score += 10
  } else if (recurrence >= 3) {
    factors.push({ label: `Retour honeypot (${recurrence} visites)`, points: 5 })
    score += 5
  }

  return { score: Math.min(100, Math.round(score)), factors }
}

function buildSummary(
  score: number,
  abuse: AbuseIPDBResult | null,
  vt:    VirusTotalResult | null,
  shodan: ShodanResult | null,
): string {
  if (!abuse && !vt && !shodan) return 'Enrichissement OSINT non disponible (clés API non configurées).'

  const parts: string[] = []

  if (abuse) {
    if (abuse.score >= 80)      parts.push(`IP hautement malveillante — score AbuseIPDB ${abuse.score}%`)
    else if (abuse.score >= 50) parts.push(`IP très suspecte — score AbuseIPDB ${abuse.score}%`)
    else if (abuse.score >= 20) parts.push(`IP signalée — score AbuseIPDB ${abuse.score}%`)
    else                        parts.push(`IP faiblement signalée — score AbuseIPDB ${abuse.score}%`)

    if (abuse.totalReports > 0) parts.push(`${abuse.totalReports} signalement(s) sur 90 jours`)
    if (abuse.isTor)             parts.push('nœud Tor confirmé')
    if (abuse.isPublicProxy)     parts.push('proxy public')
  }

  if (vt && vt.malicious > 0) parts.push(`détectée par ${vt.malicious} moteur(s) antivirus`)
  if (shodan && shodan.vulns.length > 0) parts.push(`${shodan.vulns.length} CVE connue(s) sur l'hôte`)

  return parts.length > 0
    ? parts.join(' — ') + '.'
    : 'Aucun antécédent connu dans les bases OSINT consultées.'
}

// ── Export principal ──────────────────────────────────────────────────────────

export async function enrichIP(ip: string, recurrence = 0): Promise<OSINTResult> {
  const blank = (summary: string): OSINTResult => ({
    ip, enriched_at: new Date().toISOString(),
    abuseipdb: null, virustotal: null, shodan: null,
    threat_score: 0, threat_level: 'low', factors: [], summary,
  })

  if (!ip || ip.startsWith('127.') || ip.startsWith('10.') || ip === '::1') {
    return blank('IP locale — pas d\'enrichissement OSINT.')
  }

  // Cache Redis 24h — clé inclut la récurrence pour invalidation si elle change
  const cacheKey = `osint:${ip}`
  try {
    const cached = await redis.get(cacheKey)
    if (cached) {
      const parsed = JSON.parse(cached) as OSINTResult
      // Recalcul si la récurrence a augmenté depuis le cache
      if (recurrence > 0 && parsed.factors) {
        const prevRec = parsed.factors.find(f => f.label.includes('honeypot'))
        const prevCount = prevRec ? parseInt(prevRec.detail?.match(/\d+/)?.[0] ?? '0') : 0
        if (recurrence <= prevCount) return parsed
      } else {
        return parsed
      }
    }
  } catch { /* ignore */ }

  // Requêtes parallèles — ne bloque pas si une source est down
  const [abuse, vt, shodan] = await Promise.all([
    queryAbuseIPDB(ip),
    queryVirusTotal(ip),
    queryShodan(ip),
  ])

  const { score: threatScore, factors } = computeThreatScore(abuse, vt, shodan, recurrence)
  const threatLevel: OSINTResult['threat_level'] =
    threatScore >= 80 ? 'critical' :
    threatScore >= 50 ? 'high'     :
    threatScore >= 20 ? 'medium'   : 'low'

  const result: OSINTResult = {
    ip,
    enriched_at:  new Date().toISOString(),
    abuseipdb:    abuse,
    virustotal:   vt,
    shodan,
    threat_score: threatScore,
    threat_level: threatLevel,
    factors,
    summary:      buildSummary(threatScore, abuse, vt, shodan),
  }

  redis.setex(cacheKey, OSINT_CACHE_TTL, JSON.stringify(result)).catch(() => {})
  return result
}
