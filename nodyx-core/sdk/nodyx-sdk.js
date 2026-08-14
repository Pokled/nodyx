// SDK Nodyx, côté frame. Servi par l'instance, jamais empaqueté par l'auteur,
// donc sa version suit toujours celle de Nodyx et il n'y a pas de dérive de
// contrat possible entre une extension et son hôte.
//
// Ce fichier tourne DANS l'iframe à origine opaque. Il n'a accès ni aux
// cookies, ni au stockage, ni au DOM de la page hôte. Son seul canal est le
// port privé transféré à l'amorçage.
//
// Référence : SPECS/NODYX_SDK_REFERENCE.md

const PROTOCOL = 1

/** Erreur portant un code stable. Testez le code, jamais le message. */
class NodyxError extends Error {
  constructor(code, message) {
    super(message || code)
    this.name = 'NodyxError'
    this.code = code
  }
}

function createBridge(port, ext, surface) {
  const pending = new Map()
  let counter = 0

  port.onmessage = (e) => {
    const m = e.data
    if (!m || m.p !== PROTOCOL) return

    if (m.event) {
      for (const fn of listeners.get(m.event) ?? []) {
        try { fn(m.payload) } catch (err) { console.error('[nodyx] écouteur en échec', err) }
      }
      return
    }

    const entry = pending.get(m.id)
    if (!entry) return                      // réponse inconnue ou déjà consommée
    pending.delete(m.id)
    if (m.ok) entry.resolve(m.result)
    else entry.reject(new NodyxError(m.error?.code ?? 'UNKNOWN', m.error?.message))
  }

  const listeners = new Map()

  function request(type, payload) {
    const id = `r${++counter}`
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject })
      port.postMessage({ p: PROTOCOL, id, ext, surface, type, payload })
    })
  }

  /** Envoi sans réponse attendue, pour ce qui n'a pas besoin d'accusé. */
  function notify(type, payload) {
    port.postMessage({ p: PROTOCOL, id: `n${++counter}`, ext, surface, type, payload })
  }

  function on(event, fn) {
    if (!listeners.has(event)) listeners.set(event, new Set())
    listeners.get(event).add(fn)
    return () => listeners.get(event)?.delete(fn)
  }

  return { request, notify, on, listeners }
}

/** Interpolation {{nom}}, sans pluriel : deux clés valent mieux qu'une règle. */
function interpolate(template, values) {
  if (!values) return template
  return String(template).replace(/\{\{(\w+)\}\}/g, (whole, key) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : whole)
}

function buildNodyx(boot, bridge) {
  const state = {
    config:   boot.config   ?? {},
    user:     boot.user     ?? null,
    instance: boot.instance ?? {},
    locale:   boot.locale   ?? 'en',
    theme:    boot.theme    ?? {},
    messages: boot.messages ?? {},
    route:    boot.route    ?? '/',
  }

  // L'état suit l'hôte sans que l'extension ait à redemander quoi que ce soit.
  bridge.on('config', (v) => { state.config = v ?? {} })
  bridge.on('locale', (v) => { state.locale = v?.locale ?? state.locale; state.messages = v?.messages ?? state.messages })
  bridge.on('theme',  (v) => { state.theme = v ?? {}; applyTheme(v) })
  bridge.on('route',  (v) => { state.route = v?.path ?? state.route })

  const nodyx = {
    api:       1,
    extension: { id: boot.ext, version: boot.version },
    surface:   boot.surfaceInfo ?? { type: boot.surface === 'page' ? 'page' : 'widget' },

    get config()   { return state.config },
    get user()     { return state.user },
    get instance() { return state.instance },
    get locale()   { return state.locale },
    get theme()    { return state.theme },

    t(key, values) {
      const raw = state.messages?.[key]
      return raw === undefined ? key : interpolate(raw, values)
    },

    storage: {
      get:    (key, opts)        => bridge.request('storage.get',    { key, scope: opts?.scope ?? 'user' }),
      set:    (key, value, opts) => bridge.request('storage.set',    { key, value, scope: opts?.scope ?? 'user' }),
      delete: (key, opts)        => bridge.request('storage.delete', { key, scope: opts?.scope ?? 'user' }),
      list:   (opts)             => bridge.request('storage.list',   { scope: opts?.scope ?? 'user' }),
    },

    // L'URL réelle du proxy n'est jamais exposée : sinon la première extension
    // venue reconstruirait l'appel a la main et le contrat deviendrait une
    // simple convention.
    async fetch(url, init) {
      const r = await bridge.request('net.fetch', {
        url,
        method:  init?.method ?? 'GET',
        headers: init?.headers ?? {},
        body:    init?.body ?? null,
      })
      return {
        ok:      r.status >= 200 && r.status < 300,
        status:  r.status,
        headers: r.headers ?? {},
        json:    async () => JSON.parse(r.body),
        text:    async () => r.body,
      }
    },

    imageUrl: (url) => boot.imageBase + encodeURIComponent(url),

    core: { get: (resource, params) => bridge.request('core.get', { resource, params: params ?? {} }) },

    // Rendus par l'hôte : une frame ne peut pas dessiner par dessus la page,
    // et on ne veut pas qu'elle le puisse. Avantage collatéral, ces éléments
    // ont l'apparence et la langue de l'instance sans une ligne de CSS.
    ui: {
      toast:   (message)  => bridge.notify('ui.toast', { message }),
      confirm: (options)  => bridge.request('ui.confirm', options),
      modal:   (options)  => bridge.request('ui.modal', options),
    },

    router: {
      push:    (path) => bridge.notify('router.push',    { path }),
      replace: (path) => bridge.notify('router.replace', { path }),
      get current() { return state.route },
    },

    navigate:     (path) => bridge.notify('host.navigate',       { path }),
    openExternal: (url)  => bridge.notify('host.external', { url }),

    resize: (height) => bridge.notify('surface.resize', { height }),
    on:     (event, fn) => bridge.on(event, fn),
  }

  return nodyx
}

/** Les jetons de thème arrivent en variables CSS, sous des noms stables. */
function applyTheme(theme) {
  if (!theme) return
  const root = document.documentElement
  for (const [k, v] of Object.entries(theme)) {
    if (/^[a-z0-9-]+$/i.test(k) && typeof v === 'string') root.style.setProperty(`--nodyx-${k}`, v)
  }
}

/** Suit la hauteur du contenu, pour que l'hôte ajuste la frame sans que
 *  l'auteur ait à y penser. */
function watchHeight(root, nodyx) {
  let last = 0
  const report = () => {
    const h = Math.ceil(root.getBoundingClientRect().height)
    if (h && h !== last) { last = h; nodyx.resize(h) }
  }
  new ResizeObserver(report).observe(root)
  report()
}

// ── Amorçage ────────────────────────────────────────────────────────────────
//
// L'hôte n'envoie QU'UN message sur `window`, celui ci, qui transfère le port
// privé. Tout le reste passe par ce port : une autre frame n'a rien à usurper,
// il n'y a pas d'adresse publique à viser.

let booted = false

window.addEventListener('message', async (e) => {
  if (booted) return
  const boot = e.data
  if (!boot || boot.p !== PROTOCOL || boot.type !== 'nodyx:boot') return
  const port = e.ports?.[0]
  if (!port) return
  booted = true
  stopHello()

  const bridge = createBridge(port, boot.ext, boot.surface)
  const nodyx  = buildNodyx(boot, bridge)
  applyTheme(boot.theme)
  port.start?.()

  const root = document.getElementById('root')

  try {
    const mod = await import(boot.entryUrl)
    if (typeof mod.mount !== 'function') {
      throw new Error('le point d\'entrée n\'exporte pas mount({ root, nodyx })')
    }
    const handle = await mod.mount({ root, nodyx })
    watchHeight(root, nodyx)
    window.addEventListener('pagehide', () => { try { handle?.unmount?.() } catch { /* rien à sauver */ } })
    port.postMessage({ p: PROTOCOL, event: 'ready' })
  } catch (err) {
    port.postMessage({ p: PROTOCOL, event: 'error', payload: { message: String(err?.message ?? err) } })
    console.error('[nodyx] montage de la surface en échec', err)
  }
})

// ── La poignee de main, qui doit survivre au desordre ───────────────────────
//
// L'hote attend ce signal pour transferer le port. Un seul envoi ne suffit
// PAS, et ca s'est vu en production : dans le builder d'accueil, l'apercu se
// redessine a chaque interaction, donc l'hote peut ne pas encore ecouter quand
// la frame demarre, ou la frame peut etre recreee apres le premier essai. Le
// message part alors dans le vide et la surface reste bloquee sur son erreur.
//
// On repete donc l'appel jusqu'a ce que l'amorcage arrive. C'est sans risque :
// l'hote ignore un `hello` en trop, et le garde `booted` empeche tout double
// montage.
const HELLO_EVERY_MS = 250
const HELLO_FOR_MS   = 8000

let helloTimer = null
function sayHello() {
  if (booted) return stopHello()
  try { window.parent?.postMessage({ p: PROTOCOL, type: 'nodyx:hello' }, '*') } catch { /* rien a faire */ }
}
function stopHello() {
  if (helloTimer) { clearInterval(helloTimer); helloTimer = null }
}

sayHello()
helloTimer = setInterval(sayHello, HELLO_EVERY_MS)
setTimeout(stopHello, HELLO_FOR_MS)
