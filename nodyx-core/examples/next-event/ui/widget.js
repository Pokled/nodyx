// « Prochain événement », extension de référence du SDK Nodyx.
//
// C'est l'exemple du manuel, SPECS/NODYX_SDK_REFERENCE.md §11, et il est tenu
// par un test : si le manuel et ce fichier divergent, la suite echoue. Une
// documentation dont personne ne verifie qu'elle marche encore est pire
// qu'une absence de documentation.
//
// Aucune permission demandee : ce widget se contente de sa configuration et de
// sa langue, ce qui en fait le cas le plus facile a faire installer.

const STYLE = `
  .wrap {
    background: var(--nodyx-bg-elevated, #12121a);
    color: var(--nodyx-fg, #e2e8f0);
    border: 1px solid var(--nodyx-border, rgba(255,255,255,.08));
    border-radius: var(--nodyx-radius-md, 8px);
    padding: var(--nodyx-space-4, 16px);
    font-family: var(--nodyx-font, system-ui, sans-serif);
  }
  .title { font-weight: 600; margin-bottom: var(--nodyx-space-2, 8px); }
  .row   { display: flex; gap: var(--nodyx-space-4, 16px); }
  .n     { font-size: 28px; font-weight: 700; line-height: 1; }
  .n.accent { color: var(--nodyx-accent, #a78bfa); }
  .u     { font-size: 12px; color: var(--nodyx-fg-muted, #6b7280); }
  .msg   { color: var(--nodyx-fg-muted, #6b7280); font-size: 14px; }
`

export function mount({ root, nodyx }) {
  const style = document.createElement('style')
  style.textContent = STYLE
  root.append(style)

  const wrap = document.createElement('div')
  wrap.className = 'wrap'
  root.append(wrap)

  let timer = null

  function text(cls, value) {
    const el = document.createElement('div')
    el.className = cls
    el.textContent = value          // jamais innerHTML avec une valeur de config
    return el
  }

  function render() {
    const cfg    = nodyx.config
    const target = new Date(cfg.date ?? '')
    const accent = cfg.accent !== false

    if (Number.isNaN(target.getTime())) {
      wrap.replaceChildren(text('msg', nodyx.t('invalid')))
      return
    }

    const left = target.getTime() - Date.now()
    if (left <= 0) {
      wrap.replaceChildren(text('title', cfg.title ?? ''), text('msg', nodyx.t('past')))
      return
    }

    const d = Math.floor(left / 86400000)
    const h = Math.floor(left / 3600000) % 24
    const m = Math.floor(left / 60000) % 60

    const row = document.createElement('div')
    row.className = 'row'
    for (const [value, unit] of [[d, 'days'], [h, 'hours'], [m, 'minutes']]) {
      const cell = document.createElement('div')
      const n = text('n', String(value))
      if (accent) n.classList.add('accent')
      cell.append(n, text('u', nodyx.t(unit)))
      row.append(cell)
    }
    wrap.replaceChildren(text('title', cfg.title ?? ''), row)
  }

  function start() { stop(); render(); timer = setInterval(render, 30_000) }
  function stop()  { if (timer) clearInterval(timer); timer = null }

  const offs = [
    nodyx.on('config',  render),
    nodyx.on('locale',  render),
    // Huit widgets qui battent la seconde sur une page d'accueil, c'est une
    // page qui chauffe : on s'arrete hors ecran.
    nodyx.on('visible', ({ visible }) => visible ? start() : stop()),
  ]

  start()
  return { unmount() { stop(); offs.forEach((off) => off()) } }
}
