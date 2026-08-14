#!/usr/bin/env node
// Banc de confinement du bac a sable des extensions.
//
// Il ne teste PAS notre code : il teste la frontiere du navigateur, qui est la
// seule chose sur laquelle le modele repose. Un test unitaire ne peut pas le
// faire, parce que l'isolation d'origine, les drapeaux de bac a sable et la
// politique de securite de contenu n'existent que dans un vrai navigateur.
//
// Ce que le banc sert est REEL : le document de frame vient de
// `src/routes/extensionFrame.ts`, le SDK de `sdk/nodyx-sdk.js`. Seule
// l'extension est une fixture, et elle est hostile.
//
//   node confinement/run.mjs            # tableau des tentatives
//   node confinement/run.mjs --check    # sortie 1 si une seule passe
//
// Playwright n'est PAS une dependance du depot : le banc se saute proprement
// s'il est absent, pour ne pas alourdir l'installation de tout le monde.
// cf SPECS/NODYX_SDK_CDC.md §14

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HERE, '..')
const CHECK = process.argv.includes('--check')
const PORT = 8129
const ORIGIN = `http://127.0.0.1:${PORT}`

// ── Le document de frame REEL, importe depuis la route ──────────────────────
const { frameCsp, frameHtml } = await import('../src/routes/extensionFrame.ts')
  .catch(async () => {
    // Sans passe TypeScript, on lit la source et on en extrait les deux
    // fonctions : mieux vaut ca qu'une copie qui divergerait en silence.
    const src = fs.readFileSync(path.join(ROOT, 'src', 'routes', 'extensionFrame.ts'), 'utf8')
    const grab = (name) => {
      const i = src.indexOf(`function ${name}(`)
      if (i < 0) throw new Error(`fonction ${name} introuvable dans la route`)
      let depth = 0, j = src.indexOf('{', i)
      for (let k = j; k < src.length; k++) {
        if (src[k] === '{') depth++
        else if (src[k] === '}' && --depth === 0) return src.slice(i, k + 1)
      }
      throw new Error('accolades desequilibrees')
    }
    const js = (grab('frameCsp') + '\n' + grab('frameHtml'))
      .replace(/:\s*string/g, '').replace(/\)\s*:\s*string/g, ')')
      .replace(/export\s+/g, '')
    const mod = new Function(`${js}; return { frameCsp, frameHtml }`)
    return mod()
  })

const SDK  = fs.readFileSync(path.join(ROOT, 'sdk', 'nodyx-sdk.js'), 'utf8')
const EVIL = fs.readFileSync(path.join(HERE, 'evil-extension', 'ui', 'widget.js'), 'utf8')

const HOST_PAGE = `<!doctype html><meta charset="utf-8"><title>hote</title>
<body>
<script>
  // Une charge SSR realiste : c'est CE jeton que l'extension hostile essaie
  // de lire, et c'est exactement ce que sert la vraie page.
  window.__sveltekit_data = { "user": "pokled", "token": "JETON-DE-SESSION-SECRET" };
  document.cookie = 'token=JETON-COOKIE; path=/';

  const f = document.createElement('iframe');
  f.sandbox = 'allow-scripts';
  f.src = '/frame';
  f.width = 400; f.height = 200;
  window.__results = null;

  // L'hote ecoute EN RETARD, expres. C'est ce qui arrive dans le builder,
  // dont l'apercu se redessine : sans rappels de la poignee de main, la frame
  // reste bloquee et le banc doit le voir.
  const RETARD_MS = 1200;
  const brancher = () => window.addEventListener('message', (e) => {
    if (e.data?.type === 'nodyx:hello' && e.source === f.contentWindow) {
      const ch = new MessageChannel();
      // L'hote repond, sinon une promesse du pont reste suspendue et le
      // montage ne se termine jamais. On imite le vrai hote : les capacites
      // du lot suivant sont refusees avec un code explicite.
      ch.port1.onmessage = (ev) => {
        const m = ev.data;
        if (!m || !m.id || m.event) return;
        ch.port1.postMessage({ p: 1, id: m.id, ok: false,
          error: { code: 'NOT_IMPLEMENTED', message: 'API de runtime absente du banc' } });
      };
      ch.port1.start();
      f.contentWindow.postMessage({
        p: 1, type: 'nodyx:boot', ext: 'evil-ext', version: '1.0.0',
        surface: 'widget:main', entryUrl: '/assets/ui/widget.js',
        imageBase: '/img?u=', config: {}, messages: {}, locale: 'fr',
        theme: {}, instance: {}, user: null, route: '/',
      }, '*', [ch.port2]);
    }
    if (e.data?.type === 'evil:results') window.__results = e.data.results;
  });
  document.body.append(f);
  setTimeout(brancher, RETARD_MS);
</script>
</body>`

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0]
  if (url === '/') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    return res.end(HOST_PAGE)
  }
  if (url === '/frame') {
    const nonce = randomBytes(16).toString('base64')
    const csp = frameCsp(ORIGIN, nonce)
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.setHeader('Content-Security-Policy', csp)
    return res.end(frameHtml(nonce, csp, `${ORIGIN}/sdk.js`))
  }
  if (url === '/sdk.js' || url === '/assets/ui/widget.js') {
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8')
    // Les memes en-tetes que la vraie route : sans eux, une frame en origine
    // opaque ne peut pas charger un module, et rien ne demarre.
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
    return res.end(url === '/sdk.js' ? SDK : EVIL)
  }
  if (url === '/api/v1/users/me') {
    res.setHeader('Content-Type', 'application/json')
    // Repond en clair : si la reponse arrivait a etre LUE par l'extension,
    // ce serait la fuite. C'est le navigateur qui doit l'en empecher.
    return res.end(JSON.stringify({ username: 'pokled', email: 'prive@example.org' }))
  }
  res.statusCode = 404
  res.end('')
})

let chromium
try {
  ({ chromium } = await import('playwright'))
} catch {
  console.log('Playwright absent : banc de confinement ignore.')
  console.log('  npm i -D playwright && npx playwright install chromium')
  process.exit(0)
}

await new Promise((r) => server.listen(PORT, '127.0.0.1', r))

const DEBUG = process.argv.includes('--debug')
const browser = await chromium.launch()
const page = await browser.newPage()
if (DEBUG) {
  page.on('console',       (m) => console.log('  [console]', m.text().slice(0, 180)))
  page.on('pageerror',     (e) => console.log('  [erreur]', String(e).slice(0, 180)))
  page.on('requestfailed', (r) => console.log('  [requete]', r.url().slice(0, 70), r.failure()?.errorText))
}
const cspViolations = []
page.on('console', (m) => {
  const t = m.text()
  if (/Content Security Policy|Refused|sandbox|SecurityError|blocked/i.test(t)) cspViolations.push(t.slice(0, 100))
})

await page.goto(ORIGIN + '/')
await page.waitForFunction('window.__results !== null', null, { timeout: 20000 }).catch(() => {})
const results = await page.evaluate(() => window.__results)

await browser.close()
server.close()

if (!results) {
  console.error('ECHEC : la fixture hostile n\'a pas rendu ses resultats. Le montage a echoue.')
  process.exit(1)
}

const pad = (s, n) => String(s).padEnd(n)
console.log('\nBanc de confinement, extension hostile\n')
console.log(pad('tentative', 38), pad('attendu', 26), 'resultat')
console.log('-'.repeat(96))

// Une tentative dont l'attendu commence par « autorisee » doit REUSSIR : c'est
// le cas des styles, qu'une extension doit pouvoir injecter pour dessiner.
// Sans cette distinction, le banc serait vert en interdisant tout, y compris
// ce qui est necessaire.
let leaks = 0
for (const r of results) {
  const doitPasser = r.expectation.startsWith('autorisee')
  const conforme = doitPasser ? !r.blocked : r.blocked
  const verdict = r.blocked ? 'BLOQUEE (' + r.reason + ')' : 'PASSEE >>> ' + r.leaked
  if (!conforme) leaks++
  console.log(pad(r.name, 38), pad(r.expectation, 26), (conforme ? '' : 'NON CONFORME : ') + verdict)
}

console.log('\n' + results.length + ' tentatives, ' + (results.length - leaks) + ' conformes, ' + leaks + ' non conformes')
if (cspViolations.length) {
  console.log('\nRefus de la politique de securite (extraits) :')
  for (const v of [...new Set(cspViolations)].slice(0, 6)) console.log('  ' + v)
}

if (leaks > 0) {
  console.error('\nECHEC : ' + leaks + ' tentative(s) non conforme(s).')
  if (CHECK) process.exit(1)
} else {
  console.log('\nOK : le confinement tient, et une extension peut dessiner.')
}
