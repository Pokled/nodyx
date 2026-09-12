/**
 * NODYX : vitrine musique. Titre, sous-titre et bannière sont éditables par
 * l'admin (music_page_* sur communities), donc réutilisable pour n'importe
 * quel usage (bandes originales, DJ set, bibliothèque sonore...), pas figée
 * sur un seul contexte.
 * Lecture publique (aucune authentification requise, pensé pour des visiteurs
 * venant de Discord), écriture réservée à l'admin de l'instance.
 * Prefix: /api/v1/music
 */

import { FastifyInstance } from 'fastify'
import { rateLimit } from '../middleware/rateLimit'
import { adminOnly } from '../middleware/adminOnly'
import { db } from '../config/database'
import { scanBuffer } from '../services/fileScanner'
import { uploadAsset } from '../services/assetService'
import { generateLicensePdf } from '../services/licenseDocument'
import { checkContent } from '../services/contentFilter'
import * as MusicCategoryModel from '../models/musicCategory'
import * as MusicTrackModel from '../models/musicTrack'
import * as MusicCommentModel from '../models/musicComment'

const ALLOWED_AUDIO_MIME = ['audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/webm', 'audio/mp4', 'audio/flac']
const ALLOWED_IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
const MAX_AUDIO_BYTES    = 30 * 1024 * 1024 // 30 Mo, large pour une piste OST non compressée à l'excès
const MAX_IMAGE_BYTES    = 8  * 1024 * 1024

// ── Resolve instance community (cached, même pattern que chat.ts) ────────────
let _communityId: string | null = null
async function getCommunityId(): Promise<string | null> {
  if (_communityId) return _communityId
  const slug = process.env.NODYX_COMMUNITY_SLUG
  if (slug) {
    const { rows } = await db.query(`SELECT id FROM communities WHERE slug = $1`, [slug])
    if (rows[0]) { _communityId = rows[0].id; return _communityId }
  }
  const { rows } = await db.query(`SELECT id FROM communities ORDER BY created_at ASC LIMIT 1`)
  if (rows[0]) { _communityId = rows[0].id; return _communityId }
  return null
}

interface MusicPageSettings {
  title:      string | null
  subtitle:   string | null
  banner_url: string | null
}

async function getPageSettings(communityId: string): Promise<MusicPageSettings> {
  const { rows } = await db.query<{ music_page_title: string | null; music_page_subtitle: string | null; file_path: string | null }>(
    `SELECT c.music_page_title, c.music_page_subtitle, a.file_path
     FROM communities c
     LEFT JOIN community_assets a ON a.id = c.music_page_banner_asset_id
     WHERE c.id = $1`,
    [communityId]
  )
  const row = rows[0]
  return {
    title:      row?.music_page_title ?? null,
    subtitle:   row?.music_page_subtitle ?? null,
    banner_url: row?.file_path ? `/uploads/${row.file_path}` : null,
  }
}

export default async function musicRoutes(app: FastifyInstance) {

  // ── Lecture publique ────────────────────────────────────────────────────

  app.get('/settings', { preHandler: [rateLimit] }, async (_request, reply) => {
    const communityId = await getCommunityId()
    if (!communityId) return reply.code(503).send({ error: 'Community not configured' })
    const settings = await getPageSettings(communityId)
    return reply.send({ settings })
  })

  app.patch('/settings', { preHandler: [rateLimit, adminOnly] }, async (request, reply) => {
    const body = request.body as { title?: string | null; subtitle?: string | null; banner_asset_id?: string | null }
    if (body.title !== undefined && body.title !== null && body.title.length > 120) {
      return reply.code(400).send({ error: 'title must be 120 characters or fewer', code: 'INVALID_TITLE' })
    }
    const communityId = await getCommunityId()
    if (!communityId) return reply.code(503).send({ error: 'Community not configured' })

    const fields: string[] = []
    const values: unknown[] = []
    let i = 1
    if (body.title           !== undefined) { fields.push(`music_page_title = $${i++}`);           values.push(body.title) }
    if (body.subtitle        !== undefined) { fields.push(`music_page_subtitle = $${i++}`);         values.push(body.subtitle) }
    if (body.banner_asset_id !== undefined) { fields.push(`music_page_banner_asset_id = $${i++}`);  values.push(body.banner_asset_id) }
    if (fields.length > 0) {
      values.push(communityId)
      await db.query(`UPDATE communities SET ${fields.join(', ')} WHERE id = $${i}`, values)
    }

    const settings = await getPageSettings(communityId)
    return reply.send({ settings })
  })

  app.get('/categories', { preHandler: [rateLimit] }, async (_request, reply) => {
    const communityId = await getCommunityId()
    if (!communityId) return reply.code(503).send({ error: 'Community not configured' })
    const categories = await MusicCategoryModel.listByCommunity(communityId)
    return reply.send({ categories })
  })

  app.get('/categories/:slug', { preHandler: [rateLimit] }, async (request, reply) => {
    const { slug } = request.params as { slug: string }
    const communityId = await getCommunityId()
    if (!communityId) return reply.code(503).send({ error: 'Community not configured' })

    const category = await MusicCategoryModel.findBySlug(communityId, slug)
    if (!category) return reply.code(404).send({ error: 'Category not found', code: 'NOT_FOUND' })

    const [tracks] = await Promise.all([
      MusicTrackModel.listByCategory(category.id),
      MusicCategoryModel.incrementViews(category.id),
    ])
    category.views += 1 // reflète l'incrément dans la reponse sans re-selectionner la ligne
    return reply.send({ category, tracks })
  })

  // POST /tracks/:id/like : "j'aime" public, anonyme, un entier qui monte.
  // Pas de compte requis (page pensee pour des visiteurs venus de Discord),
  // donc pas de garde-fou serveur contre les clics repetes au-dela du
  // rateLimit global : la garde vit cote client (un like par appareil,
  // cf +page.svelte), proportionne a l'enjeu (un signal d'appreciation,
  // pas un vote a securiser).
  app.post('/tracks/:id/like', { preHandler: [rateLimit] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const track = await MusicTrackModel.addLike(id)
    if (!track) return reply.code(404).send({ error: 'Track not found', code: 'NOT_FOUND' })
    return reply.send({ likes: track.likes })
  })

  // Commentaires publics par morceau : sert le vrai cas d'usage (un
  // développeur destinataire laisse un avis), aucun compte requis, comme le
  // reste de la page. Modération réservée à l'admin (DELETE plus bas).
  app.get('/tracks/:id/comments', { preHandler: [rateLimit] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const comments = await MusicCommentModel.listByTrack(id)
    return reply.send({ comments })
  })

  app.post('/tracks/:id/comments', { preHandler: [rateLimit] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = request.body as { author_name?: string; body?: string }
    const authorName = (body.author_name ?? '').trim()
    const commentBody = (body.body ?? '').trim()

    if (authorName.length < 1 || authorName.length > 60) {
      return reply.code(400).send({ error: 'author_name must be 1 to 60 characters', code: 'INVALID_AUTHOR' })
    }
    if (commentBody.length < 1 || commentBody.length > 1000) {
      return reply.code(400).send({ error: 'body must be 1 to 1000 characters', code: 'INVALID_BODY' })
    }
    const nameCheck = checkContent(authorName)
    if (!nameCheck.ok) return reply.code(422).send({ error: nameCheck.reason, code: 'CONTENT_BLOCKED' })
    const bodyCheck = checkContent(commentBody)
    if (!bodyCheck.ok) return reply.code(422).send({ error: bodyCheck.reason, code: 'CONTENT_BLOCKED' })

    const track = await MusicTrackModel.findById(id)
    if (!track) return reply.code(404).send({ error: 'Track not found', code: 'NOT_FOUND' })

    const comment = await MusicCommentModel.create({ track_id: id, author_name: authorName, body: commentBody })
    return reply.code(201).send({ comment })
  })

  app.delete('/comments/:id', { preHandler: [rateLimit, adminOnly] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const ok = await MusicCommentModel.remove(id)
    if (!ok) return reply.code(404).send({ error: 'Comment not found', code: 'NOT_FOUND' })
    return reply.code(204).send()
  })

  // GET /categories/:id/license.pdf : attestation de provenance, publique et
  // téléchargeable (pensée pour être transmise au développeur destinataire).
  app.get('/categories/:id/license.pdf', { preHandler: [rateLimit] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const category = await MusicCategoryModel.findById(id)
    if (!category) return reply.code(404).send({ error: 'Category not found', code: 'NOT_FOUND' })
    if (!category.license_note) return reply.code(404).send({ error: 'No license note for this category', code: 'NO_LICENSE' })

    const [tracks, communityRows] = await Promise.all([
      MusicTrackModel.listByCategory(category.id),
      db.query<{ name: string }>(`SELECT name FROM communities WHERE id = $1`, [category.community_id]),
    ])

    const pdf = await generateLicensePdf({
      categoryTitle: category.title,
      licenseNote:   category.license_note,
      communityName: communityRows.rows[0]?.name ?? 'Nodyx',
      trackTitles:   tracks.map(t => t.title),
      generatedAt:   new Date(),
    })

    reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="licence-${category.slug}.pdf"`)
      .send(pdf)
  })

  // ── Écriture admin : catégories ──────────────────────────────────────────

  app.post('/categories', { preHandler: [rateLimit, adminOnly] }, async (request, reply) => {
    const { title, description } = request.body as { title?: string; description?: string }
    if (!title || title.trim().length < 2 || title.length > 120) {
      return reply.code(400).send({ error: 'title must be 2 to 120 characters', code: 'INVALID_TITLE' })
    }
    const communityId = await getCommunityId()
    if (!communityId) return reply.code(503).send({ error: 'Community not configured' })

    const category = await MusicCategoryModel.create({
      community_id: communityId,
      title:        title.trim(),
      description:  description?.trim() || null,
    })
    return reply.code(201).send({ category })
  })

  app.patch('/categories/:id', { preHandler: [rateLimit, adminOnly] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = request.body as { title?: string; description?: string | null; license_note?: string | null; image_asset_id?: string | null; position?: number }
    if (body.title !== undefined && (body.title.trim().length < 2 || body.title.length > 120)) {
      return reply.code(400).send({ error: 'title must be 2 to 120 characters', code: 'INVALID_TITLE' })
    }
    const category = await MusicCategoryModel.update(id, body)
    if (!category) return reply.code(404).send({ error: 'Category not found', code: 'NOT_FOUND' })
    return reply.send({ category })
  })

  app.delete('/categories/:id', { preHandler: [rateLimit, adminOnly] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const ok = await MusicCategoryModel.remove(id)
    if (!ok) return reply.code(404).send({ error: 'Category not found', code: 'NOT_FOUND' })
    return reply.code(204).send()
  })

  // ── Écriture admin : morceaux ────────────────────────────────────────────

  app.post('/tracks', { preHandler: [rateLimit, adminOnly] }, async (request, reply) => {
    const body = request.body as {
      category_id?: string; title?: string; description?: string
      audio_asset_id?: string; image_asset_id?: string
    }
    if (!body.category_id || !body.audio_asset_id) {
      return reply.code(400).send({ error: 'category_id and audio_asset_id are required', code: 'MISSING_FIELDS' })
    }
    if (!body.title || body.title.trim().length < 1 || body.title.length > 150) {
      return reply.code(400).send({ error: 'title must be 1 to 150 characters', code: 'INVALID_TITLE' })
    }
    const category = await MusicCategoryModel.findById(body.category_id)
    if (!category) return reply.code(404).send({ error: 'Category not found', code: 'NOT_FOUND' })

    const track = await MusicTrackModel.create({
      category_id:     body.category_id,
      title:           body.title.trim(),
      description:     body.description?.trim() || null,
      audio_asset_id:  body.audio_asset_id,
      image_asset_id:  body.image_asset_id || null,
    })
    return reply.code(201).send({ track })
  })

  app.patch('/tracks/:id', { preHandler: [rateLimit, adminOnly] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = request.body as { title?: string; description?: string | null; image_asset_id?: string | null; position?: number }
    if (body.title !== undefined && (body.title.trim().length < 1 || body.title.length > 150)) {
      return reply.code(400).send({ error: 'title must be 1 to 150 characters', code: 'INVALID_TITLE' })
    }
    const track = await MusicTrackModel.update(id, body)
    if (!track) return reply.code(404).send({ error: 'Track not found', code: 'NOT_FOUND' })
    return reply.send({ track })
  })

  app.delete('/tracks/:id', { preHandler: [rateLimit, adminOnly] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const ok = await MusicTrackModel.remove(id)
    if (!ok) return reply.code(404).send({ error: 'Track not found', code: 'NOT_FOUND' })
    return reply.code(204).send()
  })

  // ── Upload : audio et image, réutilise le pipeline community_assets ─────
  // (mêmes protections que branding/upload : scan magic bytes AVANT stockage,
  // sharp neutralise tout payload caché dans les images)

  app.post('/upload/audio', { preHandler: [rateLimit, adminOnly] }, async (request, reply) => {
    const data = await request.file()
    if (!data) return reply.code(400).send({ error: 'No file provided' })
    if (!ALLOWED_AUDIO_MIME.includes(data.mimetype)) {
      return reply.code(400).send({ error: 'Format non supporté (mp3, ogg, wav, m4a, flac)' })
    }

    const chunks: Buffer[] = []
    let total = 0
    for await (const chunk of data.file) {
      total += (chunk as Buffer).length
      if (total > MAX_AUDIO_BYTES) return reply.code(400).send({ error: 'Fichier trop lourd (max 30 Mo)' })
      chunks.push(chunk as Buffer)
    }
    const buffer = Buffer.concat(chunks)

    const scan = scanBuffer(buffer, data.mimetype)
    if (!scan.ok) return reply.code(400).send({ error: `Fichier rejeté : ${scan.reason}` })

    const asset = await uploadAsset({
      creatorId:        request.user!.userId,
      buffer,
      originalFilename: data.filename,
      mimeType:         data.mimetype,
      assetType:        'sound',
      name:             data.filename,
    })
    return reply.send({ asset_id: asset.id, url: `/uploads/${asset.file_path}` })
  })

  app.post('/upload/image', { preHandler: [rateLimit, adminOnly] }, async (request, reply) => {
    const data = await request.file()
    if (!data) return reply.code(400).send({ error: 'No file provided' })
    if (!ALLOWED_IMAGE_MIME.includes(data.mimetype)) {
      return reply.code(400).send({ error: 'Format non supporté (jpeg, png, webp, gif)' })
    }

    const chunks: Buffer[] = []
    let total = 0
    for await (const chunk of data.file) {
      total += (chunk as Buffer).length
      if (total > MAX_IMAGE_BYTES) return reply.code(400).send({ error: 'Fichier trop lourd (max 8 Mo)' })
      chunks.push(chunk as Buffer)
    }
    const buffer = Buffer.concat(chunks)

    const scan = scanBuffer(buffer, data.mimetype)
    if (!scan.ok) return reply.code(400).send({ error: `Fichier rejeté : ${scan.reason}` })

    const asset = await uploadAsset({
      creatorId:        request.user!.userId,
      buffer,
      originalFilename: data.filename,
      mimeType:         data.mimetype,
      assetType:        'image',
      name:             data.filename,
    })
    return reply.send({
      asset_id:      asset.id,
      url:           `/uploads/${asset.file_path}`,
      thumbnail_url: asset.thumbnail_path ? `/uploads/${asset.thumbnail_path}` : null,
    })
  })
}
