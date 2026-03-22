import { FastifyInstance } from 'fastify'
import { db, redis } from '../config/database.js'
import crypto from 'crypto'
import fs from 'fs'
import { reportHoneypotToMISP } from '../services/mispService.js'
import { enrichIP, type OSINTResult } from '../services/osintService.js'
import { sendCERTEmail } from '../services/certEmailService.js'

// 1×1 transparent PNG — served by the tracking pixel endpoint
const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
)

// ── Geolocation (ip-api.com — gratuit, 45 req/min, aucune clé) ──────────────

interface GeoInfo {
  country:  string
  city:     string
  isp:      string
  org:      string
  as:       string
  reverse:  string
  timezone: string
  lat:      number
  lon:      number
  // Anonymization flags (free in ip-api.com)
  proxy:    boolean   // proxy / VPN exit node
  hosting:  boolean   // datacenter / cloud IP
  mobile:   boolean   // mobile network
}

const GEO_CACHE_TTL = 4 * 60 * 60  // 4 heures

async function getGeoInfo(ip: string): Promise<GeoInfo> {
  const blank: GeoInfo = { country: '—', city: '—', isp: '—', org: '—', as: '—', reverse: '—', timezone: '—', lat: 0, lon: 0, proxy: false, hosting: false, mobile: false }
  if (!ip || ip.startsWith('127.') || ip.startsWith('10.') || ip === '::1') return blank

  // Redis cache — évite de dépasser les 45 req/min
  const cacheKey = `geo:${ip}`
  try {
    const cached = await redis.get(cacheKey)
    if (cached) return JSON.parse(cached) as GeoInfo
  } catch { /* ignore */ }

  try {
    const res = await fetch(
      `http://ip-api.com/json/${ip}?fields=country,city,isp,org,as,reverse,timezone,lat,lon,proxy,hosting,mobile`,
      { signal: AbortSignal.timeout(4000) }
    )
    if (!res.ok) return blank
    const j = await res.json() as Partial<GeoInfo> & { proxy?: boolean; hosting?: boolean; mobile?: boolean }
    const geo: GeoInfo = {
      country:  j.country  || '—',
      city:     j.city     || '—',
      isp:      j.isp      || '—',
      org:      j.org      || '—',
      as:       j.as       || '—',
      reverse:  j.reverse  || `host-${ip.replace(/\./g,'-')}.unknown`,
      timezone: j.timezone || '—',
      lat:      j.lat      || 0,
      lon:      j.lon      || 0,
      proxy:    j.proxy    ?? false,
      hosting:  j.hosting  ?? false,
      mobile:   j.mobile   ?? false,
    }
    redis.setex(cacheKey, GEO_CACHE_TTL, JSON.stringify(geo)).catch(() => {})
    return geo
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

// ── Détection du tool d'attaque ───────────────────────────────────────────────

function detectTool(ua: string): { name: string; type: string; fakePath: string } {
  const u = ua.toLowerCase()
  if (/curl\/([\d.]+)/.test(u))            return { name: `curl ${ua.match(/curl\/([\d.]+)/i)?.[1] ?? ''}`, type: 'CLI HTTP client',           fakePath: '/usr/bin/curl'                             }
  if (/python-requests\/([\d.]+)/.test(u)) return { name: 'python-requests',                                type: 'Python HTTP scanner',         fakePath: '/home/user/.local/lib/python3/site-packages/requests/__init__.py' }
  if (/python\/([\d.]+)/.test(u))          return { name: 'Python urllib',                                  type: 'Python automation script',    fakePath: '/tmp/scan.py'                              }
  if (/nikto/.test(u))                     return { name: 'Nikto',                                          type: 'Web vulnerability scanner',   fakePath: '/usr/share/nikto/nikto.pl'                 }
  if (/sqlmap/.test(u))                    return { name: 'sqlmap',                                         type: 'SQL injection tool',          fakePath: '/usr/share/sqlmap/sqlmap.py'               }
  if (/nmap/.test(u))                      return { name: 'Nmap NSE',                                       type: 'Network + web scanner',       fakePath: '/usr/bin/nmap'                             }
  if (/masscan/.test(u))                   return { name: 'Masscan',                                        type: 'Mass port scanner',           fakePath: '/usr/local/bin/masscan'                    }
  if (/nuclei/.test(u))                    return { name: 'Nuclei',                                         type: 'Template-based vuln scanner', fakePath: '/usr/local/bin/nuclei'                     }
  if (/gobuster/.test(u))                  return { name: 'Gobuster',                                       type: 'Directory/file brute-forcer', fakePath: '/usr/local/bin/gobuster'                   }
  if (/dirbuster/.test(u))                 return { name: 'DirBuster',                                      type: 'Directory brute-forcer',      fakePath: '/usr/share/dirbuster/DirBuster.jar'        }
  if (/zgrab/.test(u))                     return { name: 'ZGrab2',                                         type: 'Banner grabbing tool',        fakePath: '/usr/local/bin/zgrab2'                     }
  if (/go-http-client/.test(u))            return { name: 'Go HTTP Client',                                 type: 'Custom Go scanner',           fakePath: '/tmp/scanner'                              }
  if (/wget\/([\d.]+)/.test(u))            return { name: `wget ${ua.match(/wget\/([\d.]+)/i)?.[1] ?? ''}`, type: 'CLI downloader',              fakePath: '/usr/bin/wget'                             }
  if (/metasploit/.test(u))                return { name: 'Metasploit',                                     type: 'Exploit framework',           fakePath: '/usr/share/metasploit-framework/msfconsole'}
  if (/hydra/.test(u))                     return { name: 'THC-Hydra',                                      type: 'Credential brute-forcer',     fakePath: '/usr/bin/hydra'                            }
  if (/mozilla/.test(u))                   return { name: 'Browser',                                        type: 'Web browser (manual)',        fakePath: ''                                          }
  return                                          { name: 'Unknown scanner',                                 type: 'Automated reconnaissance tool', fakePath: '/tmp/recon'                              }
}

// ── Fake data ─────────────────────────────────────────────────────────────────

function fakePortScan(ip: string): { port: number; proto: string; state: string; service: string }[] {
  // Seed déterministe basé sur l'IP pour que les mêmes ports s'affichent à chaque hit
  const seed = ip.split('.').reduce((a, b) => a + parseInt(b), 0)
  const maybeOpen = (threshold: number) => seed % threshold === 0
  const ports = [
    { port: 22,    proto: 'tcp', state: 'open',     service: 'ssh     OpenSSH 8.9p1 Ubuntu' },
    { port: 80,    proto: 'tcp', state: maybeOpen(3) ? 'open' : 'closed',  service: 'http    nginx 1.18.0' },
    { port: 443,   proto: 'tcp', state: maybeOpen(2) ? 'open' : 'closed',  service: 'https   nginx 1.18.0' },
    { port: 3306,  proto: 'tcp', state: maybeOpen(5) ? 'open' : 'filtered', service: 'mysql  MySQL 8.0' },
    { port: 5432,  proto: 'tcp', state: maybeOpen(7) ? 'open' : 'filtered', service: 'postgresql' },
    { port: 6379,  proto: 'tcp', state: maybeOpen(4) ? 'open' : 'filtered', service: 'redis' },
    { port: 8080,  proto: 'tcp', state: maybeOpen(6) ? 'open' : 'closed',  service: 'http-proxy' },
    { port: 27017, proto: 'tcp', state: maybeOpen(9) ? 'open' : 'filtered', service: 'mongodb' },
  ]
  return ports
}

function evidenceHash(incidentId: string, ip: string, path: string, ts: string): string {
  return crypto.createHash('sha256').update(`${incidentId}:${ip}:${path}:${ts}`).digest('hex')
}

function escHtml(s: string): string {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

// ── Feature 4 : Canary files — détection & contenu fake ──────────────────────

const CANARY_FILES: { pattern: RegExp; type: string; label: string }[] = [
  { pattern: /\.env(\.|$)/i,            type: 'env',         label: '.env'           },
  { pattern: /backup\.sql/i,            type: 'sql',         label: 'backup.sql'     },
  { pattern: /dump\.sql/i,              type: 'sql',         label: 'dump.sql'       },
  { pattern: /db\.sql/i,                type: 'sql',         label: 'db.sql'         },
  { pattern: /database\.sql/i,          type: 'sql',         label: 'database.sql'   },
  { pattern: /config\.json/i,           type: 'json',        label: 'config.json'    },
  { pattern: /credentials\.json/i,      type: 'json',        label: 'credentials.json' },
  { pattern: /id_rsa/i,                 type: 'rsa',         label: 'id_rsa'         },
  { pattern: /database\.yml/i,          type: 'yml',         label: 'database.yml'   },
  { pattern: /wp-config\.php/i,         type: 'wpconfig',    label: 'wp-config.php'  },
  { pattern: /config\.php/i,            type: 'phpconfig',   label: 'config.php'     },
]

function detectCanaryFile(path: string): { type: string; label: string } | null {
  for (const c of CANARY_FILES) {
    if (c.pattern.test(path)) return { type: c.type, label: c.label }
  }
  return null
}

function fakeSeed(ip: string): number {
  return ip.split('.').reduce((a, b, i) => a + (parseInt(b) || 0) * (i + 1) * 7, 0)
}

function fakeHex(seed: number, len: number): string {
  let h = ''
  let s = seed
  while (h.length < len) {
    s = (s * 1664525 + 1013904223) & 0xffffffff
    h += (s >>> 0).toString(16).padStart(8, '0')
  }
  return h.slice(0, len)
}

function buildCanaryContent(type: string, ip: string): { content: string; contentType: string } {
  const seed = fakeSeed(ip)
  const h    = (len: number) => fakeHex(seed, len)

  switch (type) {
    case 'env':
      return {
        contentType: 'text/plain; charset=utf-8',
        content: `# Application environment — DO NOT COMMIT
APP_ENV=production
APP_KEY=${h(32)}
APP_SECRET=${h(48)}
APP_DEBUG=false
APP_URL=https://app.internal.net

# Database
DB_HOST=10.0.0.${seed % 200 + 10}
DB_PORT=5432
DB_NAME=app_production
DB_USER=app_svc
DB_PASSWORD=${h(24)}
DB_SSL=true

# Redis
REDIS_HOST=10.0.0.${seed % 200 + 50}
REDIS_PORT=6379
REDIS_PASSWORD=${h(20)}

# JWT
JWT_SECRET=${h(64)}
JWT_EXPIRES_IN=7d

# AWS
AWS_ACCESS_KEY_ID=AKIA${h(16).toUpperCase()}
AWS_SECRET_ACCESS_KEY=${h(40)}
AWS_REGION=eu-west-1
AWS_BUCKET=app-assets-prod

# Stripe
STRIPE_SECRET_KEY=sk_live_${h(32)}
STRIPE_WEBHOOK_SECRET=whsec_${h(28)}

# SMTP
SMTP_HOST=smtp.internal.net
SMTP_PORT=587
SMTP_USER=app@internal.net
SMTP_PASS=${h(18)}

# Sentry
SENTRY_DSN=https://${h(16)}@o${seed % 999999}.ingest.sentry.io/${seed % 9999999}
`
      }

    case 'sql':
      return {
        contentType: 'application/sql',
        content: `-- MySQL dump 10.13  Distrib 8.0.32, for Linux (x86_64)
-- Host: 10.0.0.${seed % 200 + 10}    Database: app_production
-- ------------------------------------------------------
-- Server version\t8.0.32

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET NAMES utf8 */;
SET FOREIGN_KEY_CHECKS=0;

-- Table structure for table \`users\`
DROP TABLE IF EXISTS \`users\`;
CREATE TABLE \`users\` (
  \`id\` int NOT NULL AUTO_INCREMENT,
  \`email\` varchar(255) NOT NULL,
  \`password_hash\` varchar(255) NOT NULL,
  \`username\` varchar(64) NOT NULL,
  \`role\` enum('user','admin','moderator') DEFAULT 'user',
  \`created_at\` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`email\` (\`email\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Dumping data for table \`users\`
INSERT INTO \`users\` VALUES
(1,'admin@internal.net','$2b$12$${h(53)}','admin','admin','2024-01-15 09:23:11'),
(2,'dev@internal.net','$2b$12$${h(53)}','developer','user','2024-02-03 14:11:02'),
(3,'ops@internal.net','$2b$12$${h(53)}','sysops','moderator','2024-03-12 08:45:33');

-- Table structure for table \`api_keys\`
DROP TABLE IF EXISTS \`api_keys\`;
CREATE TABLE \`api_keys\` (
  \`id\` int NOT NULL AUTO_INCREMENT,
  \`user_id\` int NOT NULL,
  \`key_hash\` varchar(64) NOT NULL,
  \`created_at\` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (\`id\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO \`api_keys\` VALUES
(1,1,'${h(64)}','2024-06-01 10:00:00');

SET FOREIGN_KEY_CHECKS=1;
`
      }

    case 'json':
      return {
        contentType: 'application/json',
        content: JSON.stringify({
          database: {
            host:     `10.0.0.${seed % 200 + 10}`,
            port:     5432,
            name:     'app_production',
            user:     'app_svc',
            password: h(24),
            ssl:      true,
          },
          redis: {
            host:     `10.0.0.${seed % 200 + 50}`,
            port:     6379,
            password: h(20),
          },
          api: {
            key:    h(32),
            secret: h(40),
          },
          aws: {
            access_key_id:     `AKIA${h(16).toUpperCase()}`,
            secret_access_key: h(40),
            region:            'eu-west-1',
            bucket:            'app-assets-prod',
          },
          smtp: {
            host: 'smtp.internal.net',
            port: 587,
            user: 'app@internal.net',
            pass: h(18),
          },
        }, null, 2),
      }

    case 'rsa':
      return {
        contentType: 'application/octet-stream',
        content: `-----BEGIN RSA PRIVATE KEY-----
${h(64)}
${h(64)}
${h(64)}
${h(64)}
${h(64)}
${h(64)}
${h(64)}
${h(64)}
${h(64)}
${h(64)}
${h(64)}
${h(64)}
${h(64)}
${h(64)}
${h(64)}
${h(64)}
${h(64)}
${h(64)}
${h(32)}
-----END RSA PRIVATE KEY-----
`,
      }

    case 'yml':
      return {
        contentType: 'text/yaml; charset=utf-8',
        content: `# Rails database configuration
default: &default
  adapter: postgresql
  encoding: unicode
  pool: <%= ENV.fetch("RAILS_MAX_THREADS") { 5 } %>
  username: app_svc
  password: ${h(24)}
  host: 10.0.0.${seed % 200 + 10}

development:
  <<: *default
  database: app_development

test:
  <<: *default
  database: app_test

production:
  <<: *default
  database: app_production
  username: app_svc
  password: ${h(24)}
  host: 10.0.0.${seed % 200 + 10}
  port: 5432
  sslmode: require
`,
      }

    case 'wpconfig':
      return {
        contentType: 'text/plain; charset=utf-8',
        content: `<?php
/**
 * The base configuration for WordPress
 */

// ** Database settings ** //
define( 'DB_NAME',     'wordpress_prod' );
define( 'DB_USER',     'wp_user' );
define( 'DB_PASSWORD', '${h(24)}' );
define( 'DB_HOST',     '10.0.0.${seed % 200 + 10}' );
define( 'DB_CHARSET',  'utf8mb4' );
define( 'DB_COLLATE',  '' );

/**#@+
 * Authentication unique keys and salts.
 */
define( 'AUTH_KEY',         '${h(64)}' );
define( 'SECURE_AUTH_KEY',  '${h(64)}' );
define( 'LOGGED_IN_KEY',    '${h(64)}' );
define( 'NONCE_KEY',        '${h(64)}' );
define( 'AUTH_SALT',        '${h(64)}' );
define( 'SECURE_AUTH_SALT', '${h(64)}' );
define( 'LOGGED_IN_SALT',   '${h(64)}' );
define( 'NONCE_SALT',       '${h(64)}' );

$table_prefix = 'wp_';

define( 'WP_DEBUG', false );

if ( ! defined( 'ABSPATH' ) ) {
  define( 'ABSPATH', __DIR__ . '/' );
}
require_once ABSPATH . 'wp-settings.php';
`,
      }

    case 'phpconfig':
      return {
        contentType: 'text/plain; charset=utf-8',
        content: `<?php
// Database configuration
define('DB_HOST',     '10.0.0.${seed % 200 + 10}');
define('DB_NAME',     'app_production');
define('DB_USER',     'app_svc');
define('DB_PASS',     '${h(24)}');
define('DB_PREFIX',   'app_');

// Application
define('APP_SECRET',  '${h(32)}');
define('APP_ENV',     'production');
define('APP_DEBUG',   false);

// Mail
define('SMTP_HOST',   'smtp.internal.net');
define('SMTP_USER',   'app@internal.net');
define('SMTP_PASS',   '${h(18)}');
define('SMTP_PORT',   587);
`,
      }

    default:
      return { contentType: 'text/plain; charset=utf-8', content: '' }
  }
}

// ── Feature 1 : Détection des paths de login ──────────────────────────────────

const LOGIN_PATHS = [
  /^\/wp-admin(\/|$)/i,
  /^\/wp-login\.php/i,
  /^\/admin(\/|$)/i,
  /^\/phpmyadmin/i,
  /^\/administrator/i,
  /^\/login(\/|$)/i,
  /^\/pma(\/|$)/i,
  /^\/adminer/i,
  /^\/cpanel/i,
  /^\/panel(\/|$)/i,
  /^\/wp\/wp-admin/i,
  /^\/wordpress\/wp-admin/i,
]

function isLoginPath(path: string): boolean {
  return LOGIN_PATHS.some(r => r.test(path))
}

// ── Faux formulaire WordPress ─────────────────────────────────────────────────

function buildFakeLoginPage(incidentId: string, loginPath: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Log In ‹ My WordPress Site — WordPress</title>
<style>
  html { background:#f0f0f1; }
  body { background:#f0f0f1; color:#3c4146; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Oxygen-Sans,Ubuntu,Cantarell,"Helvetica Neue",sans-serif; font-size:13px; line-height:1.4em; margin:0; padding:0; }
  * { box-sizing:border-box; }
  #login { width:320px; margin:100px auto 0; padding:0; }
  #login h1 a {
    background-image:url(data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9Ii0yIC0yIDkwIDkwIj48cGF0aCBkPSJNNDEuNTYzIDguNTYyYy0xOC4yMjcgMC0zMi45OTggMTQuNzcyLTMyLjk5OCAzMy4wMDEgMCAxOC4yMjYgMTQuNzcxIDMyLjk5NiAzMi45OTggMzIuOTk2IDE4LjIyOCAwIDMzLTE0Ljc3IDMzLTMyLjk5NiAwLTE4LjIyOS0xNC43NzItMzMuMDAxLTMzLTMzLjAwMXoiIGZpbGw9IiMyMzFmMjAiLz48cGF0aCBkPSJNMTAuMzM1IDQxLjU2M2MwIDExLjk0IDYuOTA4IDIyLjI1OCAxNi45NDUgMjcuMjU1TDEzLjcxNCAyOC4xMDdhMzIuODkyIDMyLjg5MiAwIDAgMC0zLjM3OSAxMy40NTZ6TTYzLjAyIDQwLjE3N2MwLTMuNzI3LTEuMzM4LTYuMzA4LTIuNDg0LTguMzE3LTEuNTI3LTIuNDg0LTIuOTU3LTQuNTg1LTIuOTU3LTcuMDY5IDAtMi43NyAyLjEtNS4zNSA1LjA2My01LjM1LjEzNCAwIC4yNi4wMTcuMzkuMDIzYTMyLjk2IDMyLjk2IDAgMCAwLTIyLjA2OS04LjQ5M2MtMTEuNDEyIDAtMjEuNDY1IDUuODU2LTI3LjMzNiAxNC43NDQuNzY4LjAyMyAxLjQ5Mi4wMzggMi4xMDguMDM4IDMuNDI3IDAgOC43MzUtLjQxNyA4LjczNS0uNDE3IDEuNzY3LS4xMDQgMS45NzUgMi40ODkuMjEgMi42OTMgMCAwLTEuNzc1LjIwOC0zLjc1LjMxM2wxMS45MzMgMzUuNDkgNi45NzEtMjAuOTA2LTQuOTYzLTE0LjU4NGMtMS43NjYtLjEwNC0zLjQzOC0uMzEzLTMuNDM4LS4zMTMtMS43NjctLjEwNC0xLjU1OC0yLjc5OS4yMDgtMi42OTMgMCAwIDUuNDE0LjQxNyA4LjYzLjQxNyAzLjQyNyAwIDguNzM2LS40MTcgOC43MzYtLjQxNyAxLjc2OC0uMTA0IDEuOTc2IDIuNDg5LjIxMiAyLjY5MyAwIDAtMS43NzcuMjA4LTMuNzUyLjMxM2wxMS44NDIgMzUuMjI1IDMuMjY4LTEwLjkxNmMxLjQxNS00LjUzNiAyLjQ5NS04Ljk3MSAyLjQ5NS0xMi4yMzd6TTQyLjEgNDQuMjFsLTkuODMxIDI4LjU3MmEzMi45NzIgMzIuOTcyIDAgMCAwIDIwLjI2Mi0uNTI3IDIuOTI3IDIuOTI3IDAgMCAxLS4yMzQtLjQ1NkwzNy41NjYgMjkuMDkgNDIuMSA0NC4yMXpNNjguNDM0IDI3LjQwNWEyNS42MjMgMjUuNjIzIDAgMCAxIC4yMTcgMy4yOTRjMCAzLjI1Ni0uNjA5IDYuOTExLTIuNDMzIDExLjQ4NUw1NS43MTcgNjguNTk0YzEwLjU1Ni01Ljk1NiAxNy42NjYtMTcuMDc3IDE3LjY2Ni0yOS44NjhhMzMuMDU0IDMzLjA1NCAwIDAgMC00Ljk0OS0xNy4zMjF6IiBmaWxsPSIjZmZmIi8+PC9zdmc+);
    background-size:84px;
    background-repeat:no-repeat;
    background-position:center top;
    display:block; width:84px; height:84px;
    margin:0 auto 20px;
    text-indent:-9999px;
    outline:none;
    overflow:hidden;
  }
  #loginform, #lostpasswordform { background:#fff; border:1px solid #c3c4c7; border-bottom:1px solid #a7aaad; border-radius:4px; box-shadow:0 1px 3px rgba(0,0,0,.04); overflow:hidden; padding:26px 24px 46px; }
  #loginform p { margin:0 0 16px; padding:0; }
  label { font-size:14px; font-weight:400; display:block; margin-bottom:4px; color:#3c4146; }
  input[type=text], input[type=password] {
    background:#fff; border:1px solid #8c8f94; border-radius:4px; box-shadow:0 0 0 transparent;
    color:#2c3338; display:block; font-size:24px; line-height:1.33333333; padding:3px 10px;
    width:100%; margin:0 0 16px; transition:100ms;
  }
  input[type=text]:focus, input[type=password]:focus { border-color:#2271b1; box-shadow:0 0 0 1px #2271b1; outline:2px solid transparent; }
  input[type=submit] {
    background:#2271b1; border-color:#2271b1; color:#fff; cursor:pointer;
    display:inline-block; font-size:13px; font-weight:400; line-height:2.15384615;
    padding:0 10px; text-decoration:none; white-space:nowrap; border-radius:3px;
    border:1px solid; margin:0; width:100%; font-size:15px; padding: 5px 10px;
    transition:background 0.1s;
  }
  input[type=submit]:hover { background:#135e96; border-color:#135e96; }
  .forgetmenot { float:left; }
  input[type=checkbox] { margin-right:6px; }
  .submit { display:flex; align-items:center; justify-content:space-between; }
  #nav a, #backtoblog a { font-size:13px; text-decoration:none; color:#50575e; }
  #nav a:hover, #backtoblog a:hover { color:#2271b1; }
  #nav { padding:0 24px 10px; text-align:center; font-size:13px; }
  #backtoblog { padding:5px 24px 20px; text-align:center; font-size:13px; }
  .login-action-login #nav { display:block; }
  p.message { background:#fff; border-left:4px solid #72aee6; margin:0 0 16px; padding:10px 12px; }
  .wp-login-logo-white { filter:invert(1); }
</style>
</head>
<body class="login wp-core-ui login-action-login">
<div id="login">
  <h1><a href="https://wordpress.org/" title="Powered by WordPress" tabindex="-1">My WordPress Site</a></h1>

  <form name="loginform" id="loginform" action="/api/v1/_hp_login" method="post">
    <p>
      <label for="user_login">Username or Email Address</label>
      <input type="text" name="log" id="user_login" class="input" value="" size="20" autocapitalize="none" autocomplete="username" required />
    </p>
    <p>
      <label for="user_pass">Password</label>
      <input type="password" name="pwd" id="user_pass" class="input" value="" size="20" autocomplete="current-password" required />
    </p>
    <p class="forgetmenot"><label for="rememberme"><input name="rememberme" type="checkbox" id="rememberme" value="forever" /> Remember Me</label></p>
    <p class="submit">
      <input type="submit" name="wp-submit" id="wp-submit" class="button button-primary button-large" value="Log In" />
    </p>
    <input type="hidden" name="_incident" value="${escHtml(incidentId)}" />
    <input type="hidden" name="_origin_path" value="${escHtml(loginPath)}" />
  </form>

  <p id="nav"><a href="/wp-login.php?action=lostpassword">Lost your password?</a></p>
  <p id="backtoblog"><a href="/">&larr; Go to My WordPress Site</a></p>
</div>
</body>
</html>`
}

// ── Page terminal "scary" ─────────────────────────────────────────────────────

function buildScaryPage(
  ip:         string,
  path:       string,
  method:     string,
  ua:         string,
  geo:        GeoInfo,
  incidentId: string,
): string {
  const ts      = new Date().toISOString()
  const tool    = detectTool(ua)
  const ports   = fakePortScan(ip)
  const evHash  = evidenceHash(incidentId, ip, path, ts)
  const isBrowser = /mozilla/i.test(ua)

  const portRows = ports.map(p => {
    const stateColor = p.state === 'open' ? '#ff4444' : p.state === 'filtered' ? '#ffaa00' : '#666'
    return `<div class="row"><span class="key">&nbsp;&nbsp;${String(p.port).padEnd(6)}/${p.proto}</span><span style="color:${stateColor};min-width:70px;flex-shrink:0">${p.state}</span><span class="val dim">${p.service}</span></div>`
  }).join('\n')

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>403 — Unauthorized Access Detected</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { background:#050505; color:#33ff33; font-family:'Courier New',Courier,monospace;
         display:flex; align-items:center; justify-content:center; min-height:100vh; padding:1rem; }
  .box { width:100%; max-width:720px; border:1px solid #1c3a1c;
         background:#080808; border-radius:4px; overflow:hidden;
         box-shadow:0 0 80px rgba(51,255,51,0.05); }
  .topbar { background:#0d1a0d; border-bottom:1px solid #1c3a1c; padding:0.6rem 1rem;
            display:flex; align-items:center; gap:0.5rem; }
  .dot { width:11px; height:11px; border-radius:50%; }
  .d1{background:#ff3b30}.d2{background:#ffcc00}.d3{background:#28cd41}
  .title { margin-left:auto; margin-right:auto; font-size:0.72em; color:#2a5a2a; }
  .body { padding:1.6rem 1.8rem; }
  .warn { text-align:center; margin-bottom:1.6rem; }
  .warn .icon { font-size:2.2rem; display:block; margin-bottom:0.4rem; }
  .warn .label { color:#ff3333; font-size:1em; font-weight:bold; animation:blink 1.1s step-end infinite; }
  @keyframes blink { 50%{ opacity:0; } }
  .section { margin-bottom:1.1rem; }
  .section-title { color:#2a8a2a; font-size:0.72em; text-transform:uppercase;
                   letter-spacing:0.12em; margin-bottom:0.45rem; border-bottom:1px solid #0d200d; padding-bottom:0.3rem; }
  .row { display:flex; gap:0.5rem; font-size:0.82em; line-height:1.85; flex-wrap:wrap; }
  .key { color:#2a7a2a; min-width:200px; flex-shrink:0; }
  .val { color:#e8e8e8; }
  .val.dim { color:#888; }
  .val.warn { color:#ff4444; }
  .val.ok   { color:#33ff33; }
  .val.amber{ color:#ffaa00; }
  .path { color:#ffcc00; word-break:break-all; }
  .sep { border-top:1px solid #0d200d; margin:1rem 0; }
  .id { color:#ff9944; }
  .hash { color:#888; font-size:0.75em; word-break:break-all; }
  .legal { margin-top:1.2rem; padding:0.9rem 1.1rem; border:1px solid #2a1a00;
           background:#0a0600; border-radius:3px; }
  .legal p { font-size:0.76em; color:#886644; line-height:1.7; margin-bottom:0.35rem; }
  .legal p:last-child { margin-bottom:0; color:#664422; }
  .cursor { display:inline-block; width:8px; height:13px; background:#33ff33;
            animation:blink 1s step-end infinite; vertical-align:middle; }
  .progress-wrap { margin-top:0.4rem; }
  .progress-label { font-size:0.78em; color:#2a7a2a; margin-bottom:0.2rem; }
  .progress-bar { height:6px; background:#0d200d; border-radius:2px; overflow:hidden; }
  .progress-fill { height:100%; background:#33ff33; border-radius:2px;
                   animation:fill 4s ease forwards; }
  @keyframes fill { from{width:0%} to{width:100%} }
  .countdown { font-size:0.82em; }
  .countdown span { color:#ff4444; font-weight:bold; }
  #js-section { margin-top:0; }
  /* Feature 2 — fingerprint reconnu */
  #fp-warning { display:none; margin-top:0.5rem; padding:0.4rem 0.6rem;
                background:rgba(255,0,0,0.08); border:1px solid #550000; border-radius:3px; }
  #fp-warning span { color:#ff4444; font-weight:bold; font-size:0.8em; }
  /* L'Effet Procureur */
  #procureur { margin-top:1.2rem; padding:1rem 1.2rem; border:1px solid #550000;
               background:#0a0000; border-radius:3px; min-height:2.5rem; }
  #procureur .p-line { font-size:0.82em; line-height:2; white-space:pre; }
  #procureur .p-cursor { display:inline-block; width:8px; height:13px;
                         background:#ff4444; animation:blink 0.7s step-end infinite;
                         vertical-align:middle; margin-left:2px; }
  #procureur .p-bar-wrap { margin:0.3rem 0 0.1rem; }
  #procureur .p-bar-label { font-size:0.75em; color:#884444; }
  #procureur .p-bar { height:5px; background:#1a0000; border-radius:2px; overflow:hidden; margin-top:2px; }
  #procureur .p-bar-fill { height:100%; border-radius:2px; width:0%; transition:width 0.05s linear; }
  @keyframes proc-flash { 0%,100%{opacity:1} 50%{opacity:0.3} }
  #procureur.flash { animation:proc-flash 0.15s ease 3; }
</style>
</head>
<body>
<div class="box">
  <div class="topbar">
    <div class="dot d1"></div><div class="dot d2"></div><div class="dot d3"></div>
    <span class="title">nodyx-security-monitor v2 — intrusion_detection.log</span>
  </div>
  <div class="body">

    <div class="warn">
      <span class="icon">⚠</span>
      <div class="label">UNAUTHORIZED ACCESS ATTEMPT DETECTED</div>
    </div>

    <div class="section">
      <div class="section-title">// 01 — Network identification</div>
      <div class="row"><span class="key">IP Address</span><span class="val warn">${escHtml(ip)}</span></div>
      <div class="row"><span class="key">Reverse DNS</span><span class="val dim">${escHtml(geo.reverse)}</span></div>
      <div class="row"><span class="key">ASN</span><span class="val dim">${escHtml(geo.as)}</span></div>
      <div class="row"><span class="key">ISP / Org</span><span class="val">${escHtml(geo.isp)}</span></div>
      <div class="row"><span class="key">Location</span><span class="val">${escHtml(geo.city)}, ${escHtml(geo.country)}</span></div>
      <div class="row"><span class="key">Coordinates</span><span class="val dim">${geo.lat.toFixed(4)}°N ${geo.lon.toFixed(4)}°E</span></div>
      <div class="row"><span class="key">Timezone</span><span class="val dim">${escHtml(geo.timezone)}</span></div>
    </div>

    <div class="sep"></div>

    <div class="section">
      <div class="section-title">// 02 — Anonymization analysis</div>
      ${(() => {
        const isAnon  = geo.proxy || geo.hosting
        const level   = isAnon ? 'PARTIAL' : 'NONE'
        const levelCl = isAnon ? 'amber'   : 'warn'
        const verdict = !isAnon
          ? `<span class="val warn" style="font-weight:bold">⚠ AUCUNE ANONYMISATION DÉTECTÉE — Connexion résidentielle directe</span>`
          : geo.proxy
            ? `<span class="val amber">Proxy/VPN exit node — L'IP d'origine peut différer</span>`
            : `<span class="val amber">IP datacenter/cloud — Infrastructure d'hébergement</span>`
        return `
      <div class="row"><span class="key">Proxy / VPN</span><span class="${geo.proxy ? 'val amber' : 'val ok'}">${geo.proxy ? '✓ DÉTECTÉ' : '✗ NON DÉTECTÉ'}</span></div>
      <div class="row"><span class="key">Datacenter / Hosting</span><span class="${geo.hosting ? 'val amber' : 'val ok'}">${geo.hosting ? '✓ IP CLOUD/HOSTING' : '✗ NON'}</span></div>
      <div class="row"><span class="key">Réseau mobile</span><span class="val dim">${geo.mobile ? '✓ OUI' : '✗ NON'}</span></div>
      <div class="row"><span class="key">Niveau d'anonymat</span><span class="val ${levelCl}">◉ ${level}</span></div>
      <div class="row" style="margin-top:0.3rem">${verdict}</div>
      ${!isAnon ? `<div class="row"><span class="key" style="min-width:unset;color:#ff3333;font-size:0.8em">→ Cette IP est directement attribuable à votre personne. Votre fournisseur ${escHtml(geo.isp)} peut identifier l'abonné sur réquisition judiciaire.</span></div>` : ''}
      ${isBrowser ? `<div class="row" style="margin-top:0.3rem"><span class="key">WebRTC real IP</span><span class="val warn" id="js-rtc">analyse en cours…</span></div>` : ''}`
      })()}
    </div>

    <div class="sep"></div>

    <div class="section">
      <div class="section-title">// 03 — Attack tool fingerprint</div>
      <div class="row"><span class="key">Tool detected</span><span class="val warn">${escHtml(tool.name)}</span></div>
      <div class="row"><span class="key">Tool type</span><span class="val">${escHtml(tool.type)}</span></div>
      ${tool.fakePath ? `<div class="row"><span class="key">Executable path</span><span class="val amber">${escHtml(tool.fakePath)}</span></div>` : ''}
      <div class="row"><span class="key">User-Agent</span><span class="val dim" style="font-size:0.78em">${escHtml(ua.slice(0, 120))}</span></div>
      <div class="row"><span class="key">HTTP Method</span><span class="val">${escHtml(method)}</span></div>
      <div class="row"><span class="key">Targeted path</span><span class="path">${escHtml(path)}</span></div>
    </div>

    ${isBrowser ? `
    <div class="sep"></div>
    <div class="section" id="js-section">
      <div class="section-title">// 04 — Client system fingerprint</div>
      <div class="row"><span class="key">Screen resolution</span><span class="val warn" id="js-screen">scanning…</span></div>
      <div class="row"><span class="key">Color depth</span><span class="val dim" id="js-depth">—</span></div>
      <div class="row"><span class="key">Device pixel ratio</span><span class="val dim" id="js-dpr">—</span></div>
      <div class="row"><span class="key">Operating system</span><span class="val warn" id="js-platform">—</span></div>
      <div class="row"><span class="key">Language(s)</span><span class="val dim" id="js-lang">—</span></div>
      <div class="row"><span class="key">CPU cores</span><span class="val amber" id="js-cores">—</span></div>
      <div class="row"><span class="key">RAM (approx.)</span><span class="val amber" id="js-ram">—</span></div>
      <div class="row"><span class="key">GPU renderer</span><span class="val warn" id="js-gpu">computing…</span></div>
      <div class="row"><span class="key">Timezone (browser)</span><span class="val dim" id="js-tz">—</span></div>
      <div class="row"><span class="key">Timezone (IP geo)</span><span class="val dim">${geo.timezone}</span></div>
      <div class="row"><span class="key">VPN detected (TZ mismatch)</span><span class="val" id="js-vpn">analysing…</span></div>
      <div class="row"><span class="key">Touch points</span><span class="val dim" id="js-touch">—</span></div>
      <div class="row"><span class="key">Network type</span><span class="val dim" id="js-net">—</span></div>
      <div class="row"><span class="key">Browser plugins</span><span class="val dim" id="js-plugins">—</span></div>
      <div class="row"><span class="key">Fonts detected</span><span class="val dim" id="js-fonts">—</span></div>
      <div class="row"><span class="key">Audio fingerprint</span><span class="val dim" id="js-audio">computing…</span></div>
      <div class="row"><span class="key">Canvas fingerprint</span><span class="val amber" id="js-fp">computing…</span></div>
      <div id="fp-warning"><span>⚠ EMPREINTE RECONNUE — </span><span id="fp-warning-text"></span></div>
    </div>` : ''}

    <div class="sep"></div>

    <div class="section">
      <div class="section-title">// ${isBrowser ? '05' : '04'} — Port reconnaissance (your host)</div>
      ${portRows}
    </div>

    <div class="sep"></div>

    <div class="section">
      <div class="section-title">// ${isBrowser ? '06' : '05'} — Incident record</div>
      <div class="row"><span class="key">Reference ID</span><span class="id">${incidentId}</span></div>
      <div class="row"><span class="key">Timestamp (UTC)</span><span class="val dim">${ts}</span></div>
      <div class="row"><span class="key">Evidence hash (SHA-256)</span></div>
      <div class="row"><span class="hash">${evHash}</span></div>
    </div>

    <div class="sep"></div>

    <div class="section">
      <div class="section-title">// ${isBrowser ? '07' : '06'} — Response status</div>
      <div class="row"><span class="key">DB record</span><span class="val ok">✓ committed</span></div>
      <div class="row"><span class="key">Tracking pixel</span><span class="val ok">✓ deployed — monitoring revisits</span></div>
      <div class="row"><span class="key">fail2ban</span><span class="val ok">✓ IP banned (7 days)</span></div>
      <div class="row"><span class="key">ISP abuse report</span><span class="val ok">✓ sent to abuse@${escHtml(geo.isp.toLowerCase().replace(/[^a-z0-9]/g,'-').replace(/-+/g,'-'))}.net</span></div>
      <div class="row"><span class="key">CERT-FR notification</span><span class="val countdown">in <span id="countdown">05:00</span> <span class="cursor"></span></span></div>
      <div class="progress-wrap" style="margin-top:0.6rem">
        <div class="progress-label">Packaging evidence archive…</div>
        <div class="progress-bar"><div class="progress-fill"></div></div>
      </div>
    </div>

    <div id="procureur"><span class="p-cursor"></span></div>

    <div class="legal">
      <p>This access attempt has been recorded in full: IP, headers, tool fingerprint, geolocation, canvas fingerprint and timestamp are archived as legal evidence.</p>
      <p>Unauthorized access to a computer system is a criminal offence — Code Pénal art. 323-1 (up to 2 years imprisonment, €60 000 fine) and EU Directive 2013/40/EU.</p>
      <p>Evidence reference <strong>${incidentId}</strong> has been transmitted to the platform security team.</p>
      <p style="margin-top:0.6rem;font-size:0.68em"><a href="/api/v1/_hp?p=/_ht&amp;ht=1" style="color:#1a2a1a;text-decoration:none;font-size:0.9em">Dispute this automated report</a></p>
    </div>

  </div>
</div>

<!-- Feature 3 : Honeytokens invisibles -->
<a href="/api/v1/_hp?p=/_ht&ht=1" style="position:absolute;top:-9999px;left:-9999px;opacity:0;pointer-events:none;font-size:0" aria-hidden="true" tabindex="-1"> </a>
<a href="/api/v1/_hp?p=/_ht&ht=1" style="position:absolute;top:-9998px;left:-9999px;opacity:0;pointer-events:none;font-size:0" aria-hidden="true" tabindex="-1"> </a>
<a href="/api/v1/_hp?p=/_ht&ht=1" style="position:absolute;top:-9997px;left:-9999px;opacity:0;pointer-events:none;font-size:0" aria-hidden="true" tabindex="-1"> </a>

<img src="/api/v1/_hp_px/${incidentId}" width="1" height="1"
     style="position:absolute;top:-9999px;left:-9999px;pointer-events:none" alt="" loading="eager">

<script>
// Countdown CERT-FR
(function(){
  var s = 300;
  var el = document.getElementById('countdown');
  if(!el) return;
  var t = setInterval(function(){
    s--;
    if(s <= 0){ clearInterval(t); el.textContent = '00:00'; return; }
    var m = Math.floor(s/60), sec = s%60;
    el.textContent = String(m).padStart(2,'0') + ':' + String(sec).padStart(2,'0');
  }, 1000);
})();

// ── ALARME STRIDENTE ─────────────────────────────────────────────────────────
(function(){
  var fired = false;
  function playAlarm() {
    if (fired) return; fired = true;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      var ctx = new AC();
      function tone(freq, start, dur, vol) {
        var o = ctx.createOscillator();
        var g = ctx.createGain();
        o.type = 'square';
        o.frequency.value = freq;
        g.gain.setValueAtTime(0, ctx.currentTime + start);
        g.gain.linearRampToValueAtTime(vol, ctx.currentTime + start + 0.01);
        g.gain.linearRampToValueAtTime(vol, ctx.currentTime + start + dur - 0.02);
        g.gain.linearRampToValueAtTime(0, ctx.currentTime + start + dur);
        o.connect(g); g.connect(ctx.destination);
        o.start(ctx.currentTime + start);
        o.stop(ctx.currentTime + start + dur + 0.01);
      }
      // Sirène : 150 cycles = ~27 secondes schedulées dans le buffer audio
      // Persiste après fermeture d'onglet sur Chromium/Linux (thread audio séparé)
      for (var i = 0; i < 150; i++) {
        var t0 = i * 0.18;
        tone(960, t0,        0.08, 0.30);
        tone(480, t0 + 0.09, 0.08, 0.24);
      }
      // Toutes les 3 secondes : bip grave de rappel (encore plus flippant)
      for (var j = 0; j < 9; j++) {
        tone(180, j * 3.0 + 2.5, 0.35, 0.20);
      }
    } catch(e) {}
  }
  ['mousemove','scroll','keydown','touchstart','click'].forEach(function(ev) {
    document.addEventListener(ev, playAlarm, { once: true, passive: true });
  });
})();

// ── L'EFFET PROCUREUR ────────────────────────────────────────────────────────
(function(){
  var box = document.getElementById('procureur');
  if (!box) return;

  var anonLevel = '${geo.proxy ? 'PARTIELLE — Proxy/VPN détecté' : geo.hosting ? 'PARTIELLE — IP datacenter' : 'AUCUNE — Connexion résidentielle directe ⚠'}';
  var vpnFlag   = '${geo.proxy || geo.hosting ? 'OUI' : 'NON — IP directement attribuable'}';

  var LINES = [
    { t: '█ DOSSIER PÉNAL OUVERT',                                     c: '#ff3333', d: 600  },
    { t: '█ Réf. ${incidentId}',                                        c: '#ff9944', d: 1300 },
    { t: '',                                                              c: '',        d: 1900 },
    { t: '  IP source ............. ${escHtml(ip)}',                    c: '#ffcc00', d: 2400 },
    { t: '  FAI ................... ${escHtml(geo.isp)}',               c: '#e8e8e8', d: 3000 },
    { t: '  Localisation .......... ${escHtml(geo.city)}, ${escHtml(geo.country)}', c: '#e8e8e8', d: 3600 },
    { t: '  Anonymisation ......... ' + anonLevel,                       c: '#ffaa00', d: 4300 },
    { t: '',                                                              c: '',        d: 4900 },
    { t: '  Art. 323-1 CP ......... ACCÈS FRAUDULEUX — CARACTÉRISÉ',    c: '#ff4444', d: 5400 },
    { t: '  Art. 323-2 CP ......... ENTRAVE STAD — EN ÉVALUATION',      c: '#ff6644', d: 6100 },
    { t: '',                                                              c: '',        d: 6700 },
    { t: '  [TRANSMISSION EN COURS]',                                    c: '#33ff33', d: 7200, bar: true, label: 'CERT-FR → ANSSI', col: '#33ff33' },
    { t: '  [TRANSMISSION EN COURS]',                                    c: '#33aaff', d: 9800, bar: true, label: 'MISP → Europol / Interpol', col: '#33aaff' },
    { t: '',                                                              c: '',        d: 12400 },
    { t: '  Votre dossier est complet. Vous pouvez partir.',             c: '#888',    d: 13000 },
    { t: '  Il ne partira pas.',                                         c: '#ff3333', d: 14000 },
  ];

  // Vider le box et supprimer le curseur initial
  box.innerHTML = '';

  LINES.forEach(function(line) {
    setTimeout(function() {
      if (line.bar) {
        // Barre de progression
        var wrap = document.createElement('div');
        wrap.className = 'p-bar-wrap';
        wrap.innerHTML =
          '<div class="p-bar-label" style="color:' + line.col + '">' + line.label + '</div>' +
          '<div class="p-bar"><div class="p-bar-fill" style="background:' + line.col + '"></div></div>';
        box.appendChild(wrap);
        // Flash du box
        box.classList.add('flash');
        setTimeout(function(){ box.classList.remove('flash'); }, 500);
        // Remplissage barre
        var fill = wrap.querySelector('.p-bar-fill');
        var pct  = 0;
        var iv = setInterval(function(){
          pct += 1.2;
          if (pct >= 100) { pct = 100; clearInterval(iv); }
          fill.style.width = pct + '%';
        }, 22);
      } else {
        var div = document.createElement('div');
        div.className = 'p-line';
        div.style.color = line.c || '#e8e8e8';
        div.textContent = line.t;
        box.appendChild(div);
        // Scroll automatique
        box.scrollTop = box.scrollHeight;
      }
    }, line.d);
  });
})();

${isBrowser ? `
// Browser fingerprint (données réelles)
(function(){
  try {
    document.getElementById('js-screen').textContent   = screen.width + 'x' + screen.height;
    document.getElementById('js-depth').textContent    = screen.colorDepth + ' bits';
    document.getElementById('js-dpr').textContent      = (window.devicePixelRatio || 1).toFixed(2) + 'x';
    document.getElementById('js-platform').textContent = navigator.platform || (navigator.userAgentData && navigator.userAgentData.platform) || '—';
    document.getElementById('js-lang').textContent     = navigator.language + ' [' + (navigator.languages||[navigator.language]).join(', ') + ']';
    document.getElementById('js-cores').textContent    = (navigator.hardwareConcurrency || '?') + ' logical cores';
    document.getElementById('js-ram').textContent      = navigator.deviceMemory ? navigator.deviceMemory + ' GB (approx.)' : 'non exposé';
    document.getElementById('js-tz').textContent       = Intl.DateTimeFormat().resolvedOptions().timeZone;
    document.getElementById('js-touch').textContent    = (navigator.maxTouchPoints || 0) + ' points';
    document.getElementById('js-net').textContent      = (navigator.connection && navigator.connection.effectiveType) ? navigator.connection.effectiveType : 'non exposé';
    document.getElementById('js-plugins').textContent  = (navigator.plugins ? navigator.plugins.length : 0) + ' plugins detected';
    // Canvas fingerprint
    var c = document.createElement('canvas');
    var ctx = c.getContext('2d');
    var fpHash = '';
    if(ctx){
      ctx.textBaseline='alphabetic'; ctx.font='14px Arial';
      ctx.fillStyle='#f60'; ctx.fillRect(125,1,62,20);
      ctx.fillStyle='#069'; ctx.fillText('nodyx-trace',2,15);
      ctx.fillStyle='rgba(102,204,0,0.7)'; ctx.fillText('nodyx-trace',4,17);
      var raw = c.toDataURL().slice(-32);
      var fp = '';
      for(var i=0;i<raw.length;i++) fp += raw.charCodeAt(i).toString(16).padStart(2,'0');
      fpHash = fp.slice(0,32).toUpperCase();
      document.getElementById('js-fp').textContent = fpHash;
    }
    // GPU via WebGL (UNMASKED_RENDERER = carte graphique exacte)
    var gpuVendor = '', gpuRenderer = '';
    try {
      var glc = document.createElement('canvas');
      var gl = glc.getContext('webgl') || glc.getContext('experimental-webgl');
      if(gl) {
        var dbgExt = gl.getExtension('WEBGL_debug_renderer_info');
        if(dbgExt) {
          gpuVendor   = gl.getParameter(dbgExt.UNMASKED_VENDOR_WEBGL)   || '';
          gpuRenderer = gl.getParameter(dbgExt.UNMASKED_RENDERER_WEBGL) || '';
        } else {
          gpuVendor   = gl.getParameter(gl.VENDOR)   || '';
          gpuRenderer = gl.getParameter(gl.RENDERER) || '';
        }
        var gpuEl = document.getElementById('js-gpu');
        if(gpuEl && gpuRenderer) gpuEl.textContent = gpuRenderer + (gpuVendor ? ' / ' + gpuVendor : '');
      }
    } catch(e) {}

    // Audio fingerprint (signature matérielle unique)
    var audioFP = '';
    try {
      var AudioCtx = window.AudioContext || window.webkitAudioContext;
      if(AudioCtx) {
        var actx = new AudioCtx({ sampleRate: 44100 });
        var osc  = actx.createOscillator();
        var comp = actx.createDynamicsCompressor();
        var anal = actx.createAnalyser();
        osc.connect(comp); comp.connect(anal); anal.connect(actx.destination);
        osc.type = 'triangle'; osc.frequency.value = 440;
        osc.start(0);
        var fbuf = new Float32Array(anal.frequencyBinCount);
        anal.getFloatFrequencyData(fbuf);
        osc.stop(0); actx.close();
        audioFP = Array.from(fbuf.slice(0,8)).map(function(v){ return (Math.round(v*100)/100).toString(); }).join('|');
        var afEl = document.getElementById('js-audio');
        if(afEl) afEl.textContent = audioFP ? audioFP.slice(0,40) + '…' : 'non disponible';
      }
    } catch(e) { var ae2 = document.getElementById('js-audio'); if(ae2) ae2.textContent = 'non disponible'; }

    // Polices disponibles (détection canvas)
    var fontsCount = 0;
    try {
      var testFonts = ['Arial','Helvetica','Times New Roman','Courier New','Georgia','Verdana',
        'Impact','Comic Sans MS','Palatino Linotype','Tahoma','Ubuntu','DejaVu Sans',
        'Segoe UI','Roboto','SF Pro','Noto Sans','Open Sans'];
      var fc2 = document.createElement('canvas'); fc2.width=200; fc2.height=30;
      var cx2 = fc2.getContext('2d');
      cx2.font='12px monospace';
      var bw = cx2.measureText('Wabcdefghijklm0123456789').width;
      fontsCount = testFonts.filter(function(f){
        cx2.font='12px '+f+',monospace';
        return Math.abs(cx2.measureText('Wabcdefghijklm0123456789').width - bw) > 0.1;
      }).length;
      var ffEl = document.getElementById('js-fonts');
      if(ffEl) ffEl.textContent = fontsCount + '/' + testFonts.length + ' reconnus';
    } catch(e) {}

    // Comportement (temps de réaction — human vs bot)
    var pageLoadTs = Date.now();
    var firstMouseMove = 0;
    document.addEventListener('mousemove', function(){ if(!firstMouseMove) firstMouseMove = Date.now() - pageLoadTs; }, { once: true, passive: true });

    // Feature — envoyer l'intelligence complète au serveur
    if(fpHash) {
      var tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      var geoTz = '${geo.timezone}'; // timezone côté serveur (ip-api.com)
      var vpnSuspect = (tz && geoTz && geoTz !== '—' && tz !== geoTz);
      if(vpnSuspect) {
        var vpnEl = document.getElementById('js-vpn');
        if(vpnEl) { vpnEl.textContent = 'DÉTECTÉ — TZ navigateur: ' + tz + ' / IP géo: ' + geoTz; vpnEl.style.color='#ff4444'; }
      }

      setTimeout(function(){
        fetch('/api/v1/_hp_fp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            incident_id:     '${incidentId}',
            fp_hash:         fpHash,
            screen:          screen.width + 'x' + screen.height,
            cores:           navigator.hardwareConcurrency || 0,
            tz:              tz,
            gpu_vendor:      gpuVendor,
            gpu_renderer:    gpuRenderer,
            device_memory:   navigator.deviceMemory || 0,
            languages:       (navigator.languages || [navigator.language]).join(','),
            dpr:             window.devicePixelRatio || 1,
            touch_points:    navigator.maxTouchPoints || 0,
            connection_type: (navigator.connection && navigator.connection.effectiveType) || '',
            audio_fp:        audioFP,
            fonts_count:     fontsCount,
            color_depth:     screen.colorDepth || 0,
            tz_mismatch:     vpnSuspect,
            browser_tz:      tz,
            geo_tz:          geoTz,
            time_to_action:  firstMouseMove || 0,
          })
        }).then(function(r){ return r.json(); }).then(function(data){
          if(data && data.seen) {
            var warn = document.getElementById('fp-warning');
            var txt  = document.getElementById('fp-warning-text');
            if(warn && txt) {
              txt.textContent = 'Déjà détecté ' + data.visits + ' fois' + (data.otherIps && data.otherIps.length > 0 ? ' depuis ' + data.otherIps.join(', ') : '');
              warn.style.display = 'block';
            }
          }
        }).catch(function(){});
      }, 800); // délai court pour laisser audio FP se terminer
    }
  } catch(e){}
})();

// WebRTC IP leak detection
(function(){
  var rtcEl = document.getElementById('js-rtc');
  if(!rtcEl) return;
  try {
    var pc = new RTCPeerConnection({ iceServers: [] });
    var ips = new Set();
    pc.createDataChannel('');
    pc.onicecandidate = function(e) {
      if(!e || !e.candidate) return;
      var m = e.candidate.candidate.match(/([0-9]{1,3}(?:\\.[0-9]{1,3}){3}|[a-f0-9]{1,4}(?::[a-f0-9]{0,4}){7})/i);
      if(!m) return;
      var ip = m[1];
      if(ip === '${ip}') return; // already known
      if(/^(10\\.|172\\.(1[6-9]|2[0-9]|3[01])\\.|192\\.168\\.|127\\.|::1|fc|fd|fe80)/i.test(ip)) {
        // Private IP — montre comme IP locale
        if(rtcEl.textContent === 'analyse en cours…') rtcEl.textContent = ip + ' (réseau local)';
        return;
      }
      if(ips.has(ip)) return;
      ips.add(ip);
      rtcEl.textContent = ip + ' ← IP RÉELLE CAPTURÉE VIA WebRTC';
      rtcEl.style.color = '#ff4444';
      rtcEl.style.fontWeight = 'bold';
      // Report au serveur
      fetch('/api/v1/_hp_rtc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ incident_id: '${incidentId}', rtc_ip: ip })
      }).catch(function(){});
    };
    pc.createOffer().then(function(o){ return pc.setLocalDescription(o); }).catch(function(){});
    setTimeout(function(){
      pc.close();
      if(rtcEl.textContent === 'analyse en cours…') rtcEl.textContent = '(non divulgué — WebRTC bloqué)';
    }, 5000);
  } catch(e){ if(rtcEl) rtcEl.textContent = '(WebRTC non supporté)'; }
})();` : ''}
</script>
</body>
</html>`
}

// ── Route handler ─────────────────────────────────────────────────────────────

export default async function honeypotRoutes(fastify: FastifyInstance) {

  fastify.route({
    method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'],
    url:    '/_hp',
    handler: async (request, reply) => {

      const headers = request.headers
      const ip =
        (headers['cf-connecting-ip'] as string) ||
        (headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
        request.ip ||
        '0.0.0.0'

      const originalPath = decodeURIComponent((request.query as any).p || '/').slice(0, 512)
      const userAgent    = (headers['user-agent'] || '').slice(0, 512)
      const method       = request.method
      const incidentId   = genIncidentId()

      // ── Feature 3 : Honeytoken cliqué ────────────────────────────────────
      const isHoneytoken = (request.query as any).ht === '1' || (request.query as any).p === '/_ht'

      // ── 1. Log fichier (pour fail2ban) ────────────────────────────────────
      const logLine = `${new Date().toISOString()} HONEYPOT_HIT ip=${ip} path="${originalPath}" ua="${userAgent}" id=${incidentId}${isHoneytoken ? ' HONEYTOKEN=1' : ''}\n`
      try { fs.appendFileSync('/var/log/nodyx-honeypot.log', logLine) } catch { /* pass */ }

      // ── 2. Géoloc + tarpit en parallèle ──────────────────────────────────
      const tarpitMs = 3000 + Math.floor(Math.random() * 4000)
      const [geo] = await Promise.all([
        getGeoInfo(ip),
        new Promise<void>(r => setTimeout(r, tarpitMs)),
      ])

      // ── 3. DB insert ──────────────────────────────────────────────────────
      db.query(
        `INSERT INTO honeypot_hits
           (incident_id, ip, path, method, user_agent, headers, country, city, isp, org)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [incidentId, ip, originalPath, method, userAgent,
         JSON.stringify(headers), geo.country, geo.city, geo.isp, geo.org]
      ).catch(e => fastify.log.error('[honeypot] DB insert:', e))

      // ── 4. Détection du type de hit AVANT Discord (évite les doubles notifs) ─
      const webhookUrl  = process.env.HONEYPOT_DISCORD_WEBHOOK
      const tool        = detectTool(userAgent)
      const canary      = detectCanaryFile(originalPath)
      const isLogin     = isLoginPath(originalPath)

      // ── 5. Report to distributed blocklist ───────────────────────────────
      const directoryUrl   = (process.env.DIRECTORY_API_URL ?? '').replace(/\/$/, '')
      const directoryToken = process.env.DIRECTORY_TOKEN
      if (directoryUrl && directoryToken) {
        fetch(`${directoryUrl}/api/directory/report-ip`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ token: directoryToken, ip, reason: 'honeypot', path: originalPath }),
          signal:  AbortSignal.timeout(5000),
        }).catch(() => {})
      }

      // ── 6. Discord — UN seul embed par hit, selon le type ─────────────────
      if (webhookUrl) {
        if (isHoneytoken) {
          fetch(webhookUrl, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              embeds: [{
                title:       '🎯 HONEYTOKEN CLICKED — Attaquant humain confirmé',
                color:       0x00ff88,
                description: '**Un humain a cliqué sur un lien honeytoken — identité quasi-certaine**',
                fields: [
                  { name: 'IP',            value: `\`${ip}\``,                                                    inline: true  },
                  { name: 'Localisation',  value: `${geo.city}, ${geo.country}`,                                  inline: true  },
                  { name: 'Anonymisation', value: geo.proxy ? '⚠ Proxy/VPN' : geo.hosting ? '⚠ Datacenter' : '🔴 AUCUNE — IP directe', inline: false },
                  { name: 'ISP / ASN',     value: `${geo.isp} — ${geo.as}`,                                      inline: false },
                  { name: 'Incident ID',   value: `\`${incidentId}\``,                                           inline: false },
                  { name: 'User-Agent',    value: `\`${userAgent.slice(0, 120)}\``,                              inline: false },
                ],
                timestamp: new Date().toISOString(),
                footer:    { text: 'nodyx-security-monitor · honeytoken' },
              }]
            })
          }).catch(() => {})
          // MISP — honeytoken
          reportHoneypotToMISP({
            incidentId, ip,
            path: originalPath, method, userAgent,
            country: geo.country, city: geo.city, isp: geo.isp, timezone: geo.timezone,
            proxy: geo.proxy, hosting: geo.hosting,
            incidentType: 'honeytoken',
          }).catch(() => {})
          // Email CERT — honeytoken
          sendCERTEmail({
            incidentId, ip,
            city: geo.city, country: geo.country, isp: geo.isp,
            proxy: geo.proxy, hosting: geo.hosting,
            incidentType: 'honeytoken',
          }).catch(() => {})
        } else if (canary) {
          fetch(webhookUrl, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              embeds: [{
                title:  '📄 Canary File Accessed — tentative d\'exfiltration',
                color:  0xff8800,
                fields: [
                  { name: 'IP',            value: `\`${ip}\``,                                                    inline: true  },
                  { name: 'Localisation',  value: `${geo.city}, ${geo.country}`,                                  inline: true  },
                  { name: 'Anonymisation', value: geo.proxy ? '⚠ Proxy/VPN' : geo.hosting ? '⚠ Datacenter' : '🔴 AUCUNE — IP directe', inline: false },
                  { name: 'Fichier tenté', value: `\`${canary.label}\``,                                         inline: true  },
                  { name: 'Path',          value: `\`${originalPath}\``,                                         inline: true  },
                  { name: 'ISP / ASN',     value: `${geo.isp} — ${geo.as}`,                                     inline: false },
                  { name: 'Incident ID',   value: `\`${incidentId}\``,                                          inline: false },
                ],
                timestamp: new Date().toISOString(),
                footer:    { text: 'nodyx-security-monitor · canary-file' },
              }]
            })
          }).catch(() => {})
          // MISP — canary file
          reportHoneypotToMISP({
            incidentId, ip,
            path: originalPath, method, userAgent,
            country: geo.country, city: geo.city, isp: geo.isp, timezone: geo.timezone,
            proxy: geo.proxy, hosting: geo.hosting,
            incidentType: 'canary',
          }).catch(() => {})
          // Email CERT — canary file
          sendCERTEmail({
            incidentId, ip,
            city: geo.city, country: geo.country, isp: geo.isp,
            proxy: geo.proxy, hosting: geo.hosting,
            incidentType: 'canary',
          }).catch(() => {})
        } else if (isLogin) {
          // Faux login servi — pas de notif ici, la notif arrive quand ils soumettent les credentials
          // (pas de Discord pour ne pas spammer à chaque rechargement de la fausse page)
        } else {
          fetch(webhookUrl, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              embeds: [{
                title:  '🚨 Honeypot Hit',
                color:  0xff3333,
                fields: [
                  { name: 'IP',             value: `\`${ip}\``,                                                   inline: true  },
                  { name: 'Localisation',   value: `${geo.city}, ${geo.country}`,                                 inline: true  },
                  { name: 'Anonymisation',  value: geo.proxy ? '⚠ Proxy/VPN' : geo.hosting ? '⚠ Datacenter' : '🔴 AUCUNE — IP directe', inline: false },
                  { name: 'ISP / ASN',      value: `${geo.isp} — ${geo.as}`,                                     inline: false },
                  { name: 'Path',           value: `\`${originalPath}\``,                                        inline: true  },
                  { name: 'Method',         value: method,                                                        inline: true  },
                  { name: 'Tool',           value: `\`${tool.name}\``,                                           inline: false },
                  { name: 'Incident ID',    value: `\`${incidentId}\``,                                          inline: false },
                  { name: 'User-Agent',     value: `\`${userAgent.slice(0, 120)}\``,                             inline: false },
                ],
                timestamp: new Date().toISOString(),
                footer:    { text: 'nodyx-security-monitor' },
              }]
            })
          }).catch(() => {})
          // MISP — scan (filtré automatiquement si scan+VPN)
          reportHoneypotToMISP({
            incidentId, ip,
            path: originalPath, method, userAgent,
            country: geo.country, city: geo.city, isp: geo.isp, timezone: geo.timezone,
            proxy: geo.proxy, hosting: geo.hosting,
            incidentType: 'scan',
          }).catch(() => {})
        }
      }

      // ── Feature 1 : Faux login ────────────────────────────────────────────
      if (isLogin) {
        reply.header('Content-Type', 'text/html; charset=utf-8')
        return reply.code(200).send(buildFakeLoginPage(genIncidentId(), originalPath))
      }

      // ── Feature 4 : Canary file ───────────────────────────────────────────
      if (canary) {
        const { content, contentType } = buildCanaryContent(canary.type, ip)
        reply.header('Content-Type', contentType)
        reply.header('Content-Disposition', `inline; filename="${canary.label}"`)
        return reply.code(200).send(content)
      }

      // ── Feature 5 : Slowloris inversé — streaming de la scary page ────────
      const isBrowserUA = /mozilla/i.test(userAgent)
      const html = buildScaryPage(ip, originalPath, method, userAgent, geo, incidentId)

      const CHUNK    = isBrowserUA ? 96  : 256
      const DELAY_MS = isBrowserUA ? 180 : 80

      reply.hijack()
      const raw = reply.raw as import('http').ServerResponse
      raw.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' })

      for (let i = 0; i < html.length; i += CHUNK) {
        if (raw.destroyed) break
        raw.write(html.slice(i, i + CHUNK))
        await new Promise<void>(r => setTimeout(r, DELAY_MS))
      }
      if (!raw.destroyed) raw.end()
    }
  })

  // ── POST /_hp_login — Faux formulaire WordPress ───────────────────────────
  fastify.post<{ Body: { log?: string; pwd?: string; _incident?: string; _origin_path?: string } }>('/_hp_login', async (request, reply) => {
    const { log: username = '', pwd: password = '', _incident: incidentRef = '', _origin_path: loginPath = '/' } = request.body ?? {}

    const headers = request.headers
    const ip =
      (headers['cf-connecting-ip'] as string) ||
      (headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      request.ip ||
      '0.0.0.0'
    const userAgent  = (headers['user-agent'] || '').slice(0, 512)
    const incidentId = genIncidentId()

    // Géoloc
    const geo = await getGeoInfo(ip)

    // Log
    const logLine = `${new Date().toISOString()} CREDENTIAL_HARVEST ip=${ip} user="${username.slice(0,64)}" path="${loginPath.slice(0,128)}" id=${incidentId}\n`
    try { fs.appendFileSync('/var/log/nodyx-honeypot.log', logLine) } catch { /* pass */ }

    // DB insert
    db.query(
      `INSERT INTO honeypot_credential_attempts
         (incident_id, ip, login_path, username, password, country, city, isp, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [incidentId, ip, loginPath.slice(0, 256), username.slice(0, 128), password.slice(0, 256),
       geo.country, geo.city, geo.isp, userAgent]
    ).catch(e => fastify.log.error('[honeypot] credential DB insert:', e))

    // Discord alert
    const webhookUrl = process.env.HONEYPOT_DISCORD_WEBHOOK
    if (webhookUrl) {
      fetch(webhookUrl, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          embeds: [{
            title:  '🔑 Credential Harvest',
            color:  0xff00cc,
            fields: [
              { name: 'IP',            value: `\`${ip}\``,                                              inline: true  },
              { name: 'Localisation',  value: `${geo.city}, ${geo.country}`,                            inline: true  },
              { name: 'Anonymisation', value: geo.proxy ? '⚠ Proxy/VPN' : geo.hosting ? '⚠ Datacenter' : '🔴 AUCUNE — IP directe', inline: false },
              { name: 'ISP / ASN',     value: `${geo.isp} — ${geo.as}`,                               inline: false },
              { name: 'Path tenté',    value: `\`${loginPath.slice(0, 128)}\``,                        inline: true  },
              { name: 'Username',      value: `\`${username.slice(0, 64) || '(vide)'}\``,              inline: true  },
              { name: 'Password',      value: `\`${password.slice(0, 64) || '(vide)'}\``,              inline: false },
              { name: 'Incident ID',   value: `\`${incidentId}\``,                                    inline: false },
              { name: 'Incident Réf',  value: `\`${incidentRef.slice(0, 32) || '—'}\``,               inline: false },
            ],
            timestamp: new Date().toISOString(),
            footer:    { text: 'nodyx-security-monitor · credential-harvest' },
          }]
        })
      }).catch(() => {})
    }

    // MISP — credential harvest
    reportHoneypotToMISP({
      incidentId, ip,
      path: loginPath, method: 'POST', userAgent,
      country: geo.country, city: geo.city, isp: geo.isp, timezone: geo.timezone,
      proxy: geo.proxy, hosting: geo.hosting,
      incidentType: 'credential_harvest',
      username: username.slice(0, 64),
    }).catch(() => {})
    // Email CERT — credential harvest
    sendCERTEmail({
      incidentId, ip,
      city: geo.city, country: geo.country, isp: geo.isp,
      proxy: geo.proxy, hosting: geo.hosting,
      incidentType: 'credential_harvest',
    }).catch(() => {})

    // Rediriger vers la scary page via le honeypot principal
    const newIncidentId = genIncidentId()
    const scaryHtml     = buildScaryPage(ip, loginPath, 'POST', userAgent, geo, newIncidentId)

    // DB insert pour la scary page aussi
    db.query(
      `INSERT INTO honeypot_hits
         (incident_id, ip, path, method, user_agent, headers, country, city, isp, org)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [newIncidentId, ip, loginPath, 'POST', userAgent,
       JSON.stringify(headers), geo.country, geo.city, geo.isp, geo.org]
    ).catch(() => {})

    // Stream la scary page
    reply.hijack()
    const raw = reply.raw as import('http').ServerResponse
    raw.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' })

    const isBrowserUA = /mozilla/i.test(userAgent)
    const CHUNK    = isBrowserUA ? 96  : 256
    const DELAY_MS = isBrowserUA ? 180 : 80

    for (let i = 0; i < scaryHtml.length; i += CHUNK) {
      if (raw.destroyed) break
      raw.write(scaryHtml.slice(i, i + CHUNK))
      await new Promise<void>(r => setTimeout(r, DELAY_MS))
    }
    if (!raw.destroyed) raw.end()
  })

  // ── POST /_hp_fp — Fingerprint persistant ─────────────────────────────────
  fastify.post<{ Body: {
    incident_id?: string; fp_hash?: string; screen?: string; cores?: number; tz?: string;
    gpu_vendor?: string; gpu_renderer?: string; device_memory?: number; languages?: string;
    dpr?: number; touch_points?: number; connection_type?: string; audio_fp?: string;
    fonts_count?: number; color_depth?: number; tz_mismatch?: boolean;
    browser_tz?: string; geo_tz?: string; time_to_action?: number;
  } }>('/_hp_fp', async (request, reply) => {
    const {
      incident_id, fp_hash, screen, cores, tz,
      gpu_vendor, gpu_renderer, device_memory, languages,
      dpr, touch_points, connection_type, audio_fp,
      fonts_count, color_depth, tz_mismatch, browser_tz, geo_tz, time_to_action,
    } = request.body ?? {}

    if (!incident_id || !/^HP-[A-Z0-9]+-[A-Z0-9]+$/.test(incident_id)) return reply.code(400).send({})
    if (!fp_hash || !/^[A-F0-9]{8,64}$/.test(fp_hash)) return reply.code(400).send({})

    const headers = request.headers
    const ip =
      (headers['cf-connecting-ip'] as string) ||
      (headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      request.ip ||
      '0.0.0.0'

    try {
      // Upsert fingerprint
      const behavior = time_to_action ? { time_to_action_ms: time_to_action } : null

      const { rows } = await db.query<{ visits: number; ip_list: string[]; incident_ids: string[]; first_seen: string }>(
        `INSERT INTO honeypot_fingerprints
           (fp_hash, visits, ip_list, incident_ids, screen, cores, tz,
            gpu_vendor, gpu_renderer, device_memory, languages, dpr, touch_points,
            connection_type, audio_fp, fonts_count, color_depth, behavior_json,
            first_seen, last_seen)
         VALUES ($1, 1, ARRAY[$2::text], ARRAY[$3::text], $4, $5, $6,
                 $7, $8, $9, $10, $11, $12,
                 $13, $14, $15, $16, $17,
                 NOW(), NOW())
         ON CONFLICT (fp_hash) DO UPDATE SET
           visits          = honeypot_fingerprints.visits + 1,
           ip_list         = CASE WHEN $2 = ANY(honeypot_fingerprints.ip_list) THEN honeypot_fingerprints.ip_list ELSE array_append(honeypot_fingerprints.ip_list, $2::text) END,
           incident_ids    = array_append(honeypot_fingerprints.incident_ids, $3::text),
           gpu_vendor      = COALESCE($7,  honeypot_fingerprints.gpu_vendor),
           gpu_renderer    = COALESCE($8,  honeypot_fingerprints.gpu_renderer),
           device_memory   = COALESCE($9,  honeypot_fingerprints.device_memory),
           languages       = COALESCE($10, honeypot_fingerprints.languages),
           dpr             = COALESCE($11, honeypot_fingerprints.dpr),
           touch_points    = COALESCE($12, honeypot_fingerprints.touch_points),
           connection_type = COALESCE($13, honeypot_fingerprints.connection_type),
           audio_fp        = COALESCE($14, honeypot_fingerprints.audio_fp),
           fonts_count     = COALESCE($15, honeypot_fingerprints.fonts_count),
           color_depth     = COALESCE($16, honeypot_fingerprints.color_depth),
           last_seen       = NOW()
         RETURNING visits, ip_list, incident_ids, first_seen`,
        [
          fp_hash, ip, incident_id, screen || null, cores || null, tz || null,
          gpu_vendor || null, gpu_renderer || null, device_memory || null, languages || null,
          dpr || null, touch_points ?? null, connection_type || null,
          audio_fp || null, fonts_count ?? null, color_depth || null,
          behavior ? JSON.stringify(behavior) : null,
        ]
      )

      const row     = rows[0]
      const visits  = row?.visits ?? 1
      const ipList  = row?.ip_list ?? [ip]
      const otherIps = ipList.filter((x: string) => x !== ip)
      const seen    = visits > 1

      // Discord alert si fingerprint reconnu (revisit)
      if (seen) {
        const webhookUrl = process.env.HONEYPOT_DISCORD_WEBHOOK
        if (webhookUrl) {
          fetch(webhookUrl, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              embeds: [{
                title:  '🔍 Fingerprint Reconnu — Attaquant récidiviste',
                color:  0xff4488,
                fields: [
                  { name: 'IP actuelle',   value: `\`${ip}\``,                                              inline: true  },
                  { name: 'Visites',       value: `${visits}`,                                             inline: true  },
                  { name: 'Canvas FP',     value: `\`${fp_hash}\``,                                       inline: false },
                  { name: 'IPs connues',   value: ipList.map((x: string) => `\`${x}\``).join(', ') || '—', inline: false },
                  ...(tz_mismatch ? [{ name: '🔥 VPN DÉTECTÉ — TZ mismatch', value: `Browser: \`${browser_tz}\` / IP géo: \`${geo_tz}\``, inline: false }] : []),
                  ...(gpu_renderer ? [{ name: 'GPU', value: `\`${gpu_renderer}\``, inline: false }] : []),
                  ...(languages ? [{ name: 'Langue(s)', value: `\`${languages}\``, inline: true }] : []),
                  ...(device_memory ? [{ name: 'RAM', value: `${device_memory} GB`, inline: true }] : []),
                  { name: 'Incident',      value: `\`${incident_id}\``,                                   inline: false },
                ],
                timestamp: new Date().toISOString(),
                footer:    { text: 'nodyx-security-monitor · fingerprint' },
              }]
            })
          }).catch(() => {})

          // Email CERT — récidiviste
          getGeoInfo(ip).then(geo => sendCERTEmail({
            incidentId:   incident_id,
            ip,
            city:         geo.city,
            country:      geo.country,
            isp:          geo.isp,
            proxy:        geo.proxy,
            hosting:      geo.hosting,
            incidentType: 'fingerprint_recurrence',
          })).catch(() => {})
          // MISP — récidiviste
          getGeoInfo(ip).then(geo => reportHoneypotToMISP({
            incidentId:   incident_id,
            ip,
            path:         '/_hp_fp',
            method:       'POST',
            userAgent:    '',
            country:      geo.country,
            city:         geo.city,
            isp:          geo.isp,
            timezone:     geo.timezone,
            proxy:        geo.proxy,
            hosting:      geo.hosting,
            incidentType: 'fingerprint_recurrence',
            canvasFp:     fp_hash,
            gpuRenderer:  gpu_renderer,
            browserTz:    browser_tz,
            languages:    languages,
            fpVisits:     visits,
            knownIps:     ipList,
          })).catch(() => {})
        }
      }

      return reply.code(200).send({
        seen,
        visits,
        firstSeen: row?.first_seen ?? new Date().toISOString(),
        otherIps,
      })
    } catch (e) {
      fastify.log.error({ err: e }, '[honeypot] fp upsert')
      return reply.code(200).send({ seen: false, visits: 1, firstSeen: '', otherIps: [] })
    }
  })

  // ── POST /_hp_rtc — WebRTC IP leak receiver ───────────────────────────────
  // Called from the browser JS in the scary page when WebRTC reveals a public IP.
  fastify.post<{ Body: { incident_id?: string; rtc_ip?: string } }>('/_hp_rtc', async (request, reply) => {
    const { incident_id, rtc_ip } = request.body ?? {}

    // Validate formats
    if (!incident_id || !/^HP-[A-Z0-9]+-[A-Z0-9]+$/.test(incident_id)) return reply.code(400).send({})
    if (!rtc_ip || !/^[\d.a-f:]+$/i.test(rtc_ip) || rtc_ip.length > 45) return reply.code(400).send({})

    // Check incident exists and is recent (< 10 min — prevents replay)
    let incidentRow: { ip: string; country: string; city: string; isp: string } | undefined
    try {
      const { rows } = await db.query<{ ip: string; country: string; city: string; isp: string }>(
        `SELECT ip, country, city, isp FROM honeypot_hits
         WHERE incident_id = $1 AND created_at > NOW() - INTERVAL '10 minutes'
         LIMIT 1`,
        [incident_id]
      )
      incidentRow = rows[0]
    } catch { return reply.code(200).send({}) }

    if (!incidentRow) return reply.code(200).send({})

    // Ignore if same IP as already known
    if (rtc_ip === incidentRow.ip) return reply.code(200).send({})

    // Log
    const logLine = `${new Date().toISOString()} WEBRTC_LEAK id=${incident_id} proxy_ip=${incidentRow.ip} real_ip=${rtc_ip}\n`
    try { fs.appendFileSync('/var/log/nodyx-honeypot.log', logLine) } catch { /* pass */ }

    // Discord alert
    const webhookUrl = process.env.HONEYPOT_DISCORD_WEBHOOK
    if (webhookUrl) {
      fetch(webhookUrl, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          embeds: [{
            title:  '🔓 WebRTC IP Leak Detected',
            color:  0xff6600,
            fields: [
              { name: 'Proxy / VPN IP',   value: `\`${incidentRow.ip}\``,  inline: true  },
              { name: 'Real IP (WebRTC)', value: `\`${rtc_ip}\``,          inline: true  },
              { name: 'Incident',         value: `\`${incident_id}\``,     inline: false },
              { name: 'Location (proxy)', value: `${incidentRow.city}, ${incidentRow.country} — ${incidentRow.isp}`, inline: false },
            ],
            timestamp: new Date().toISOString(),
            footer:    { text: 'nodyx-security-monitor · webrtc-leak' },
          }]
        })
      }).catch(() => {})
    }

    return reply.code(200).send({})
  })

  // ── GET /_hp_px/:incidentId — Tracking pixel ──────────────────────────────
  // Served as a 1×1 transparent PNG embedded in the scary page.
  // Fires on initial load and every revisit — lets us know if the attacker
  // comes back. Only sends a Discord alert if the pixel fires > 30s after
  // the original hit (avoids noise from the immediate page-load fire).
  fastify.get<{ Params: { incidentId: string } }>('/_hp_px/:incidentId', async (request, reply) => {
    const { incidentId } = request.params

    reply.header('Content-Type',  'image/png')
    reply.header('Cache-Control', 'no-store, no-cache, must-revalidate')
    reply.header('Pragma',        'no-cache')
    reply.header('Expires',       '0')

    // Validate format first — always return pixel regardless
    if (!incidentId || !/^HP-[A-Z0-9]+-[A-Z0-9]+$/.test(incidentId)) {
      return reply.code(200).send(PIXEL_PNG)
    }

    const ip        = ((request.headers['cf-connecting-ip'] as string) ||
                       (request.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
                       request.ip || '0.0.0.0')
    const userAgent = (request.headers['user-agent'] || '').slice(0, 512)
    const referer   = (request.headers['referer']    || '').slice(0, 512)

    // Look up original incident (no time limit — revisits can happen days later)
    let originalIp = '', country = '', city = '', isp = '', originalPath = ''
    let isRevisit = false
    try {
      const { rows } = await db.query<{ ip: string; country: string; city: string; isp: string; path: string; created_at: string }>(
        `SELECT ip::text, country, city, isp, path, created_at
         FROM honeypot_hits WHERE incident_id = $1 LIMIT 1`,
        [incidentId]
      )
      if (rows[0]) {
        originalIp   = rows[0].ip
        country      = rows[0].country
        city         = rows[0].city
        isp          = rows[0].isp
        originalPath = rows[0].path
        // Consider it a "revisit" if pixel fires > 30s after the original hit
        isRevisit = (Date.now() - new Date(rows[0].created_at).getTime()) > 30_000
      }
    } catch { /* ignore — still log the pixel hit */ }

    // Log pixel hit to DB (fire-and-forget)
    db.query(
      `INSERT INTO honeypot_pixel_hits (incident_id, ip, user_agent, referer)
       VALUES ($1, $2::inet, $3, $4)`,
      [incidentId, ip || null, userAgent || null, referer || null]
    ).catch(() => {})

    // Log to file
    const logLine = `${new Date().toISOString()} PIXEL_HIT id=${incidentId} pixel_ip=${ip} original_ip=${originalIp || '?'} revisit=${isRevisit}\n`
    try { fs.appendFileSync('/var/log/nodyx-honeypot.log', logLine) } catch { /* pass */ }

    // Discord alert — only for revisits (> 30s) to avoid initial-load noise
    const webhookUrl = process.env.HONEYPOT_DISCORD_WEBHOOK
    if (webhookUrl && originalIp && isRevisit) {
      const differentIp = ip !== originalIp
      fetch(webhookUrl, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          embeds: [{
            title: differentIp
              ? '👁 Pixel — Chargé depuis une IP différente'
              : '👁 Pixel — Page revisitée',
            color: differentIp ? 0xff3366 : 0xff9900,
            fields: [
              { name: 'Incident',      value: `\`${incidentId}\``,                                  inline: false },
              { name: 'IP originale',  value: `\`${originalIp}\``,                                  inline: true  },
              { name: 'IP pixel',      value: `\`${ip}\`${differentIp ? ' ⚠ différente' : ''}`,    inline: true  },
              { name: 'Localisation',  value: `${city || '—'}, ${country || '—'} — ${isp || '—'}`, inline: false },
              { name: 'Path original', value: `\`${originalPath || '—'}\``,                         inline: true  },
              { name: 'User-Agent',    value: `\`${userAgent.slice(0, 100) || '—'}\``,              inline: false },
            ],
            timestamp: new Date().toISOString(),
            footer:    { text: 'nodyx-security-monitor · tracking-pixel' },
          }]
        })
      }).catch(() => {})
    }

    return reply.code(200).send(PIXEL_PNG)
  })

  // ── GET /_hp_cert/:incidentId — Rapport CERT-FR complet ───────────────────
  // Génère un rapport structuré avec toutes les données de l'incident
  // pour transmission au CERT-FR / OCS / forces de l'ordre.
  fastify.get<{ Params: { incidentId: string } }>('/_hp_cert/:incidentId', async (request, reply) => {
    const { incidentId } = request.params
    if (!incidentId || !/^HP-[A-Z0-9]+-[A-Z0-9]+$/.test(incidentId)) {
      return reply.code(400).send({ error: 'invalid incident id' })
    }

    // Vérification admin (header secret ou paramètre)
    const secret = process.env.CERT_REPORT_SECRET || process.env.JWT_SECRET
    const provided = request.headers['x-cert-secret'] || (request.query as Record<string, string>)['secret']
    if (!secret || provided !== secret) return reply.code(403).send({ error: 'unauthorized' })

    // Collecter toutes les données de l'incident
    const [hitRow, fpRow, credRow, pixelRows, rtcRows] = await Promise.all([
      db.query(`SELECT * FROM honeypot_hits WHERE incident_id = $1 LIMIT 1`, [incidentId]).catch(() => ({ rows: [] })),
      db.query(`SELECT * FROM honeypot_fingerprints WHERE $1 = ANY(incident_ids) LIMIT 1`, [incidentId]).catch(() => ({ rows: [] })),
      db.query(`SELECT * FROM honeypot_credential_attempts WHERE incident_id = $1 LIMIT 1`, [incidentId]).catch(() => ({ rows: [] })),
      db.query(`SELECT * FROM honeypot_pixel_hits WHERE incident_id = $1 ORDER BY viewed_at`, [incidentId]).catch(() => ({ rows: [] })),
      db.query(`SELECT ip FROM honeypot_hits WHERE incident_id = $1 LIMIT 1`, [incidentId]).catch(() => ({ rows: [] })),
    ])

    const hit  = (hitRow  as any).rows[0]
    const fp   = (fpRow   as any).rows[0]
    const cred = (credRow as any).rows[0]

    if (!hit) return reply.code(404).send({ error: 'incident not found' })

    // Enrichissement OSINT (parallèle — ne bloque pas si API down)
    const osint: OSINTResult = await enrichIP(hit.ip).catch(() => ({
      ip: hit.ip, enriched_at: new Date().toISOString(),
      abuseipdb: null, virustotal: null, shodan: null,
      threat_score: 0, threat_level: 'low' as const,
      summary: 'Enrichissement OSINT indisponible.',
    }))

    const tzMismatch = fp?.tz && hit.timezone && fp.tz !== hit.timezone

    const report = {
      cert_report: {
        format_version: '1.0',
        generated_at:   new Date().toISOString(),
        generated_by:   'Nodyx Security Honeypot v1.9.2',
        platform:       process.env.NEXUS_COMMUNITY_NAME || 'Nodyx Instance',
        incident_id:    incidentId,
      },
      incident: {
        timestamp:       hit.created_at,
        attack_type:     cred ? 'credential_harvesting' : 'unauthorized_access_attempt',
        targeted_path:   hit.path,
        http_method:     hit.method,
        user_agent:      hit.user_agent,
        tool_detected:   detectTool(hit.user_agent || ''),
        evidence_hash:   evidenceHash(incidentId, hit.ip, hit.path, hit.created_at),
      },
      attacker: {
        ip_address:      hit.ip,
        ip_version:      hit.ip?.includes(':') ? 'IPv6' : 'IPv4',
        geolocation: {
          country:  hit.country,
          city:     hit.city,
          isp:      hit.isp,
          org:      hit.org,
          timezone: hit.timezone,
          lat:      hit.lat,
          lon:      hit.lon,
        },
        anonymization: {
          proxy:          hit.proxy,
          hosting:        hit.hosting,
          mobile:         hit.mobile,
          vpn_suspected:  tzMismatch,
          vpn_evidence:   tzMismatch ? `Browser TZ: ${fp.tz} / IP geo TZ: ${hit.timezone}` : null,
        },
        device_fingerprint: fp ? {
          canvas_hash:    fp.fp_hash,
          screen:         fp.screen,
          cpu_cores:      fp.cores,
          ram_gb:         fp.device_memory,
          gpu_renderer:   fp.gpu_renderer,
          gpu_vendor:     fp.gpu_vendor,
          browser_tz:     fp.tz,
          languages:      fp.languages,
          dpr:            fp.dpr,
          touch_points:   fp.touch_points,
          connection:     fp.connection_type,
          audio_fp:       fp.audio_fp,
          fonts_detected: fp.fonts_count,
          color_depth:    fp.color_depth,
          recurrence: {
            total_visits:   fp.visits,
            known_ips:      fp.ip_list,
            first_seen:     fp.first_seen,
            last_seen:      fp.last_seen,
          },
        } : null,
      },
      credentials_captured: cred ? {
        username:     cred.username,
        password:     cred.password,
        login_path:   cred.login_path,
        attempted_at: cred.attempted_at,
      } : null,
      pixel_tracking: {
        total_views:  (pixelRows as any).rows.length,
        views:        (pixelRows as any).rows.map((r: any) => ({
          viewed_at:  r.viewed_at,
          ip:         r.ip,
          user_agent: r.user_agent,
          referer:    r.referer,
        })),
      },
      osint_enrichment: osint,
      legal: {
        applicable_laws: [
          'Code Pénal français art. 323-1 — Accès frauduleux à un système informatique (2 ans / 60 000 €)',
          'Code Pénal français art. 323-2 — Entrave à un STAD (3 ans / 45 000 €)',
          'EU Directive 2013/40/EU — Attaques contre les systèmes d\'information',
          'GDPR Art. 32 — Obligation de sécurité des données',
        ],
        isp_contact:     `abuse@${(hit.isp || '').toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-')}.net`,
        cert_fr:         'https://www.cert.ssi.gouv.fr/contact/',
        cybermalveillance: 'https://www.cybermalveillance.gouv.fr',
        reporting_note:  'Ce rapport est généré automatiquement par le système de défense Nodyx. Toutes les données sont horodatées et hashées. L\'empreinte SHA-256 permet de vérifier l\'intégrité du dossier.',
      },
      headers_raw: hit.headers,
    }

    // Sauvegarder le rapport généré
    db.query(
      `INSERT INTO honeypot_cert_reports (incident_id, report_json) VALUES ($1, $2)`,
      [incidentId, JSON.stringify(report)]
    ).catch(() => {})

    return reply.code(200)
      .header('Content-Type', 'application/json; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="CERT-${incidentId}-${new Date().toISOString().slice(0,10)}.json"`)
      .send(report)
  })

  // ── GET /_hp_cert/:incidentId/md — Rapport Markdown lisible humain ──────────
  // Destiné aux autorités françaises : CERT-FR, OCLCTIC, gendarmerie, ANSSI.
  fastify.get<{ Params: { incidentId: string } }>('/_hp_cert/:incidentId/md', async (request, reply) => {
    const { incidentId } = request.params
    if (!incidentId || !/^HP-[A-Z0-9]+-[A-Z0-9]+$/.test(incidentId)) {
      return reply.code(400).send('ID incident invalide')
    }

    const secret   = process.env.CERT_REPORT_SECRET || process.env.JWT_SECRET
    const provided = request.headers['x-cert-secret'] || (request.query as Record<string, string>)['secret']
    if (!secret || provided !== secret) return reply.code(403).send('Non autorisé')

    const [hitRow, fpRow, credRow, pixelRows] = await Promise.all([
      db.query(`SELECT * FROM honeypot_hits WHERE incident_id = $1 LIMIT 1`, [incidentId]).catch(() => ({ rows: [] })),
      db.query(`SELECT * FROM honeypot_fingerprints WHERE $1 = ANY(incident_ids) LIMIT 1`, [incidentId]).catch(() => ({ rows: [] })),
      db.query(`SELECT * FROM honeypot_credential_attempts WHERE incident_id = $1 LIMIT 1`, [incidentId]).catch(() => ({ rows: [] })),
      db.query(`SELECT * FROM honeypot_pixel_hits WHERE incident_id = $1 ORDER BY viewed_at`, [incidentId]).catch(() => ({ rows: [] })),
    ])

    const hit  = (hitRow  as any).rows[0]
    const fp   = (fpRow   as any).rows[0]
    const cred = (credRow as any).rows[0]
    if (!hit) return reply.code(404).send('Incident introuvable')

    const osint = await enrichIP(hit.ip).catch(() => null)
    const evHash = evidenceHash(incidentId, hit.ip, hit.path, hit.created_at)
    const tool   = detectTool(hit.user_agent || '')
    const date   = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC'
    const hitDate = new Date(hit.created_at).toISOString().replace('T', ' ').slice(0, 19) + ' UTC'
    const tzMismatch = fp?.tz && hit.timezone && fp.tz !== hit.timezone
    const pixelList = (pixelRows as any).rows

    const threatIcon = osint
      ? ({ critical: '🔴 CRITIQUE', high: '🟠 ÉLEVÉ', medium: '🟡 MOYEN', low: '🟢 FAIBLE' })[osint.threat_level] ?? '⚪ INCONNU'
      : '⚪ NON ÉVALUÉ'

    const lines: string[] = []
    const ln = (...l: string[]) => lines.push(...l)

    ln(
      `# RAPPORT D'INCIDENT SÉCURITÉ INFORMATIQUE`,
      ``,
      `> **CLASSIFICATION :** TLP:AMBER — Diffusion restreinte aux autorités compétentes`,
      `> **Référence :** \`${incidentId}\``,
      `> **Généré le :** ${date}`,
      `> **Plateforme :** ${process.env.NEXUS_COMMUNITY_NAME || 'Nodyx Instance'} (nodyx.org)`,
      `> **Intégrité SHA-256 :** \`${evHash}\``,
      ``,
      `---`,
      ``,
      `## 1. RÉSUMÉ EXÉCUTIF`,
      ``,
    )

    const attackType = cred
      ? 'Collecte de credentials sur faux formulaire d\'authentification'
      : 'Accès non autorisé à ressource sensible détectée par honeypot'

    ln(
      `| Champ | Valeur |`,
      `|---|---|`,
      `| **Type d'attaque** | ${attackType} |`,
      `| **Date/Heure** | ${hitDate} |`,
      `| **IP Attaquant** | \`${hit.ip}\` (${hit.ip?.includes(':') ? 'IPv6' : 'IPv4'}) |`,
      `| **Localisation** | ${hit.city || '—'}, ${hit.country || '—'} |`,
      `| **FAI / ASN** | ${hit.isp || '—'} |`,
      `| **Niveau de menace OSINT** | ${threatIcon} |`,
      `| **Score OSINT** | ${osint?.threat_score ?? 'N/A'} / 100 |`,
      ``,
      osint?.summary ? `**Synthèse OSINT :** ${osint.summary}` : '',
      ``,
      `---`,
      ``,
      `## 2. PROFIL DE L'ATTAQUANT`,
      ``,
      `### 2.1 Identification réseau`,
      ``,
      `\`\`\``,
      `IP            : ${hit.ip}`,
      `Version       : ${hit.ip?.includes(':') ? 'IPv6' : 'IPv4'}`,
      `FAI           : ${hit.isp || '—'}`,
      `Organisation  : ${hit.org || '—'}`,
      `Pays          : ${hit.country || '—'}`,
      `Ville         : ${hit.city || '—'}`,
      `Timezone IP   : ${hit.timezone || '—'}`,
      `Coordonnées   : ${hit.lat || '—'}, ${hit.lon || '—'}`,
      `\`\`\``,
      ``,
      `### 2.2 Anonymisation détectée`,
      ``,
      `| Indicateur | Valeur |`,
      `|---|---|`,
      `| Proxy / VPN exit node | ${hit.proxy ? '**OUI** ⚠' : 'Non'} |`,
      `| IP datacenter/hébergeur | ${hit.hosting ? '**OUI** ⚠' : 'Non'} |`,
      `| Réseau mobile | ${hit.mobile ? 'Oui' : 'Non'} |`,
      `| Discordance timezone (VPN) | ${tzMismatch ? `**OUI** ⚠ — navigateur: \`${fp.tz}\` / IP: \`${hit.timezone}\`` : 'Non'} |`,
      ``,
    )

    if (fp) {
      ln(
        `### 2.3 Empreinte navigateur (fingerprint persistant)`,
        ``,
        `| Attribut | Valeur |`,
        `|---|---|`,
        `| **Canvas Hash** | \`${fp.fp_hash}\` |`,
        `| GPU (WebGL) | ${fp.gpu_renderer || '—'} |`,
        `| Mémoire RAM | ${fp.device_memory ? `${fp.device_memory} GB` : '—'} |`,
        `| Résolution | ${fp.screen || '—'} |`,
        `| Cœurs CPU | ${fp.cores || '—'} |`,
        `| Langue(s) | ${fp.languages || '—'} |`,
        `| Timezone navigateur | ${fp.tz || '—'} |`,
        `| Points de contact | ${fp.touch_points ?? '—'} |`,
        `| Connexion | ${fp.connection_type || '—'} |`,
        `| Audio FP | ${fp.audio_fp ? `\`${fp.audio_fp}\`` : '—'} |`,
        `| Polices détectées | ${fp.fonts_count ?? '—'} |`,
        `| Profondeur couleur | ${fp.color_depth ? `${fp.color_depth} bits` : '—'} |`,
        ``,
        `**Récurrence :** ${fp.visits} visite(s) — première détection : ${fp.first_seen ? new Date(fp.first_seen).toISOString().slice(0,10) : '—'}`,
        fp.ip_list && fp.ip_list.length > 1
          ? `\n**IPs connues pour ce fingerprint :** ${fp.ip_list.map((x: string) => `\`${x}\``).join(', ')}`
          : '',
        ``,
      )
    }

    ln(
      `---`,
      ``,
      `## 3. DÉTAILS DE L'INCIDENT`,
      ``,
      `\`\`\``,
      `Méthode HTTP  : ${hit.method}`,
      `Path ciblé    : ${hit.path}`,
      `User-Agent    : ${hit.user_agent || '—'}`,
      `Outil détecté : ${tool.name} (${tool.type})`,
      `\`\`\``,
      ``,
    )

    if (cred) {
      ln(
        `### 3.1 Credentials capturés`,
        ``,
        `> ⚠ **DONNÉES SENSIBLES** — À traiter avec discrétion`,
        ``,
        `| Champ | Valeur |`,
        `|---|---|`,
        `| Nom d'utilisateur | \`${cred.username || '(vide)'}\` |`,
        `| Mot de passe tenté | \`${cred.password || '(vide)'}\` |`,
        `| Path de connexion | \`${cred.login_path || '—'}\` |`,
        `| Horodatage | ${new Date(cred.attempted_at).toISOString().replace('T',' ').slice(0,19)} UTC |`,
        ``,
      )
    }

    if (pixelList.length > 0) {
      ln(
        `### 3.2 Tracking pixel (emails/documents ouverts)`,
        ``,
        `| # | Date | IP | User-Agent |`,
        `|---|---|---|---|`,
        ...pixelList.map((r: any, i: number) =>
          `| ${i+1} | ${new Date(r.viewed_at).toISOString().replace('T',' ').slice(0,19)} UTC | \`${r.ip || '—'}\` | ${(r.user_agent || '—').slice(0,60)} |`
        ),
        ``,
      )
    }

    if (osint) {
      ln(
        `---`,
        ``,
        `## 4. ENRICHISSEMENT OSINT`,
        ``,
        `> Données collectées automatiquement depuis AbuseIPDB, VirusTotal et Shodan.`,
        `> Horodatage : ${osint.enriched_at}`,
        ``,
      )

      if (osint.abuseipdb) {
        const a = osint.abuseipdb
        ln(
          `### 4.1 AbuseIPDB`,
          ``,
          `| Indicateur | Valeur |`,
          `|---|---|`,
          `| Score d'abus | **${a.score}%** ${a.score >= 80 ? '🔴' : a.score >= 50 ? '🟠' : a.score >= 20 ? '🟡' : '🟢'} |`,
          `| Signalements (90j) | ${a.totalReports} |`,
          `| Dernier signalement | ${a.lastReported ? new Date(a.lastReported).toISOString().slice(0,10) : '—'} |`,
          `| Nœud Tor | ${a.isTor ? '**Oui** ⚠' : 'Non'} |`,
          `| Proxy public | ${a.isPublicProxy ? '**Oui** ⚠' : 'Non'} |`,
          `| Type d'usage | ${a.usageType} |`,
          `| Domaine associé | ${a.domain} |`,
          ``,
        )
      } else {
        ln(`### 4.1 AbuseIPDB`, ``, `> Clé API non configurée ou service indisponible.`, ``)
      }

      if (osint.virustotal) {
        const vt = osint.virustotal
        ln(
          `### 4.2 VirusTotal`,
          ``,
          `| Moteurs | Résultat |`,
          `|---|---|`,
          `| Malveillants | **${vt.malicious}** |`,
          `| Suspects | ${vt.suspicious} |`,
          `| Inoffensifs | ${vt.harmless} |`,
          `| Non analysés | ${vt.undetected} |`,
          vt.categories.length > 0 ? `| Catégories | ${vt.categories.join(', ')} |` : '',
          vt.lastAnalysisDate ? `| Dernière analyse | ${vt.lastAnalysisDate.slice(0,10)} |` : '',
          ``,
        )
      } else {
        ln(`### 4.2 VirusTotal`, ``, `> Clé API non configurée ou service indisponible.`, ``)
      }

      if (osint.shodan) {
        const s = osint.shodan
        ln(
          `### 4.3 Shodan`,
          ``,
          `| Attribut | Valeur |`,
          `|---|---|`,
          `| Ports ouverts | ${s.ports.length > 0 ? s.ports.join(', ') : '—'} |`,
          `| Système d'exploitation | ${s.os || '—'} |`,
          `| Organisation | ${s.org || '—'} |`,
          s.hostnames.length > 0 ? `| Hostnames | ${s.hostnames.join(', ')} |` : '',
          s.vulns.length > 0 ? `| **CVE connues** | **${s.vulns.join(', ')}** ⚠ |` : '',
          s.lastUpdate ? `| Dernière mise à jour | ${s.lastUpdate.slice(0,10)} |` : '',
          ``,
        )
      } else {
        ln(`### 4.3 Shodan`, ``, `> Clé API non configurée ou service indisponible.`, ``)
      }
    }

    ln(
      `---`,
      ``,
      `## 5. CADRE LÉGAL`,
      ``,
      `### Infractions caractérisées`,
      ``,
      `| Article | Infraction | Peine maximale |`,
      `|---|---|---|`,
      `| **CP art. 323-1** | Accès frauduleux à un système de traitement automatisé de données | 2 ans / 60 000 € |`,
      `| **CP art. 323-2** | Entrave au fonctionnement d'un STAD | 3 ans / 45 000 € |`,
      `| **EU 2013/40/EU** | Directive européenne sur les attaques contre les systèmes d'information | — |`,
      `| **RGPD art. 32** | Violation de l'obligation de sécurité des données | jusqu'à 4% CA mondial |`,
      cred ? `| **CP art. 323-3** | Extraction frauduleuse de données | 5 ans / 150 000 € |` : '',
      ``,
      `### Contact FAI pour signalement`,
      ``,
      `- **FAI identifié :** ${hit.isp || '—'}`,
      `- **Email abuse :** \`abuse@${(hit.isp || 'isp').toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-')}.net\``,
      `- **RIPE NCC :** https://apps.db.ripe.net/db-web-ui/query?searchtext=${encodeURIComponent(hit.ip || '')}`,
      ``,
      `---`,
      ``,
      `## 6. ACTIONS RECOMMANDÉES`,
      ``,
      `- [ ] Transmettre ce rapport au **CERT-FR** : https://www.cert.ssi.gouv.fr/contact/`,
      `- [ ] Déposer plainte à l'**OCLCTIC** (Office Central de Lutte contre la Criminalité liée aux TIC)`,
      `- [ ] Signaler sur **cybermalveillance.gouv.fr** : https://www.cybermalveillance.gouv.fr`,
      `- [ ] Notifier le FAI via son adresse abuse`,
      osint?.abuseipdb ? `- [ ] Signaler sur **AbuseIPDB** : https://www.abuseipdb.com/report` : '',
      `- [ ] Conserver ce rapport et les logs bruts comme preuve`,
      ``,
      `---`,
      ``,
      `## 7. INTÉGRITÉ DU RAPPORT`,
      ``,
      `\`\`\``,
      `SHA-256 incident : ${evHash}`,
      `Généré par       : Nodyx Security Honeypot v1.9.2`,
      `Horodatage       : ${date}`,
      `Format           : Nodyx CERT Report v1.0 (Markdown)`,
      `\`\`\``,
      ``,
      `> *Ce rapport est généré automatiquement par le système de défense Nodyx.*`,
      `> *Les données sont horodatées et hashées pour garantir leur intégrité devant un tribunal.*`,
      `> *"Fork us if we betray you." — AGPL-3.0*`,
    )

    const md = lines.filter(l => l !== undefined).join('\n')
    const filename = `NODYX-CERT-${incidentId}-${new Date().toISOString().slice(0,10)}.md`

    return reply.code(200)
      .header('Content-Type', 'text/markdown; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .send(md)
  })

  // ── POST /_hp_cert/:incidentId/send-cert — Envoi manuel vers CERT-FR ────────
  // Déclenché depuis Olympus Hub par l'admin — envoie le rapport complet + lettre
  fastify.post<{ Params: { incidentId: string } }>('/_hp_cert/:incidentId/send-cert', async (request, reply) => {
    const { incidentId } = request.params
    if (!incidentId || !/^HP-[A-Z0-9]+-[A-Z0-9]+$/.test(incidentId)) {
      return reply.code(400).send({ error: 'invalid incident id' })
    }

    const secret   = process.env.CERT_REPORT_SECRET || process.env.JWT_SECRET
    const provided = request.headers['x-cert-secret'] || (request.query as Record<string, string>)['secret']
    if (!secret || provided !== secret) return reply.code(403).send({ error: 'unauthorized' })

    if (!process.env.CERT_EMAIL_TO) return reply.code(400).send({ error: 'CERT_EMAIL_TO non configuré' })

    // Collecter les données
    const [hitRow, fpRow, credRow, pixelRows] = await Promise.all([
      db.query(`SELECT * FROM honeypot_hits WHERE incident_id = $1 LIMIT 1`, [incidentId]).catch(() => ({ rows: [] })),
      db.query(`SELECT * FROM honeypot_fingerprints WHERE $1 = ANY(incident_ids) LIMIT 1`, [incidentId]).catch(() => ({ rows: [] })),
      db.query(`SELECT * FROM honeypot_credential_attempts WHERE incident_id = $1 LIMIT 1`, [incidentId]).catch(() => ({ rows: [] })),
      db.query(`SELECT * FROM honeypot_pixel_hits WHERE incident_id = $1 ORDER BY viewed_at`, [incidentId]).catch(() => ({ rows: [] })),
    ])

    const hit  = (hitRow  as any).rows[0]
    const fp   = (fpRow   as any).rows[0]
    const cred = (credRow as any).rows[0]
    if (!hit) return reply.code(404).send({ error: 'incident not found' })

    const osint = await enrichIP(hit.ip).catch(() => null)
    const tool  = detectTool(hit.user_agent || '')
    const date  = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC'
    const threatIcon = osint
      ? ({ critical: 'CRITIQUE', high: 'ÉLEVÉ', medium: 'MOYEN', low: 'FAIBLE' })[osint.threat_level] ?? 'INCONNU'
      : 'NON ÉVALUÉ'

    // ── Lettre de présentation Nodyx ─────────────────────────────────────────
    const intro = `À l'équipe CERT-FR,

Je me permets de vous contacter au nom de Nodyx (https://nodyx.org), une plateforme
communautaire open source auto-hébergée, publiée sous licence AGPL-3.0.

Nodyx est un projet citoyen dont la mission est de reconstruire un internet humain,
décentralisé et souverain — sans dépendance aux grandes plateformes américaines.

Notre système de défense intégré (honeypot) capture et documente en temps réel les
tentatives d'intrusion, de collecte de credentials et d'accès frauduleux sur nos
instances. Les données collectées sont horodatées, hashées (SHA-256) et structurées
selon les standards de signalement.

Nous souhaitons vous signaler l'incident suivant, détecté sur notre infrastructure :

  Référence    : ${incidentId}
  Type         : ${cred ? 'Collecte de credentials' : 'Accès non autorisé'}
  IP source    : ${hit.ip}
  Localisation : ${hit.city || '—'}, ${hit.country || '—'}
  FAI          : ${hit.isp || '—'}
  Niveau OSINT : ${threatIcon}
  Date         : ${date}
${osint?.summary ? `\n  Synthèse     : ${osint.summary}\n` : ''}
Nous n'avons rien à cacher. Nous sommes entièrement disposés à :
  — Vous donner un accès complet à toutes les preuves collectées
  — Vous fournir les logs bruts, headers HTTP et fingerprints navigateur
  — Collaborer avec vos équipes sur toute investigation en cours
  — Vous ouvrir un accès à notre dashboard de monitoring (Olympus Hub)

Le rapport complet est joint à cet email au format Markdown structuré.

Nous contribuons volontairement à la sécurité de l'internet français et européen.
Nodyx est un outil de la communauté, au service de la communauté — et des autorités.

En vous remerciant pour votre action au service de la cybersécurité.

Cordialement,

Nodyx Security
https://nodyx.org — AGPL-3.0
Contact : ${process.env.CERT_REPLY_TO || 'security@nodyx.org'}

---
Infractions caractérisées :
  Code Pénal art. 323-1 — Accès frauduleux à un STAD (2 ans / 60 000 €)
  Code Pénal art. 323-2 — Entrave au fonctionnement d'un STAD (3 ans / 45 000 €)
  EU Directive 2013/40/EU — Attaques contre les systèmes d'information
${cred ? '  Code Pénal art. 323-3 — Extraction frauduleuse de données (5 ans / 150 000 €)\n' : ''}`

    // Rapport markdown joint
    const evHash   = evidenceHash(incidentId, hit.ip, hit.path, hit.created_at)
    const pixelList = (pixelRows as any).rows
    const tzMismatch = fp?.tz && hit.timezone && fp.tz !== hit.timezone

    const mdLines: string[] = [
      `# RAPPORT D'INCIDENT — ${incidentId}`,
      ``,
      `> **Classification :** TLP:AMBER`,
      `> **Généré le :** ${date}`,
      `> **SHA-256 :** \`${evHash}\``,
      ``,
      `## Attaquant`,
      ``,
      `| Champ | Valeur |`,
      `|---|---|`,
      `| IP | \`${hit.ip}\` |`,
      `| Localisation | ${hit.city || '—'}, ${hit.country || '—'} |`,
      `| FAI | ${hit.isp || '—'} |`,
      `| Proxy/VPN | ${hit.proxy ? '**OUI**' : 'Non'} |`,
      `| IP directe | ${!hit.proxy && !hit.hosting ? '**OUI — attribuable**' : 'Non'} |`,
      tzMismatch ? `| VPN (TZ mismatch) | **OUI** — navigateur: \`${fp.tz}\` / IP: \`${hit.timezone}\` |` : '',
      ``,
      `## Incident`,
      ``,
      `| Champ | Valeur |`,
      `|---|---|`,
      `| Type | ${cred ? 'Credential Harvest' : 'Accès non autorisé'} |`,
      `| Méthode | ${hit.method} |`,
      `| Path ciblé | \`${hit.path}\` |`,
      `| Outil | ${tool.name} (${tool.type}) |`,
      `| User-Agent | \`${(hit.user_agent || '—').slice(0, 120)}\` |`,
      ``,
      fp ? [
        `## Fingerprint navigateur`,
        ``,
        `| Attribut | Valeur |`,
        `|---|---|`,
        `| Canvas Hash | \`${fp.fp_hash}\` |`,
        `| GPU | ${fp.gpu_renderer || '—'} |`,
        `| RAM | ${fp.device_memory ? `${fp.device_memory} GB` : '—'} |`,
        `| Langues | ${fp.languages || '—'} |`,
        `| Récurrence | ${fp.visits} visite(s) |`,
        fp.ip_list?.length > 1 ? `| IPs connues | ${fp.ip_list.join(', ')} |` : '',
        ``,
      ].join('\n') : '',
      cred ? [
        `## Credentials capturés`,
        ``,
        `| Champ | Valeur |`,
        `|---|---|`,
        `| Username | \`${cred.username || '(vide)'}\` |`,
        `| Password tenté | \`${cred.password || '(vide)'}\` |`,
        ``,
      ].join('\n') : '',
      osint ? [
        `## Enrichissement OSINT`,
        ``,
        `| Source | Résultat |`,
        `|---|---|`,
        osint.abuseipdb ? `| AbuseIPDB | Score ${osint.abuseipdb.score}% — ${osint.abuseipdb.totalReports} signalement(s) |` : '',
        osint.virustotal ? `| VirusTotal | ${osint.virustotal.malicious} moteur(s) malveillant(s) |` : '',
        `| Niveau global | **${threatIcon}** (${osint.threat_score}/100) |`,
        ``,
      ].join('\n') : '',
      pixelList.length > 0 ? `## Pixel tracking\n\n${pixelList.length} ouverture(s) détectée(s)\n` : '',
      `---`,
      `*Nodyx Security Honeypot — nodyx.org — AGPL-3.0*`,
    ]

    const markdownReport = mdLines.filter(Boolean).join('\n')

    // Envoi — bypass rate limit pour envoi manuel
    const from    = process.env.CERT_FROM    || process.env.SMTP_FROM || 'security@nodyx.org'
    const replyTo = process.env.CERT_REPLY_TO || ''
    const to      = process.env.CERT_EMAIL_TO!

    try {
      const nodemailer = await import('nodemailer')
      const transport  = nodemailer.default.createTransport({
        host:   process.env.SMTP_HOST!,
        port:   Number(process.env.SMTP_PORT ?? 587),
        secure: process.env.SMTP_SECURE === 'true',
        auth:   { user: process.env.SMTP_USER!, pass: process.env.SMTP_PASS! },
      })

      await transport.sendMail({
        from,
        to,
        replyTo: replyTo || undefined,
        subject: `[NODYX-CERT] ${cred ? 'Credential Harvest' : 'Accès non autorisé'} — ${incidentId} — ${hit.city || '—'}, ${hit.country || '—'}`,
        text:    intro,
        attachments: [{
          filename:    `NODYX-CERT-${incidentId}-${new Date().toISOString().slice(0,10)}.md`,
          content:     markdownReport,
          contentType: 'text/markdown',
        }],
        headers: {
          'X-Nodyx-Incident': incidentId,
          'X-Nodyx-Manual':   'true',
        },
      })

      // Log en DB
      db.query(
        `INSERT INTO honeypot_cert_reports (incident_id, report_json, sent_to) VALUES ($1, $2, $3)`,
        [incidentId, JSON.stringify({ sent_at: new Date().toISOString(), to }), to]
      ).catch(() => {})

      return reply.code(200).send({ ok: true, sent_to: to })
    } catch (err: any) {
      return reply.code(500).send({ error: err?.message || 'SMTP error' })
    }
  })
}
