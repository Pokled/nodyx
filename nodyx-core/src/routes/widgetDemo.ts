import type { FastifyInstance } from 'fastify'
import { adminOnly }  from '../middleware/adminOnly'
import { rateLimit }  from '../middleware/rateLimit'
import AdmZip         from 'adm-zip'
import path           from 'path'
import fs             from 'fs/promises'
import { existsSync } from 'fs'
import { db }         from '../config/database'

// ─── Embedded demo widget sources ──────────────────────────────────────────────

const DEMO_MANIFEST = {
  id:          'video-player',
  label:       'Lecteur Vidéo',
  version:     '1.0.0',
  author:      'Nodyx',
  icon:        '🎬',
  family:      'media',
  description: 'Lecteur vidéo universel — YouTube, Vimeo ou MP4 direct. Configurable depuis le builder.',
  entry:       'widget.iife.js',
  schema: [
    { key: 'url',           type: 'text',     label: 'URL de la vidéo',    placeholder: 'https://youtube.com/watch?v=...' },
    { key: 'title',         type: 'text',     label: 'Titre affiché',      placeholder: 'Ma vidéo' },
    { key: 'autoplay',      type: 'checkbox', label: 'Lecture automatique' },
    { key: 'show_controls', type: 'checkbox', label: 'Afficher les contrôles' },
  ],
}

const DEMO_JS = `(function () {
  /* ── nodyx-widget-video-player v1.0.0 ── */

  var STYLE = \`
    :host { display: block; }
    * { box-sizing: border-box; margin: 0; padding: 0; }

    .root {
      background: #0d0d12;
      border: 1px solid rgba(255,255,255,.08);
      overflow: hidden;
      font-family: 'Space Grotesk', system-ui, -apple-system, sans-serif;
    }

    .header {
      padding: 10px 14px;
      display: flex;
      align-items: center;
      gap: 8px;
      border-bottom: 1px solid rgba(255,255,255,.05);
    }

    .header-icon {
      width: 24px; height: 24px;
      background: rgba(167,139,250,.12);
      border: 1px solid rgba(167,139,250,.2);
      border-radius: 3px;
      display: flex; align-items: center; justify-content: center;
      font-size: 13px;
      flex-shrink: 0;
    }

    .header-title {
      font-size: 12px; font-weight: 700;
      color: #e2e8f0;
      flex: 1;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }

    .header-badge {
      font-size: 9px; font-weight: 700;
      padding: 2px 6px;
      background: rgba(167,139,250,.1);
      border: 1px solid rgba(167,139,250,.18);
      color: #a78bfa;
      text-transform: uppercase;
      letter-spacing: .06em;
      flex-shrink: 0;
    }

    .video-wrap {
      position: relative;
      padding-bottom: 56.25%;
      background: #000;
    }

    .video-wrap iframe,
    .video-wrap video {
      position: absolute; inset: 0;
      width: 100%; height: 100%;
      border: none;
    }

    .placeholder {
      position: absolute; inset: 0;
      display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      gap: 12px;
      background: linear-gradient(145deg, #0d0d12 0%, #12121e 100%);
    }

    .play-btn {
      width: 56px; height: 56px; border-radius: 50%;
      background: rgba(167,139,250,.1);
      border: 1px solid rgba(167,139,250,.25);
      display: flex; align-items: center; justify-content: center;
    }

    .placeholder-label {
      font-size: 11px; color: #374151;
      font-weight: 500;
    }

    .footer {
      padding: 7px 14px;
      display: flex; align-items: center; justify-content: space-between;
      border-top: 1px solid rgba(255,255,255,.04);
    }

    .footer-id {
      font-size: 9px; color: #1f2937;
      font-family: monospace;
    }

    .footer-badge {
      font-size: 9px; font-weight: 700;
      color: #374151; text-transform: uppercase; letter-spacing: .05em;
    }
  \`;

  function ytId(url) {
    var m = url.match(/(?:youtu\\.be\\/|youtube\\.com\\/(?:watch\\?v=|embed\\/|v\\/))([\\w-]{11})/);
    return m ? m[1] : null;
  }

  function viId(url) {
    var m = url.match(/vimeo\\.com\\/(\\d+)/);
    return m ? m[1] : null;
  }

  function escAttr(s) {
    return String(s).replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  class NodyxVideoPlayer extends HTMLElement {
    connectedCallback() { this._render(); }

    static get observedAttributes() { return ['data-config', 'data-title']; }
    attributeChangedCallback() { this._render(); }

    _render() {
      var cfg = {};
      try { cfg = JSON.parse(this.dataset.config || '{}'); } catch (e) {}

      var title    = this.dataset.title || cfg.title || 'Lecteur Vidéo';
      var url      = (cfg.url || '').trim();
      var autoplay = cfg.autoplay ? 1 : 0;
      var controls = cfg.show_controls !== false ? 1 : 0;

      var media = '';

      if (url) {
        var yt = ytId(url);
        var vi = viId(url);

        if (yt) {
          var src = 'https://www.youtube.com/embed/' + yt
            + '?autoplay=' + autoplay
            + '&controls=' + controls
            + '&rel=0&modestbranding=1';
          media = '<iframe src="' + escAttr(src) + '" allow="autoplay; encrypted-media; fullscreen" allowfullscreen></iframe>';

        } else if (vi) {
          var src = 'https://player.vimeo.com/video/' + vi + '?autoplay=' + autoplay;
          media = '<iframe src="' + escAttr(src) + '" allow="autoplay; fullscreen" allowfullscreen></iframe>';

        } else {
          media = '<video src="' + escAttr(url) + '"'
            + (autoplay  ? ' autoplay'  : '')
            + (controls  ? ' controls'  : '')
            + ' playsinline></video>';
        }
      } else {
        media = \`
          <div class="placeholder">
            <div class="play-btn">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="rgba(167,139,250,.8)">
                <path d="M8 5v14l11-7z"/>
              </svg>
            </div>
            <span class="placeholder-label">Aucune URL configurée</span>
          </div>\`;
      }

      if (!this.shadowRoot) this.attachShadow({ mode: 'open' });

      this.shadowRoot.innerHTML = \`
        <style>\${STYLE}</style>
        <div class="root">
          <div class="header">
            <div class="header-icon">🎬</div>
            <span class="header-title">\${escAttr(title)}</span>
            <span class="header-badge">vidéo</span>
          </div>
          <div class="video-wrap">\${media}</div>
          <div class="footer">
            <span class="footer-id">nodyx-widget-video-player</span>
            <span class="footer-badge">Nodyx Widget</span>
          </div>
        </div>\`;
    }
  }

  if (!customElements.get('nodyx-widget-video-player')) {
    customElements.define('nodyx-widget-video-player', NodyxVideoPlayer);
  }
})();
`

const DEMO_WIDGETS: Record<string, { manifest: typeof DEMO_MANIFEST; js: string }> = {
  'video-player': { manifest: DEMO_MANIFEST, js: DEMO_JS },
}

// ─── Routes ────────────────────────────────────────────────────────────────────

const WIDGETS_DIR = path.join(process.cwd(), 'uploads', 'widgets')

export async function widgetDemoRoutes(app: FastifyInstance) {

  // ── GET /admin/widget-store/demos — liste les démos disponibles (admin) ──────
  app.get('/admin/widget-store/demos', { preHandler: [rateLimit, adminOnly] }, async (_req, reply) => {
    return reply.send({
      demos: Object.entries(DEMO_WIDGETS).map(([id, d]) => ({
        id,
        manifest: d.manifest,
      })),
    })
  })

  // ── GET /admin/widget-store/demo/:id/source — fichiers source (admin) ────────
  app.get('/admin/widget-store/demo/:id/source', { preHandler: [rateLimit, adminOnly] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const demo = DEMO_WIDGETS[id]
    if (!demo) return reply.code(404).send({ error: 'Démo introuvable' })

    return reply.send({
      manifest: JSON.stringify(demo.manifest, null, 2),
      js:       demo.js,
      entry:    demo.manifest.entry,
    })
  })

  // ── GET /admin/widget-store/demo/:id/zip — télécharger le .zip (admin) ───────
  app.get('/admin/widget-store/demo/:id/zip', { preHandler: [rateLimit, adminOnly] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const demo = DEMO_WIDGETS[id]
    if (!demo) return reply.code(404).send({ error: 'Démo introuvable' })

    const zip = new AdmZip()
    zip.addFile('manifest.json', Buffer.from(JSON.stringify(demo.manifest, null, 2), 'utf8'))
    zip.addFile(demo.manifest.entry, Buffer.from(demo.js, 'utf8'))

    const buf = zip.toBuffer()
    return reply
      .header('Content-Type', 'application/zip')
      .header('Content-Disposition', `attachment; filename="${id}-${demo.manifest.version}.zip"`)
      .header('Content-Length', buf.length)
      .send(buf)
  })

  // ── POST /admin/widget-store/demo/:id/install — install en 1 clic (admin) ───
  app.post('/admin/widget-store/demo/:id/install', { preHandler: [rateLimit, adminOnly] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const demo = DEMO_WIDGETS[id]
    if (!demo) return reply.code(404).send({ error: 'Démo introuvable' })

    const destDir = path.join(WIDGETS_DIR, id)

    try {
      await fs.mkdir(destDir, { recursive: true })
      await fs.writeFile(path.join(destDir, 'manifest.json'), JSON.stringify(demo.manifest, null, 2), 'utf8')
      await fs.writeFile(path.join(destDir, demo.manifest.entry), demo.js, 'utf8')

      await db.query(
        `INSERT INTO installed_widgets (id, manifest, enabled, installed_at, updated_at)
         VALUES ($1, $2, true, now(), now())
         ON CONFLICT (id) DO UPDATE
           SET manifest = $2, enabled = true, updated_at = now()`,
        [id, JSON.stringify(demo.manifest)]
      )

      return reply.code(201).send({ id, manifest: demo.manifest })
    } catch (err) {
      app.log.error(err)
      return reply.code(500).send({ error: 'Erreur lors de l\'installation' })
    }
  })
}
