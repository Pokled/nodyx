#!/usr/bin/env node
// ─── Collecteur CrowdSec → PostgreSQL ────────────────────────────────────────
//
// POURQUOI CE PROGRAMME EXISTE. Olympus doit voir ce que CrowdSec observe et
// décide, sans jamais être couplé à lui. Trois portes étaient possibles :
//
//   1. Olympus lit la base SQLite de CrowdSec  -> couplage a son schema interne,
//      qui change entre versions. Et le fichier est `root:root 640` alors que le
//      hub tourne en `nodyx`.
//   2. Olympus appelle `cscli`                  -> une commande systeme depuis
//      l'application web. Exclu par le CDC, et pour de bonnes raisons.
//   3. Un collecteur s'interpose                -> retenu.
//
// Le collecteur parle a CrowdSec par son interface SUPPORTEE (`cscli -o json`),
// normalise, et ecrit dans PostgreSQL. Olympus n'interroge que PostgreSQL. Si
// CrowdSec change de schema interne, seul ce fichier bouge.
//
// IDEMPOTENT. Il tourne en boucle et rejoue les memes alertes : chaque insertion
// est conditionnee a l'absence prealable (`WHERE NOT EXISTS`). Le relancer deux
// fois de suite ne cree pas de doublon.
//
// CE QU'IL N'EST PAS. Il ne decide rien, ne bloque rien, n'appelle pas nftables.
// Il lit et recopie.

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

// `pg` vit dans les dependances du coeur. La resolution ESM part du FICHIER, pas
// du repertoire courant : ni `NODE_PATH` ni un `cd` n'y changent quoi que ce
// soit. On resout donc explicitement depuis nodyx-core, ce qui evite aussi de
// dupliquer la dependance pour un script d'exploitation.
const require = createRequire('/var/www/nexus/nodyx-core/package.json')
const pg = require('pg')

const run = promisify(execFile)

/** Les identifiants viennent du .env du cœur : une seule source de vérité. */
function configBase() {
  const brut = readFileSync('/var/www/nexus/nodyx-core/.env', 'utf-8')
  const v = (clef) => brut.match(new RegExp(`^${clef}=(.*)$`, 'm'))?.[1]?.trim()
  return {
    host: v('DB_HOST') || 'localhost',
    port: Number(v('DB_PORT') || 5432),
    database: v('DB_NAME') || 'nexus',
    user: v('DB_USER') || 'nexus',
    password: v('DB_PASSWORD'),
  }
}

async function cscli(...args) {
  try {
    const { stdout } = await run('/usr/bin/cscli', [...args, '-o', 'json'], {
      maxBuffer: 32 * 1024 * 1024,
    })
    const t = stdout.trim()
    return t ? JSON.parse(t) : []
  } catch (e) {
    // Une panne de cscli ne doit pas tuer le collecteur : il reessaiera au tour
    // suivant. On la signale, on ne l'avale pas silencieusement — c'est
    // exactement le motif qui a rendu le pot de miel aveugle pendant cinq mois.
    console.error(`[collecteur] cscli ${args.join(' ')} en echec :`, e.message)
    return null
  }
}

/** Le scénario CrowdSec, traduit dans notre vocabulaire d'événement. */
function typeDepuisScenario(scenario = '') {
  const s = scenario.toLowerCase()
  if (s.includes('bf') || s.includes('bruteforce')) return 'bruteforce'
  if (s.includes('scan') || s.includes('crawl')) return 'scan'
  if (s.includes('http')) return 'anomaly'
  if (s.includes('ssh')) return 'auth_failure'
  return 'anomaly'
}

function severiteDepuisEvenements(n) {
  if (n >= 50) return 'critical'
  if (n >= 20) return 'high'
  if (n >= 5) return 'medium'
  return 'low'
}

async function ingererAlertes(client) {
  const alertes = await cscli('alerts', 'list')
  if (!alertes) return 0
  let n = 0
  for (const a of alertes) {
    const ip = a.source?.ip ?? a.source?.value
    if (!ip) continue
    const ref = `crowdsec:alert:${a.id}`
    const r = await client.query(
      `INSERT INTO security_events
         (ts, source, event_type, severity, src_ip, country, org, action, raw_ref, metadata)
       SELECT $1, 'crowdsec', $2, $3, $4::inet, $5, $6, 'observed', $7, $8
       WHERE NOT EXISTS (SELECT 1 FROM security_events WHERE raw_ref = $7)`,
      [
        a.created_at ?? new Date().toISOString(),
        typeDepuisScenario(a.scenario),
        severiteDepuisEvenements(a.events_count ?? 0),
        ip,
        a.source?.cn ?? null,
        a.source?.as_name ?? null,
        ref,
        JSON.stringify({ scenario: a.scenario, events: a.events_count }),
      ],
    )
    n += r.rowCount ?? 0
  }
  return n
}

async function ingererDecisions(client) {
  const decisions = await cscli('decisions', 'list')
  if (!decisions) return 0
  let n = 0
  for (const bloc of decisions) {
    for (const d of bloc.decisions ?? []) {
      if (!d.value) continue
      const ref = `crowdsec:decision:${d.id}`
      // `enforcement_plane` : sans bouncer, RIEN n'est applique. On l'ecrit donc
      // `none`, et `enforced_at` reste NULL. C'est ce qui empechera Olympus
      // d'afficher « BLOQUE » pour une adresse qui passe tranquillement.
      const r = await client.query(
        `INSERT INTO security_decisions
           (created_at, src_ip, source, decision, reason, duration_seconds,
            expires_at, status, enforcement_plane, correlation_id, metadata)
         SELECT $1, $2::inet, 'crowdsec', $3, $4, $5, $6, 'active', 'none', $7, $8
         WHERE NOT EXISTS (SELECT 1 FROM security_decisions WHERE correlation_id = $7)`,
        [
          bloc.created_at ?? new Date().toISOString(),
          d.value,
          (d.type ?? 'ban').toLowerCase() === 'ban' ? 'ban' : 'watch',
          d.scenario ?? 'crowdsec',
          null,
          null,
          ref,
          JSON.stringify({ scenario: d.scenario, origin: d.origin, duration: d.duration }),
        ],
      )
      n += r.rowCount ?? 0
    }
  }
  return n
}

const client = new pg.Client(configBase())
await client.connect()
try {
  const a = await ingererAlertes(client)
  const d = await ingererDecisions(client)
  console.log(`[collecteur] ${a} alerte(s) et ${d} decision(s) nouvelles`)
} finally {
  await client.end()
}
