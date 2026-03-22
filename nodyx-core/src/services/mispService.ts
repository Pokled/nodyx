/**
 * MISP Integration — Nodyx Security
 *
 * Publie automatiquement les incidents honeypot vers une instance MISP
 * (Malware Information Sharing Platform) compatible CERT-FR / Europol / Interpol.
 *
 * Variables d'environnement requises :
 *   MISP_URL      → https://misp.votre-instance.fr
 *   MISP_API_KEY  → clé API MISP (Automation key)
 *   MISP_ORG_ID   → ID de votre organisation dans MISP (défaut: 1)
 *   MISP_DISTRIBUTION → 0=org seulement, 1=communauté, 3=toutes (défaut: 0)
 */

// ── Types MISP ──────────────────────────────────────────────────────────────

type MISPDistribution = 0 | 1 | 2 | 3 | 4  // 0=org, 1=community, 2=connected, 3=all, 4=sharing-group
type MISPThreatLevel  = 1 | 2 | 3 | 4       // 1=High, 2=Medium, 3=Low, 4=Undefined
type MISPAnalysis     = 0 | 1 | 2            // 0=Initial, 1=Ongoing, 2=Complete
type TLPTAG           = 'tlp:red' | 'tlp:amber' | 'tlp:green' | 'tlp:white' | 'tlp:clear'

export interface MISPAttribute {
  type:     string
  category: string
  value:    string
  comment?: string
  to_ids?:  boolean   // true = utilisé pour détection automatique (IDS)
}

export interface MISPEventPayload {
  info:             string
  distribution:     MISPDistribution
  threat_level_id:  MISPThreatLevel
  analysis:         MISPAnalysis
  date:             string            // YYYY-MM-DD
  Attribute:        MISPAttribute[]
  Tag?:             { name: string }[]
}

// ── Résultat MISP ─────────────────────────────────────────────────────────

export interface MISPResult {
  ok:       boolean
  event_id?: string
  uuid?:     string
  error?:    string
}

// ── Création d'un event MISP ──────────────────────────────────────────────

export async function pushToMISP(payload: MISPEventPayload): Promise<MISPResult> {
  const mispUrl = process.env.MISP_URL
  const apiKey  = process.env.MISP_API_KEY

  if (!mispUrl || !apiKey) return { ok: false, error: 'MISP non configuré' }

  try {
    const res = await fetch(`${mispUrl}/events`, {
      method:  'POST',
      headers: {
        'Authorization': apiKey,
        'Content-Type':  'application/json',
        'Accept':        'application/json',
      },
      body: JSON.stringify({ Event: payload }),
      signal: AbortSignal.timeout(8000),
    })

    if (!res.ok) {
      const txt = await res.text().catch(() => '')
      return { ok: false, error: `HTTP ${res.status}: ${txt.slice(0, 200)}` }
    }

    const json = await res.json() as { Event?: { id: string; uuid: string } }
    return {
      ok:       true,
      event_id: json.Event?.id,
      uuid:     json.Event?.uuid,
    }
  } catch (err: any) {
    return { ok: false, error: err?.message || 'fetch error' }
  }
}

// ── Constructeur d'event honeypot ─────────────────────────────────────────

export interface HoneypotIncident {
  incidentId:   string
  ip:           string
  path:         string
  method:       string
  userAgent:    string
  country:      string
  city:         string
  isp:          string
  timezone:     string
  proxy:        boolean
  hosting:      boolean
  // Fingerprint enrichi
  gpuRenderer?: string
  browserTz?:   string
  languages?:   string
  canvasFp?:    string
  audioFp?:     string
  // Type d'incident
  incidentType: 'scan' | 'canary' | 'credential_harvest' | 'honeytoken' | 'fingerprint_recurrence'
  // Credential harvest
  username?:    string
  // Recurrence
  fpVisits?:    number
  knownIps?:    string[]
}

export function buildHoneypotMISPEvent(incident: HoneypotIncident): MISPEventPayload {
  const dist  = parseInt(process.env.MISP_DISTRIBUTION || '0') as MISPDistribution
  const orgId = process.env.MISP_ORG_ID || '1'
  const date  = new Date().toISOString().slice(0, 10)

  // Niveau de menace selon le type
  const threatMap: Record<string, MISPThreatLevel> = {
    scan:                   3,   // Low  — scanner automatisé
    canary:                 2,   // Medium — tentative d'exfiltration
    credential_harvest:     1,   // High — collecte d'identifiants
    honeytoken:             2,   // Medium — attaquant humain confirmé
    fingerprint_recurrence: 2,   // Medium — récidiviste identifié
  }
  const threatLevel = threatMap[incident.incidentType] ?? 3

  // TLP selon le niveau
  const tlp: TLPTAG = threatLevel === 1 ? 'tlp:amber'
                    : threatLevel === 2 ? 'tlp:green'
                    : 'tlp:white'

  // Anonymisation VPN
  const tzMismatch = incident.browserTz && incident.timezone
    && incident.timezone !== '—'
    && incident.browserTz !== incident.timezone

  // Titre lisible
  const typeLabels: Record<string, string> = {
    scan:                   'Scanner automatisé — accès non autorisé',
    canary:                 'Canary File Accessed — tentative d\'exfiltration',
    credential_harvest:     'Credential Harvest — collecte d\'identifiants',
    honeytoken:             'Honeytoken cliqué — attaquant humain confirmé',
    fingerprint_recurrence: `Attaquant récidiviste — ${incident.fpVisits} visites`,
  }
  const info = `[Nodyx] ${typeLabels[incident.incidentType] ?? 'Incident sécurité'} — ${incident.ip} → ${incident.path}`

  // Attributs de base
  const attributes: MISPAttribute[] = [
    {
      type:     'ip-src',
      category: 'Network activity',
      value:    incident.ip,
      comment:  `Attaquant — ${incident.city}, ${incident.country} — ${incident.isp}`,
      to_ids:   true,
    },
    {
      type:     'url',
      category: 'Network activity',
      value:    incident.path,
      comment:  `Path ciblé — méthode HTTP: ${incident.method}`,
      to_ids:   false,
    },
    {
      type:     'user-agent',
      category: 'Network activity',
      value:    incident.userAgent.slice(0, 500),
      comment:  'User-Agent de l\'attaquant',
      to_ids:   false,
    },
    {
      type:     'text',
      category: 'Other',
      value:    incident.incidentId,
      comment:  'Nodyx Incident ID — référence interne pour corrélation',
      to_ids:   false,
    },
    {
      type:     'text',
      category: 'Other',
      value:    `${incident.country} / ${incident.city} — ISP: ${incident.isp} — TZ: ${incident.timezone}`,
      comment:  'Géolocalisation',
      to_ids:   false,
    },
  ]

  // VPN détecté
  if (tzMismatch) {
    attributes.push({
      type:     'text',
      category: 'Other',
      value:    `VPN suspect — TZ navigateur: ${incident.browserTz} / TZ IP: ${incident.timezone}`,
      comment:  'Discordance timezone → probable tunnel VPN/proxy',
      to_ids:   false,
    })
  }

  // Fingerprint canvas
  if (incident.canvasFp) {
    attributes.push({
      type:     'text',
      category: 'Other',
      value:    incident.canvasFp,
      comment:  'Canvas fingerprint — identifiant navigateur persistant',
      to_ids:   true,
    })
  }

  // GPU renderer (identifiant hardware fort)
  if (incident.gpuRenderer) {
    attributes.push({
      type:     'text',
      category: 'Other',
      value:    incident.gpuRenderer,
      comment:  'GPU renderer — identifiant matériel (WebGL)',
      to_ids:   false,
    })
  }

  // Langue
  if (incident.languages) {
    attributes.push({
      type:     'text',
      category: 'Other',
      value:    incident.languages,
      comment:  'Langues navigateur — peut révéler l\'origine réelle si VPN',
      to_ids:   false,
    })
  }

  // Credential harvest
  if (incident.incidentType === 'credential_harvest' && incident.username) {
    attributes.push({
      type:     'text',
      category: 'Payload delivery',
      value:    `username: ${incident.username}`,
      comment:  'Credential tenté sur faux formulaire honeypot',
      to_ids:   false,
    })
  }

  // IPs connues pour les récidivistes
  if (incident.knownIps && incident.knownIps.length > 1) {
    attributes.push({
      type:     'text',
      category: 'Network activity',
      value:    incident.knownIps.join(', '),
      comment:  `IPs connues pour ce fingerprint (${incident.fpVisits} visites total)`,
      to_ids:   true,
    })
  }

  // Tags MISP
  const tags: { name: string }[] = [
    { name: tlp },
    { name: 'nodyx:honeypot' },
    { name: `nodyx:type:${incident.incidentType}` },
    { name: 'type:OSINT' },
  ]

  if (incident.proxy)   tags.push({ name: 'misp-galaxy:threat-actor="Anonymous"' })
  if (incident.hosting) tags.push({ name: 'nodyx:source:datacenter' })
  if (tzMismatch)       tags.push({ name: 'nodyx:vpn-detected' })
  if (threatLevel === 1) tags.push({ name: 'ecsirt:fraud="identity-fraud"' })

  return {
    info,
    distribution:    dist,
    threat_level_id: threatLevel,
    analysis:        0,  // Initial
    date,
    Attribute: attributes,
    Tag:       tags,
  }
}

// ── Push depuis le honeypot (one-call) ────────────────────────────────────

export async function reportHoneypotToMISP(incident: HoneypotIncident): Promise<MISPResult> {
  if (!process.env.MISP_URL || !process.env.MISP_API_KEY) {
    return { ok: false, error: 'MISP non configuré' }
  }

  // Seulement pour les incidents significatifs (pas les scans basiques)
  const push = incident.incidentType !== 'scan'
    || incident.proxy === false  // IP directe = plus intéressant
    || (incident.fpVisits && incident.fpVisits > 1)

  if (!push) return { ok: false, error: 'incident non significatif (scan+VPN ignoré)' }

  const event = buildHoneypotMISPEvent(incident)
  return pushToMISP(event)
}
