import { FastifyInstance } from 'fastify'
import { db } from '../config/database.js'
import fs from 'fs'

// ── Geolocation (ip-api.com — gratuit, 45 req/min, aucune clé) ──────────────

interface GeoInfo {
  country: string
  city:    string
  isp:     string
  org:     string
}

async function getGeoInfo(ip: string): Promise<GeoInfo> {
  const blank: GeoInfo = { country: '—', city: '—', isp: '—', org: '—' }
  // Ne pas géolocaliser les IPs privées
  if (!ip || ip.startsWith('127.') || ip.startsWith('10.') || ip === '::1') return blank
  try {
    const res = await fetch(
      `http://ip-api.com/json/${ip}?fields=country,city,isp,org`,
      { signal: AbortSignal.timeout(4000) }
    )
    if (!res.ok) return blank
    const j = await res.json() as Partial<GeoInfo>
    return {
      country: j.country || '—',
      city:    j.city    || '—',
      isp:     j.isp     || '—',
      org:     j.org     || '—',
    }
  } catch {
    return blank
  }
}

// ── ID incident unique ────────────────────────────────────────────────────────

function genIncidentId(): string {
  return 'HP-' +
    Date.now().toString(36).toUpperCase() + '-' +
    Math.random().toString(36).slice(2, 6).toUpperCase()
}

// ── Page terminal "scary" ─────────────────────────────────────────────────────

function buildScaryPage(
  ip:         string,
  path:       string,
  geo:        GeoInfo,
  incidentId: string
): string {
  const ts = new Date().toISOString()
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Access Denied — 403</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { background:#050505; color:#33ff33; font-family:'Courier New',Courier,monospace;
         display:flex; align-items:center; justify-content:center; min-height:100vh; padding:1rem; }
  .box { width:100%; max-width:680px; border:1px solid #1c3a1c;
         background:#080808; border-radius:4px; overflow:hidden;
         box-shadow:0 0 60px rgba(51,255,51,0.04); }
  .topbar { background:#0d1a0d; border-bottom:1px solid #1c3a1c; padding:0.6rem 1rem;
            display:flex; align-items:center; gap:0.5rem; }
  .dot { width:11px; height:11px; border-radius:50%; }
  .d1 { background:#ff3b30; }
  .d2 { background:#ffcc00; }
  .d3 { background:#28cd41; }
  .title { margin-left:auto; margin-right:auto; font-size:0.75em; color:#2a5a2a; }
  .body { padding:1.8rem 2rem; }
  .warn { text-align:center; margin-bottom:1.6rem; }
  .warn .icon { font-size:2.4rem; display:block; margin-bottom:0.5rem; }
  .warn .label { color:#ff3333; font-size:1em; font-weight:bold;
                 animation:blink 1.1s step-end infinite; }
  @keyframes blink { 50%{ opacity:0; } }
  .section { margin-bottom:1.2rem; }
  .section-title { color:#2a8a2a; font-size:0.75em; text-transform:uppercase;
                   letter-spacing:0.1em; margin-bottom:0.5rem; }
  .row { display:flex; gap:0.5rem; font-size:0.875em; line-height:1.9; }
  .key { color:#2a7a2a; min-width:160px; flex-shrink:0; }
  .val { color:#e8e8e8; }
  .path { color:#ffcc00; word-break:break-all; }
  .sep { border-top:1px solid #1c3a1c; margin:1.2rem 0; }
  .id { color:#ff9944; font-family:monospace; }
  .legal { margin-top:1.4rem; padding:1rem 1.2rem; border:1px solid #2a1a00;
           background:#0d0800; border-radius:4px; }
  .legal p { font-size:0.78em; color:#886644; line-height:1.7; margin-bottom:0.4rem; }
  .legal p:last-child { margin-bottom:0; color:#664422; }
  .cursor { display:inline-block; width:8px; height:14px; background:#33ff33;
            animation:blink 1s step-end infinite; vertical-align:middle; }
</style>
</head>
<body>
<div class="box">
  <div class="topbar">
    <div class="dot d1"></div><div class="dot d2"></div><div class="dot d3"></div>
    <span class="title">nodyx-security-monitor — access_control.log</span>
  </div>
  <div class="body">

    <div class="warn">
      <span class="icon">⚠</span>
      <div class="label">UNAUTHORIZED ACCESS ATTEMPT DETECTED</div>
    </div>

    <div class="section">
      <div class="section-title">// Intruder identification</div>
      <div class="row"><span class="key">IP Address</span><span class="val">${ip}</span></div>
      <div class="row"><span class="key">Country</span><span class="val">${geo.country}</span></div>
      <div class="row"><span class="key">City</span><span class="val">${geo.city}</span></div>
      <div class="row"><span class="key">ISP</span><span class="val">${geo.isp}</span></div>
      <div class="row"><span class="key">Organization</span><span class="val">${geo.org}</span></div>
    </div>

    <div class="sep"></div>

    <div class="section">
      <div class="section-title">// Attempted access</div>
      <div class="row"><span class="key">Path</span><span class="path">${escHtml(path)}</span></div>
      <div class="row"><span class="key">Timestamp</span><span class="val">${ts}</span></div>
    </div>

    <div class="sep"></div>

    <div class="section">
      <div class="section-title">// Incident record</div>
      <div class="row"><span class="key">Reference ID</span><span class="id">${incidentId}</span></div>
      <div class="row"><span class="key">Status</span>
        <span class="val">logged &amp; flagged <span class="cursor"></span></span>
      </div>
    </div>

    <div class="legal">
      <p>This access attempt has been recorded in full (IP, headers, timestamp, geolocation).</p>
      <p>Unauthorized access to a computer system is a criminal offence under
         French law — Code Pénal art. 323-1 (up to 2 years imprisonment, €60 000 fine).</p>
      <p>Repeated attempts will be forwarded to CERT-FR and the relevant ISP abuse contact.</p>
    </div>

  </div>
</div>
</body>
</html>`
}

function escHtml(s: string): string {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

// ── Route handler ─────────────────────────────────────────────────────────────

export default async function honeypotRoutes(fastify: FastifyInstance) {

  // Méthode wildcard : toutes les méthodes HTTP
  fastify.route({
    method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'],
    url:    '/_hp',
    handler: async (request, reply) => {

      // IP réelle derrière Cloudflare / Caddy
      const headers = request.headers
      const ip =
        (headers['cf-connecting-ip'] as string) ||
        (headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
        request.ip ||
        '0.0.0.0'

      // Chemin original passé par Caddy en query param (?p=...)
      const originalPath = decodeURIComponent((request.query as any).p || '/').slice(0, 512)
      const userAgent    = (headers['user-agent'] || '').slice(0, 512)
      const method       = request.method
      const incidentId   = genIncidentId()

      // ── 1. Log fichier (pour fail2ban) ────────────────────────────────────
      const logLine = `${new Date().toISOString()} HONEYPOT_HIT ip=${ip} path="${originalPath}" ua="${userAgent}" id=${incidentId}\n`
      try {
        fs.appendFileSync('/var/log/nodyx-honeypot.log', logLine)
      } catch { /* si le fichier n'est pas créé encore, on passe */ }

      // ── 2. Géoloc + tarpit en parallèle ──────────────────────────────────
      const tarpitMs = 3000 + Math.floor(Math.random() * 4000) // 3–7 secondes
      const [geo] = await Promise.all([
        getGeoInfo(ip),
        new Promise<void>(r => setTimeout(r, tarpitMs)),
      ])

      // ── 3. DB insert (non-bloquant sur erreur) ────────────────────────────
      db.query(
        `INSERT INTO honeypot_hits
           (incident_id, ip, path, method, user_agent, headers, country, city, isp, org)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [incidentId, ip, originalPath, method, userAgent,
         JSON.stringify(headers), geo.country, geo.city, geo.isp, geo.org]
      ).catch(e => fastify.log.error('[honeypot] DB insert:', e))

      // ── 4. Discord webhook (si configuré) ────────────────────────────────
      const webhookUrl = process.env.HONEYPOT_DISCORD_WEBHOOK
      if (webhookUrl) {
        fetch(webhookUrl, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            embeds: [{
              title:  '🚨 Honeypot Hit',
              color:  0xff3333,
              fields: [
                { name: 'IP',           value: `\`${ip}\``,                        inline: true  },
                { name: 'Country',      value: `${geo.country} — ${geo.city}`,     inline: true  },
                { name: 'ISP',          value: geo.isp,                            inline: false },
                { name: 'Path',         value: `\`${originalPath}\``,             inline: true  },
                { name: 'Method',       value: method,                             inline: true  },
                { name: 'Incident ID',  value: `\`${incidentId}\``,               inline: false },
                { name: 'User-Agent',   value: `\`${userAgent.slice(0, 120)}\``,  inline: false },
              ],
              timestamp: new Date().toISOString(),
              footer:    { text: 'nodyx-security-monitor' },
            }]
          })
        }).catch(() => {})
      }

      // ── 5. Réponse ────────────────────────────────────────────────────────
      reply.header('Content-Type', 'text/html; charset=utf-8')
      return reply.code(403).send(buildScaryPage(ip, originalPath, geo, incidentId))
    }
  })
}
