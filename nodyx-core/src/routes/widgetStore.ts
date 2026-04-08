import type { FastifyInstance } from 'fastify'
import { db }        from '../config/database'
import { adminOnly } from '../middleware/adminOnly'
import { rateLimit } from '../middleware/rateLimit'
import path          from 'path'
import fs            from 'fs/promises'
import { createWriteStream, existsSync } from 'fs'
import { pipeline }  from 'stream/promises'
import AdmZip        from 'adm-zip'

const WIDGETS_DIR = path.join(process.cwd(), 'uploads', 'widgets')

// Manifest minimal attendu dans le .zip
interface WidgetManifest {
  id:          string
  label:       string
  version:     string
  author?:     string
  nodyx_min?:  string
  icon?:       string
  family?:     string
  entry:       string   // fichier JS principal, ex: "widget.iife.js"
  schema?:     unknown[]
  description?: string
}

function slugify(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
}

function validateManifest(m: unknown): m is WidgetManifest {
  if (!m || typeof m !== 'object') return false
  const obj = m as Record<string, unknown>
  return (
    typeof obj.id      === 'string' && obj.id.trim().length > 0 &&
    typeof obj.label   === 'string' && obj.label.trim().length > 0 &&
    typeof obj.version === 'string' &&
    typeof obj.entry   === 'string' && obj.entry.endsWith('.js')
  )
}

export async function widgetStoreRoutes(app: FastifyInstance) {

  // ── GET /api/v1/admin/widget-store — liste les widgets installés ──────────
  app.get('/admin/widget-store', { preHandler: [rateLimit, adminOnly] }, async (_req, reply) => {
    const { rows } = await db.query(
      `SELECT id, manifest, enabled, installed_at, updated_at
       FROM installed_widgets
       ORDER BY installed_at DESC`
    )
    return reply.send({ widgets: rows })
  })

  // ── POST /api/v1/admin/widget-store/install — upload + install .zip ───────
  app.post('/admin/widget-store/install', { preHandler: [rateLimit, adminOnly] }, async (request, reply) => {
    const data = await request.file()
    if (!data) return reply.code(400).send({ error: 'Aucun fichier reçu' })

    const { mimetype, filename } = data
    const isZip = mimetype === 'application/zip' ||
                  mimetype === 'application/x-zip-compressed' ||
                  filename?.endsWith('.zip')
    if (!isZip) return reply.code(400).send({ error: 'Le fichier doit être un .zip' })

    // Sauvegarde temporaire
    const tmpPath = path.join(WIDGETS_DIR, `_tmp_${Date.now()}.zip`)
    await fs.mkdir(WIDGETS_DIR, { recursive: true })
    await pipeline(data.file, createWriteStream(tmpPath))

    try {
      const zip = new AdmZip(tmpPath)

      // Lire et valider le manifest
      const manifestEntry = zip.getEntry('manifest.json')
      if (!manifestEntry) {
        await fs.unlink(tmpPath)
        return reply.code(400).send({ error: 'manifest.json manquant dans l\'archive' })
      }

      let manifest: WidgetManifest
      try {
        manifest = JSON.parse(manifestEntry.getData().toString('utf8'))
      } catch {
        await fs.unlink(tmpPath)
        return reply.code(400).send({ error: 'manifest.json invalide (JSON malformé)' })
      }

      if (!validateManifest(manifest)) {
        await fs.unlink(tmpPath)
        return reply.code(400).send({ error: 'manifest.json incomplet (id, label, version, entry requis)' })
      }

      // Vérifier que le fichier entry existe dans le zip
      const entryFile = zip.getEntry(manifest.entry)
      if (!entryFile) {
        await fs.unlink(tmpPath)
        return reply.code(400).send({ error: `Fichier entry "${manifest.entry}" absent du zip` })
      }

      const widgetId = slugify(manifest.id)
      const destDir  = path.join(WIDGETS_DIR, widgetId)

      // Supprimer ancienne version si elle existe
      if (existsSync(destDir)) await fs.rm(destDir, { recursive: true })
      await fs.mkdir(destDir, { recursive: true })

      // Extraire uniquement les fichiers .js, .css, .png, .jpg, .svg (pas d'exécutables)
      const ALLOWED_EXTS = ['.js', '.css', '.png', '.jpg', '.jpeg', '.svg', '.webp', '.json']
      for (const entry of zip.getEntries()) {
        if (entry.isDirectory) continue
        const ext = path.extname(entry.entryName).toLowerCase()
        if (!ALLOWED_EXTS.includes(ext)) continue
        const safeName = path.basename(entry.entryName)
        zip.extractEntryTo(entry, destDir, false, true, false, safeName)
      }

      // Upsert en base
      await db.query(
        `INSERT INTO installed_widgets (id, manifest, enabled, installed_at, updated_at)
         VALUES ($1, $2, true, now(), now())
         ON CONFLICT (id) DO UPDATE
           SET manifest = $2, enabled = true, updated_at = now()`,
        [widgetId, JSON.stringify(manifest)]
      )

      await fs.unlink(tmpPath)
      return reply.code(201).send({ id: widgetId, manifest })

    } catch (err) {
      await fs.unlink(tmpPath).catch(() => {})
      app.log.error(err)
      return reply.code(500).send({ error: 'Erreur lors de l\'installation du widget' })
    }
  })

  // ── PATCH /api/v1/admin/widget-store/:id — activer/désactiver ────────────
  app.patch('/admin/widget-store/:id', { preHandler: [rateLimit, adminOnly] }, async (request, reply) => {
    const { id }      = request.params as { id: string }
    const { enabled } = request.body   as { enabled: boolean }
    await db.query(
      `UPDATE installed_widgets SET enabled = $1, updated_at = now() WHERE id = $2`,
      [enabled, id]
    )
    return reply.send({ success: true })
  })

  // ── DELETE /api/v1/admin/widget-store/:id — désinstaller ─────────────────
  app.delete('/admin/widget-store/:id', { preHandler: [rateLimit, adminOnly] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    await db.query(`DELETE FROM installed_widgets WHERE id = $1`, [id])
    const destDir = path.join(WIDGETS_DIR, id)
    if (existsSync(destDir)) await fs.rm(destDir, { recursive: true })
    return reply.send({ success: true })
  })

  // ── GET /api/v1/instance/widget-assets/:id/:file — sert les fichiers JS ──
  // Public — le navigateur charge le JS du widget
  app.get('/widget-assets/:id/:file', { preHandler: [rateLimit] }, async (request, reply) => {
    const { id, file } = request.params as { id: string; file: string }

    // Sécurité : pas de path traversal
    const safeName = path.basename(file)
    const filePath = path.join(WIDGETS_DIR, id, safeName)

    if (!filePath.startsWith(WIDGETS_DIR)) {
      return reply.code(403).send({ error: 'Forbidden' })
    }

    try {
      const content = await fs.readFile(filePath)
      const ext     = path.extname(safeName).toLowerCase()
      const ct      = ext === '.css' ? 'text/css' : 'application/javascript'
      return reply.header('Content-Type', ct)
                  .header('Cache-Control', 'public, max-age=86400')
                  .send(content)
    } catch {
      return reply.code(404).send({ error: 'Asset not found' })
    }
  })

  // ── GET /api/v1/instance/widget-store — liste publique (pour WidgetZone) ─
  app.get('/widget-store-public', { preHandler: [rateLimit] }, async (_req, reply) => {
    const { rows } = await db.query(
      `SELECT id, manifest FROM installed_widgets WHERE enabled = true ORDER BY installed_at DESC`
    )
    return reply.send({ widgets: rows })
  })
}
