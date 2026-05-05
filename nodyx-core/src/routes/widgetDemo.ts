import type { FastifyInstance } from 'fastify'
import { adminOnly }  from '../middleware/adminOnly'
import { rateLimit }  from '../middleware/rateLimit'
import AdmZip         from 'adm-zip'
import path           from 'path'
import fs             from 'fs/promises'
import { readFileSync, existsSync } from 'fs'
import { db }         from '../config/database'

// ─── Demo widget sources ─────────────────────────────────────────────────────
//
// Single source of truth: nodyx-core/widget-demos/<id>/{manifest.json, widget.iife.js}
// Loaded once at module init. Avoids embedding the JS as an escaped template
// literal (which made every regex backslash and ${ readable only at the cost
// of a maintenance disaster).

interface WidgetManifest {
  id:           string
  label:        string
  version:      string
  author?:      string
  icon?:        string
  family?:      string
  description?: string
  entry:        string
  schema?:      unknown[]
}
interface DemoWidget {
  manifest: WidgetManifest
  js:       string
}

const DEMOS_DIR = path.join(process.cwd(), 'widget-demos')

function loadDemoSync(id: string): DemoWidget | null {
  const dir = path.join(DEMOS_DIR, id)
  const manifestPath = path.join(dir, 'manifest.json')
  if (!existsSync(manifestPath)) return null
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as WidgetManifest
    const jsPath = path.join(dir, manifest.entry)
    if (!existsSync(jsPath)) return null
    return {
      manifest,
      js: readFileSync(jsPath, 'utf8'),
    }
  } catch {
    return null
  }
}

const DEMO_WIDGETS: Record<string, DemoWidget> = {}
for (const id of ['video-player']) {
  const d = loadDemoSync(id)
  if (d) DEMO_WIDGETS[id] = d
}

// ─── Routes ──────────────────────────────────────────────────────────────────

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
