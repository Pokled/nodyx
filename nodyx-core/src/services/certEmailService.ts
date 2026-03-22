/**
 * CERT Email Service — Nodyx Security
 *
 * Envoie automatiquement les rapports d'incidents significatifs
 * vers le CERT-FR ou toute autorité configurée.
 *
 * Variables d'environnement :
 *   CERT_FROM          → adresse expéditeur (ex: security@nodyx.org)
 *   CERT_REPLY_TO      → adresse de réponse (ex: jaronoah@gmail.com)
 *   CERT_EMAIL_TO      → destinataire (ex: cert-fr@ssi.gouv.fr ou email perso)
 *   CERT_EMAIL_MAX_PER_DAY → max emails/jour (défaut: 3)
 */

import nodemailer from 'nodemailer'
import { createHash } from 'crypto'
import { redis } from '../config/database.js'

function sha256(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex')
}

// ── Rate limiting ─────────────────────────────────────────────────────────────

async function canSendToday(): Promise<boolean> {
  const max = parseInt(process.env.CERT_EMAIL_MAX_PER_DAY ?? '3')
  const key = `cert:email:count:${new Date().toISOString().slice(0, 10)}`
  try {
    const count = await redis.get(key)
    return (parseInt(count ?? '0')) < max
  } catch {
    return true
  }
}

async function incrementDailyCount(): Promise<void> {
  const key = `cert:email:count:${new Date().toISOString().slice(0, 10)}`
  try {
    await redis.incr(key)
    await redis.expire(key, 86400)
  } catch { /* ignore */ }
}

async function alreadySentForIP(ip: string): Promise<boolean> {
  try {
    const exists = await redis.get(`cert:email:ip:${ip}`)
    return !!exists
  } catch {
    return false
  }
}

async function markIPSent(ip: string): Promise<void> {
  try {
    await redis.setex(`cert:email:ip:${ip}`, 86400, '1')
  } catch { /* ignore */ }
}

// ── Transport SMTP ────────────────────────────────────────────────────────────

function createTransport() {
  return nodemailer.createTransport({
    host:   process.env.SMTP_HOST!,
    port:   Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER!,
      pass: process.env.SMTP_PASS!,
    },
  })
}

// ── Classifieur de vulnérabilité ──────────────────────────────────────────────

function classifyVuln(path: string, ua: string): { owasp: string; label: string; cwe?: string } {
  const p = (path || '').toLowerCase()
  const u = (ua   || '').toLowerCase()
  if (/(\?|&)(id|q|search|s|query|cat|page|item)=.*('|%27|--|%2d%2d|union|select|or\s1|and\s1)/i.test(path) || u.includes('sqlmap'))
    return { owasp: 'A03:2021 – Injection', label: 'Tentative d\'injection SQL', cwe: 'CWE-89' }
  if (/(\.\.|%2e%2e|%252e|\/etc\/passwd|\/proc\/|boot\.ini)/i.test(path))
    return { owasp: 'A01:2021 – Broken Access Control', label: 'Path traversal / LFI', cwe: 'CWE-22' }
  if (/\.(env|git|htaccess|htpasswd|bak|sql|config|conf|ini|log|pem|key|crt|pfx|p12|ovpn|DS_Store)(\b|\/|$)/i.test(p) || /\/(\.git|backup|dump|secrets?|credentials?)(\/|$)/i.test(p))
    return { owasp: 'A05:2021 – Security Misconfiguration', label: 'Accès à fichier sensible / secret exposé', cwe: 'CWE-538' }
  if (/wp-(admin|login|cron|config|includes|content|json)|xmlrpc\.php/i.test(p))
    return { owasp: 'A07:2021 – Identification and Authentication Failures', label: 'Attaque WordPress (brute-force / RCE)', cwe: 'CWE-307' }
  if (/phpmyadmin|adminer|pma\/|myadmin|mysqladmin/i.test(p))
    return { owasp: 'A05:2021 – Security Misconfiguration', label: 'Tentative d\'accès interface DB (phpMyAdmin/Adminer)', cwe: 'CWE-306' }
  if (/\/admin|\/panel|\/manager|\/cp\/|\/controlpanel|\/dashboard\/login/i.test(p))
    return { owasp: 'A07:2021 – Identification and Authentication Failures', label: 'Brute-force panneau d\'administration', cwe: 'CWE-307' }
  if (/\/(cgi-bin|cmd|shell|exec|eval|base64|system|passthru|proc_open)/i.test(p) || /\.(php\d?|jsp|asp|aspx|cfm|cgi|pl|py|rb|sh)\?.*=/i.test(p))
    return { owasp: 'A03:2021 – Injection', label: 'Tentative d\'exécution de code distant (RCE)', cwe: 'CWE-78' }
  if (/\/api\/(v\d\/)?auth|\/api\/(v\d\/)?admin|\/api\/.*token/i.test(p))
    return { owasp: 'A01:2021 – Broken Access Control', label: 'Abus API — escalade de privilèges', cwe: 'CWE-285' }
  if (['nuclei','nikto','masscan','zgrab','nmap','nessus','openvas','acunetix','burp'].some(t => u.includes(t)))
    return { owasp: 'A06:2021 – Vulnerable and Outdated Components', label: 'Scan automatisé de vulnérabilités (scanner connu)', cwe: 'CWE-200' }
  return { owasp: 'A05:2021 – Security Misconfiguration', label: 'Reconnaissance / scan de surface d\'attaque', cwe: 'CWE-200' }
}

// ── Types d'incidents ─────────────────────────────────────────────────────────

type IncidentType = 'credential_harvest' | 'honeytoken' | 'canary' | 'fingerprint_recurrence' | 'scan'

const INCIDENT_LABELS: Record<IncidentType, string> = {
  credential_harvest:     'Collecte de credentials',
  honeytoken:             'Honeytoken cliqué — attaquant humain confirmé',
  canary:                 'Canary file accédé — tentative d\'exfiltration',
  fingerprint_recurrence: 'Attaquant récidiviste identifié',
  scan:                   'Scan automatisé',
}

// ── Envoi principal ───────────────────────────────────────────────────────────

export interface CERTEmailOptions {
  incidentId:   string
  incidentType: IncidentType
  ip:           string
  city:         string
  country:      string
  isp:          string
  proxy:        boolean
  hosting:      boolean
  path?:        string   // path HTTP ciblé — pour classification OWASP
  userAgent?:   string
  markdownReport?: string
  osintSummary?:   string
  threatLevel?:    string
}

export async function sendCERTEmail(opts: CERTEmailOptions): Promise<{ sent: boolean; reason?: string }> {
  // Vérifications préalables
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    return { sent: false, reason: 'SMTP non configuré' }
  }
  if (!process.env.CERT_EMAIL_TO) {
    return { sent: false, reason: 'CERT_EMAIL_TO non configuré' }
  }

  // Pas d'email pour les scans basiques
  if (opts.incidentType === 'scan' && (opts.proxy || opts.hosting)) {
    return { sent: false, reason: 'scan+VPN ignoré' }
  }

  // Rate limiting
  if (!(await canSendToday())) {
    return { sent: false, reason: 'quota journalier atteint' }
  }
  if (await alreadySentForIP(opts.ip)) {
    return { sent: false, reason: 'déjà signalé pour cette IP aujourd\'hui' }
  }

  const from       = process.env.CERT_FROM     || process.env.SMTP_FROM || 'security@nodyx.org'
  const replyTo    = process.env.CERT_REPLY_TO || ''
  const to         = process.env.CERT_EMAIL_TO
  const label      = INCIDENT_LABELS[opts.incidentType] ?? opts.incidentType
  const reportedAt = new Date().toISOString()
  const date       = reportedAt.replace('T', ' ').slice(0, 19) + ' UTC'
  const dateSlug   = reportedAt.slice(0, 10)
  const platform   = process.env.NODYX_COMMUNITY_NAME || 'Nodyx Instance'
  const anonFlag   = opts.proxy ? 'Proxy/VPN' : opts.hosting ? 'Datacenter' : 'IP directe'
  const vuln       = classifyVuln(opts.path ?? '', opts.userAgent ?? '')

  const subject = `[NODYX-CERT] ${label} — ${opts.incidentId} — ${opts.city}, ${opts.country}`

  // ── Payload JSON structuré (pour SIEM/SOAR) ──────────────────────────────
  const jsonPayload = {
    schema_version: '1.0',
    tlp:            'AMBER',
    reported_by:    `${platform} — Nodyx Security Honeypot`,
    reported_at:    reportedAt,
    incident: {
      id:          opts.incidentId,
      type:        opts.incidentType,
      type_label:  label,
      reported_at: reportedAt,
    },
    vulnerability: {
      owasp_category: vuln.owasp,
      label:          vuln.label,
      cwe:            vuln.cwe ?? null,
      path_targeted:  opts.path ?? null,
    },
    attacker: {
      ip:            opts.ip,
      city:          opts.city    || null,
      country:       opts.country || null,
      isp:           opts.isp     || null,
      proxy:         opts.proxy,
      hosting:       opts.hosting,
      anonymization: anonFlag,
      attribution:   !opts.proxy && !opts.hosting ? 'direct_residential' : 'anonymized',
    },
    osint: {
      threat_level: opts.threatLevel ?? null,
      summary:      opts.osintSummary ?? null,
    },
  }

  const jsonString     = JSON.stringify(jsonPayload, null, 2)
  const integrityHash  = sha256(jsonString)

  const textBody = `
RAPPORT D'INCIDENT SÉCURITÉ — ${platform}
==========================================

Référence    : ${opts.incidentId}
Type         : ${label}
Vulnérabilité: ${vuln.label}
OWASP        : ${vuln.owasp}${vuln.cwe ? `\nCWE          : ${vuln.cwe}` : ''}${opts.path ? `\nPath ciblé   : ${opts.path}` : ''}
Date/Heure   : ${date}
IP           : ${opts.ip}
Localisation : ${opts.city}, ${opts.country}
FAI          : ${opts.isp}
Anonymisation: ${anonFlag}
Niveau OSINT : ${opts.threatLevel ?? 'N/A'}
${opts.osintSummary ? `Synthèse OSINT : ${opts.osintSummary}\n` : ''}
── INTÉGRITÉ DES PREUVES ─────────────────────────────────────────────────────
  SHA-256 (rapport JSON) : ${integrityHash}
  Vérification : sha256sum NODYX-CERT-${opts.incidentId}-${dateSlug}.json
──────────────────────────────────────────────────────────────────────────────

Deux pièces jointes : rapport .md (lisible) + rapport .json (SIEM/SOAR, TLP:AMBER)

Lois applicables :
  - Code Pénal art. 323-1 — Accès frauduleux (2 ans / 60 000 €)
  - Code Pénal art. 323-2 — Entrave STAD (3 ans / 45 000 €)
  - EU Directive 2013/40/EU

--
Nodyx Security Honeypot — ${platform}
Ce message est généré automatiquement — répondez pour contact humain.
Méthodologie : https://nodyx.org/cert-methodology
`.trim()

  const attachments: any[] = [
    {
      filename:    `NODYX-CERT-${opts.incidentId}-${dateSlug}.json`,
      content:     jsonString,
      contentType: 'application/json',
    },
  ]
  if (opts.markdownReport) {
    attachments.push({
      filename:    `NODYX-CERT-${opts.incidentId}-${dateSlug}.md`,
      content:     opts.markdownReport,
      contentType: 'text/markdown',
    })
  }

  try {
    const transport = createTransport()
    await transport.sendMail({
      from,
      to,
      replyTo: replyTo || undefined,
      subject,
      text:    textBody,
      attachments,
      headers: {
        'X-Nodyx-Incident': opts.incidentId,
        'X-Nodyx-Type':     opts.incidentType,
        'X-Nodyx-SHA256':   integrityHash,
      },
    })

    await incrementDailyCount()
    await markIPSent(opts.ip)

    return { sent: true }
  } catch (err: any) {
    return { sent: false, reason: err?.message || 'erreur SMTP' }
  }
}

// ── Email de test ─────────────────────────────────────────────────────────────

export async function sendCERTTestEmail(): Promise<{ sent: boolean; reason?: string }> {
  return sendCERTEmail({
    incidentId:    'HP-TEST-0001',
    incidentType:  'credential_harvest',
    ip:            '198.51.100.42',
    city:          'Test City',
    country:       'Testland',
    isp:           'TEST-ISP — AS64496',
    proxy:         false,
    hosting:       false,
    threatLevel:   'high',
    osintSummary:  'IP test — AbuseIPDB score 78% (données fictives)',
    markdownReport: `# TEST — Rapport CERT Nodyx\n\nCeci est un email de test envoyé depuis le système honeypot Nodyx.\n\nSi vous recevez cet email, la configuration est opérationnelle.\n\n**Référence :** HP-TEST-0001\n**Date :** ${new Date().toISOString()}\n\n---\n*Nodyx Security Honeypot — nodyx.org*`,
  })
}
