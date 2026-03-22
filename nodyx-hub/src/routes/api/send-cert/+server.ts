import type { RequestHandler } from './$types'
import { getPool } from '$lib/server/pg.js'
import nodemailer from 'nodemailer'
import { createHash } from 'crypto'

function escMd(s: string): string {
  return (s || '').replace(/\|/g, '\\|').replace(/\n/g, ' ')
}

function sha256(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex')
}

// Classifie la vulnérabilité recherchée d'après le path et le user-agent
function classifyVuln(path: string, ua: string, method: string): { owasp: string; label: string; cwe?: string } {
  const p = (path || '').toLowerCase()
  const u = (ua  || '').toLowerCase()

  // SQLi
  if (/(\?|&)(id|q|search|s|query|cat|page|item)=.*('|%27|--|%2d%2d|union|select|or\s1|and\s1)/i.test(path) ||
      u.includes('sqlmap')) {
    return { owasp: 'A03:2021 – Injection', label: 'Tentative d\'injection SQL', cwe: 'CWE-89' }
  }
  // Path traversal / LFI
  if (/(\.\.|%2e%2e|%252e|\/etc\/passwd|\/proc\/|boot\.ini)/i.test(path)) {
    return { owasp: 'A01:2021 – Broken Access Control', label: 'Path traversal / LFI', cwe: 'CWE-22' }
  }
  // Secrets / fichiers sensibles
  if (/\.(env|git|htaccess|htpasswd|bak|sql|config|conf|ini|log|pem|key|crt|pfx|p12|ovpn|DS_Store)(\b|\/|$)/i.test(p) ||
      /\/(\.git|backup|dump|secrets?|credentials?)(\/|$)/i.test(p)) {
    return { owasp: 'A05:2021 – Security Misconfiguration', label: 'Accès à fichier sensible / secret exposé', cwe: 'CWE-538' }
  }
  // WordPress
  if (/wp-(admin|login|cron|config|includes|content|json)|xmlrpc\.php/i.test(p)) {
    return { owasp: 'A07:2021 – Identification and Authentication Failures', label: 'Attaque WordPress (brute-force / RCE)', cwe: 'CWE-307' }
  }
  // Phpmyadmin / adminer / DB
  if (/phpmyadmin|adminer|pma\/|myadmin|mysqladmin/i.test(p)) {
    return { owasp: 'A05:2021 – Security Misconfiguration', label: 'Tentative d\'accès interface DB (phpMyAdmin/Adminer)', cwe: 'CWE-306' }
  }
  // Panels d'admin
  if (/\/admin|\/panel|\/manager|\/cp\/|\/controlpanel|\/dashboard\/login/i.test(p)) {
    return { owasp: 'A07:2021 – Identification and Authentication Failures', label: 'Brute-force panneau d\'administration', cwe: 'CWE-307' }
  }
  // Remote code execution patterns
  if (/\/(cgi-bin|cmd|shell|exec|eval|base64|system|passthru|proc_open)/i.test(p) ||
      /\.(php\d?|jsp|asp|aspx|cfm|cgi|pl|py|rb|sh)\?.*=/i.test(p)) {
    return { owasp: 'A03:2021 – Injection', label: 'Tentative d\'exécution de code distant (RCE)', cwe: 'CWE-78' }
  }
  // API abuse
  if (/\/api\/(v\d\/)?auth|\/api\/(v\d\/)?admin|\/api\/.*token/i.test(p)) {
    return { owasp: 'A01:2021 – Broken Access Control', label: 'Abus API — escalade de privilèges', cwe: 'CWE-285' }
  }
  // Scanner générique
  if (u.includes('nuclei') || u.includes('nikto') || u.includes('masscan') ||
      u.includes('zgrab')  || u.includes('nmap')  || u.includes('nessus') ||
      u.includes('openvas')|| u.includes('acunetix')|| u.includes('burp')) {
    return { owasp: 'A06:2021 – Vulnerable and Outdated Components', label: 'Scan automatisé de vulnérabilités (scanner connu)', cwe: 'CWE-200' }
  }

  return { owasp: 'A05:2021 – Security Misconfiguration', label: 'Reconnaissance / scan de surface d\'attaque', cwe: 'CWE-200' }
}

export const POST: RequestHandler = async ({ request }) => {
  // Auth — session cookie vérifiée par le layout
  const { incidentId } = await request.json().catch(() => ({})) as { incidentId?: string }

  if (!incidentId || !/^HP-[A-Z0-9]+-[A-Z0-9]+$/.test(incidentId)) {
    return Response.json({ error: 'ID invalide' }, { status: 400 })
  }

  if (!process.env.CERT_EMAIL_TO && !process.env.SMTP_HOST) {
    return Response.json({ error: 'SMTP non configuré' }, { status: 400 })
  }

  const to = process.env.CERT_EMAIL_TO || 'jaronoah@gmail.com'

  const pool = getPool()

  // Récupérer les données de l'incident
  const [hitRes, fpRes, credRes, pixelRes] = await Promise.all([
    pool.query(`SELECT * FROM honeypot_hits WHERE incident_id = $1 LIMIT 1`, [incidentId]),
    pool.query(`SELECT * FROM honeypot_fingerprints WHERE $1 = ANY(incident_ids) LIMIT 1`, [incidentId]),
    pool.query(`SELECT * FROM honeypot_credential_attempts WHERE incident_id = $1 LIMIT 1`, [incidentId]),
    pool.query(`SELECT COUNT(*) as cnt FROM honeypot_pixel_hits WHERE incident_id = $1`, [incidentId]),
  ])

  const hit  = hitRes.rows[0]
  const fp   = fpRes.rows[0]
  const cred = credRes.rows[0]
  const pixelCount = parseInt(pixelRes.rows[0]?.cnt ?? '0')

  if (!hit) return Response.json({ error: 'Incident introuvable' }, { status: 404 })

  const reportedAt   = new Date().toISOString()
  const date         = reportedAt.replace('T', ' ').slice(0, 19) + ' UTC'
  const hitDate      = new Date(hit.created_at).toISOString().replace('T', ' ').slice(0, 19) + ' UTC'
  const anonFlag     = hit.proxy ? 'Proxy/VPN détecté' : hit.hosting ? 'IP datacenter' : 'IP directe — connexion résidentielle'
  const incidentType = cred ? 'Collecte de credentials (Credential Harvest)' : 'Accès non autorisé à ressource sensible'
  const vuln         = classifyVuln(hit.path, hit.user_agent, hit.method)

  // ── Payload JSON structuré (pour SIEM/SOAR) ────────────────────────────────
  const jsonPayload = {
    schema_version:  '1.0',
    tlp:             'AMBER',
    reported_by:     'Nodyx Security Honeypot',
    reported_at:     reportedAt,
    incident: {
      id:            incidentId,
      type:          cred ? 'credential_harvest' : 'unauthorized_access',
      type_label:    incidentType,
      occurred_at:   new Date(hit.created_at).toISOString(),
      reported_at:   reportedAt,
    },
    vulnerability: {
      owasp_category: vuln.owasp,
      label:          vuln.label,
      cwe:            vuln.cwe ?? null,
    },
    attacker: {
      ip:            hit.ip,
      city:          hit.city    || null,
      country:       hit.country || null,
      isp:           hit.isp     || null,
      org:           hit.org     || null,
      asn:           hit.asn     || null,
      proxy:         hit.proxy   ?? false,
      hosting:       hit.hosting ?? false,
      anonymization: anonFlag,
      attribution:   !hit.proxy && !hit.hosting ? 'direct_residential' : 'anonymized',
    },
    request: {
      method:        hit.method,
      path:          hit.path,
      user_agent:    hit.user_agent || null,
      headers:       hit.headers   || null,
    },
    fingerprint: fp ? {
      canvas_hash:   fp.fp_hash,
      gpu_renderer:  fp.gpu_renderer   || null,
      device_memory: fp.device_memory  || null,
      languages:     fp.languages      || null,
      visits:        fp.visits,
      ip_list:       fp.ip_list        || [],
    } : null,
    credential_harvest: cred ? {
      login_path: cred.login_path || hit.path,
      username:   cred.username   || null,
      password:   cred.password   || null,
    } : null,
    pixel_tracking: {
      views: pixelCount,
    },
    legal: {
      jurisdiction: 'FR',
      applicable_laws: [
        { code: 'CP-323-1', description: 'Accès frauduleux à un STAD', penalty: '2 ans / 60 000 €' },
        { code: 'CP-323-2', description: 'Entrave au fonctionnement d\'un STAD', penalty: '3 ans / 45 000 €' },
        ...(cred ? [{ code: 'CP-323-3', description: 'Extraction frauduleuse de données', penalty: '5 ans / 150 000 €' }] : []),
        { code: 'EU-2013/40/EU', description: 'Attaques contre les systèmes d\'information', penalty: 'Directive européenne' },
      ],
    },
  }

  const jsonString  = JSON.stringify(jsonPayload, null, 2)
  const integrityHash = sha256(jsonString)

  // ── Lettre de présentation ─────────────────────────────────────────────────
  const body = `À l'équipe CERT-FR,

Je me permets de vous contacter au nom de Nodyx (https://nodyx.org), une plateforme
communautaire open source auto-hébergée, publiée sous licence AGPL-3.0.

Nodyx est un projet citoyen français dont la mission est de reconstruire un internet
humain, décentralisé et souverain — une alternative libre aux grandes plateformes
américaines comme Discord, Facebook ou Reddit.

Notre infrastructure est équipée d'un système de défense honeypot qui capture et
documente en temps réel les tentatives d'intrusion, de collecte de credentials et
d'accès frauduleux. Les données sont horodatées, hashées (SHA-256) et structurées
selon les standards de signalement.

Nous souhaitons vous signaler l'incident suivant :

  Référence     : ${incidentId}
  Type          : ${incidentType}
  Vulnérabilité : ${vuln.label}
  Classe OWASP  : ${vuln.owasp}${vuln.cwe ? `\n  CWE           : ${vuln.cwe}` : ''}
  IP source     : ${hit.ip}
  Localisation  : ${hit.city || '—'}, ${hit.country || '—'}
  FAI / ASN     : ${hit.isp || '—'}
  Anonymisation : ${anonFlag}
  Date/Heure    : ${hitDate}
${fp ? `  Fingerprint   : Empreinte navigateur persistante — ${fp.visits} visite(s) connue(s)\n` : ''}${pixelCount > 0 ? `  Pixel tracking : ${pixelCount} ouverture(s) détectée(s)\n` : ''}
── INTÉGRITÉ DES PREUVES ──────────────────────────────────────────────────────
  SHA-256 (rapport JSON) : ${integrityHash}
  Ce hash garantit l'authenticité du fichier joint NODYX-CERT-${incidentId}.json
  Vérification : sha256sum NODYX-CERT-${incidentId}-*.json
──────────────────────────────────────────────────────────────────────────────

Deux pièces jointes sont fournies :
  1. Rapport Markdown (.md)  — lisible par un analyste
  2. Rapport JSON    (.json) — ingérable par vos outils SIEM/SOAR (TLP:AMBER)

Nous sommes entièrement transparents et disposés à :

  — Vous fournir un accès complet à toutes les preuves collectées
  — Partager les logs bruts, headers HTTP et fingerprints navigateur complets
  — Collaborer avec vos équipes sur toute investigation en cours
  — Vous ouvrir un accès à notre tableau de bord de monitoring (Olympus Hub)
  — Signaler automatiquement les incidents futurs si vous le souhaitez

Nodyx n'a rien à cacher. Nous sommes de votre côté.

Notre objectif est simple : contribuer à un internet plus sûr pour tous.

En vous remerciant pour votre action au service de la cybersécurité française.

Cordialement,

Nodyx Security
https://nodyx.org — Licence AGPL-3.0 — Open Source
Répondre à : ${process.env.CERT_REPLY_TO || 'security@nodyx.org'}

Méthodologie de détection : https://nodyx.org/cert-methodology

---
Infractions caractérisées :
  Code Pénal art. 323-1 — Accès frauduleux à un STAD (2 ans / 60 000 €)
  Code Pénal art. 323-2 — Entrave au fonctionnement d'un STAD (3 ans / 45 000 €)
  EU Directive 2013/40/EU — Attaques contre les systèmes d'information${cred ? '\n  Code Pénal art. 323-3 — Extraction frauduleuse de données (5 ans / 150 000 €)' : ''}
`

  // ── Rapport Markdown joint ─────────────────────────────────────────────────
  const md = [
    `# RAPPORT D'INCIDENT SÉCURITÉ — ${incidentId}`,
    ``,
    `> **Classification :** TLP:AMBER — Diffusion restreinte aux autorités`,
    `> **Généré le :** ${date}`,
    `> **SHA-256 (JSON) :** \`${integrityHash}\``,
    ``,
    `## Attaquant`,
    ``,
    `| Champ | Valeur |`,
    `|---|---|`,
    `| IP | \`${hit.ip}\` |`,
    `| Localisation | ${escMd(hit.city || '—')}, ${escMd(hit.country || '—')} |`,
    `| FAI | ${escMd(hit.isp || '—')} |`,
    `| Anonymisation | ${anonFlag} |`,
    hit.proxy ? '' : `| **IP directement attribuable** | OUI — réquisition judiciaire possible |`,
    ``,
    `## Incident`,
    ``,
    `| Champ | Valeur |`,
    `|---|---|`,
    `| Type | ${incidentType} |`,
    `| **Vulnérabilité recherchée** | **${escMd(vuln.label)}** |`,
    `| Classe OWASP | ${escMd(vuln.owasp)} |`,
    vuln.cwe ? `| CWE | [${vuln.cwe}](https://cwe.mitre.org/data/definitions/${vuln.cwe.replace('CWE-','')}.html) |` : '',
    `| Méthode HTTP | ${hit.method} |`,
    `| Path ciblé | \`${escMd(hit.path)}\` |`,
    `| User-Agent | \`${escMd((hit.user_agent || '—').slice(0, 150))}\` |`,
    `| Date/Heure | ${hitDate} |`,
    ``,
    fp ? `## Fingerprint navigateur\n\n| Attribut | Valeur |\n|---|---|\n| Canvas Hash | \`${fp.fp_hash}\` |\n| GPU | ${fp.gpu_renderer || '—'} |\n| RAM | ${fp.device_memory ? `${fp.device_memory} GB` : '—'} |\n| Langues | ${fp.languages || '—'} |\n| Visites connues | ${fp.visits} |\n${fp.ip_list?.length > 1 ? `| IPs associées | ${fp.ip_list.join(', ')} |\n` : ''}\n` : '',
    cred ? `## Credentials capturés\n\n> ⚠ Données sensibles\n\n| Champ | Valeur |\n|---|---|\n| Username | \`${escMd(cred.username || '(vide)')}\` |\n| Password tenté | \`${escMd(cred.password || '(vide)')}\` |\n\n` : '',
    pixelCount > 0 ? `## Pixel tracking\n\n${pixelCount} ouverture(s) détectée(s) — l'attaquant a revisité la page ou ouvert un document tracké.\n\n` : '',
    `## Intégrité`,
    ``,
    `| Fichier | SHA-256 |`,
    `|---|---|`,
    `| NODYX-CERT-${incidentId}-${reportedAt.slice(0,10)}.json | \`${integrityHash}\` |`,
    ``,
    `---`,
    `*Nodyx Security Honeypot — nodyx.org — AGPL-3.0*`,
    `*Ce rapport est généré automatiquement. Toutes les données sont horodatées.*`,
  ].filter(Boolean).join('\n')

  // ── Envoi ──────────────────────────────────────────────────────────────────
  const dateSlug = reportedAt.slice(0, 10)
  try {
    const transport = nodemailer.createTransport({
      host:   process.env.SMTP_HOST!,
      port:   Number(process.env.SMTP_PORT ?? 587),
      secure: process.env.SMTP_SECURE === 'true',
      auth:   { user: process.env.SMTP_USER!, pass: process.env.SMTP_PASS! },
    })

    await transport.sendMail({
      from:    process.env.CERT_FROM    || process.env.SMTP_FROM || 'security@nodyx.org',
      to,
      replyTo: process.env.CERT_REPLY_TO || undefined,
      subject: `[NODYX-CERT] ${cred ? 'Credential Harvest' : 'Accès non autorisé'} — ${incidentId} — ${hit.city || '—'}, ${hit.country || '—'}`,
      text:    body,
      attachments: [
        {
          filename:    `NODYX-CERT-${incidentId}-${dateSlug}.md`,
          content:     md,
          contentType: 'text/markdown',
        },
        {
          filename:    `NODYX-CERT-${incidentId}-${dateSlug}.json`,
          content:     jsonString,
          contentType: 'application/json',
        },
      ],
      headers: {
        'X-Nodyx-Incident':  incidentId,
        'X-Nodyx-Manual':    'true',
        'X-Nodyx-SHA256':    integrityHash,
      },
    })

    return Response.json({ ok: true, sent_to: to, sha256: integrityHash })
  } catch (err: any) {
    return Response.json({ error: err?.message || 'SMTP error' }, { status: 500 })
  }
}
