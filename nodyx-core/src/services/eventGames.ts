// Le catalogue de jeux d'une communauté (§10 du CDC des mentions, D66).
// Une jaquette est TOUJOURS une copie sur l'instance (/uploads/games/<id>.webp),
// réencodée par sharp au format portrait 2:3 (celui des catégories de Twitch et des
// jaquettes Steam) : jamais un lien vers un service tiers, jamais le fichier brut.
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { db } from '../config/database'
import { scanBuffer } from './fileScanner'
import { safeRequest } from '../utils/ssrfGuard'

export const GAME_ICONS = ['pad', 'aim', 'sword', 'shield', 'dice', 'cards', 'trophy', 'crown', 'head', 'rocket', 'film', 'music', 'ball'] as const
export const GAME_COLORS = ['red', 'violet', 'blue', 'green', 'orange', 'grey'] as const

const DIR = path.join(process.cwd(), 'uploads', 'games')
const MAX_UPLOAD = 5 * 1024 * 1024
const IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp']
const UA = 'Nodyx (self-hosted community platform; game cover import)'

export interface Game { id: string; name: string; cover_path: string; source: 'upload' | 'steam' }

export class GameError extends Error {
  constructor(public code: string, public status: number, message: string) { super(message) }
}

/** L'import depuis Steam peut être coupé par l'instance : NODYX_STEAM_IMPORT=off. */
export const steamEnabled = (): boolean => process.env.NODYX_STEAM_IMPORT !== 'off'

export const cleanName = (s: unknown): string =>
  typeof s === 'string' ? s.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) : ''

export async function listGames(communityId: string, q = ''): Promise<Game[]> {
  const term = cleanName(q).toLowerCase()
  const { rows } = await db.query<Game>(
    `SELECT id, name, cover_path, source FROM event_games
     WHERE community_id = $1 AND ($2 = '' OR lower(name) LIKE '%' || $2 || '%')
     ORDER BY lower(name) LIMIT 200`, [communityId, term.replace(/[\\%_]/g, c => '\\' + c)])
  return rows
}

/** Une jaquette réencodée : portrait 2:3, 600×900, webp. Rien d'autre n'est écrit. */
async function storeCover(buf: Buffer, mime: string): Promise<string> {
  if (!IMAGE_MIME.includes(mime)) throw new GameError('GAME_COVER_FORMAT', 400, 'Formats : jpeg, png, webp')
  if (buf.length === 0 || buf.length > MAX_UPLOAD) throw new GameError('GAME_COVER_SIZE', 400, 'Image vide ou trop lourde (5 Mo au plus)')
  const scan = scanBuffer(buf, mime)
  if (!scan.ok) throw new GameError('GAME_COVER_REJECTED', 400, scan.reason ?? 'Fichier rejeté')
  let out: Buffer
  try {
    // Une vraie jaquette (en hauteur) remplit le cadre ; un logo ou un en-tête en largeur
    // est posé ENTIER sur fond sombre : rogné, « SuperTuxKart » devenait « uper xK ».
    const img = sharp(buf, { limitInputPixels: 40_000_000 }).rotate()
    const meta = await img.metadata()
    const w = (meta.autoOrient?.width ?? meta.width ?? 1), h = (meta.autoOrient?.height ?? meta.height ?? 1)
    const portrait = w / h <= 0.8
    out = await img.resize(600, 900, portrait
      ? { fit: 'cover', position: 'attention' }
      : { fit: 'contain', background: { r: 20, g: 17, b: 12, alpha: 1 } })
      .flatten({ background: { r: 20, g: 17, b: 12 } }).webp({ quality: 85 }).toBuffer()
  } catch {
    throw new GameError('GAME_COVER_UNREADABLE', 400, 'Image illisible')
  }
  await fs.mkdir(DIR, { recursive: true })
  const name = `${randomUUID()}.webp`
  await fs.writeFile(path.join(DIR, name), out)
  return `/uploads/games/${name}`
}

async function insertGame(communityId: string, userId: string, name: string, cover: string, source: 'upload' | 'steam', appid: number | null): Promise<Game> {
  try {
    const { rows } = await db.query<Game>(
      `INSERT INTO event_games (community_id, name, cover_path, source, steam_appid, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, name, cover_path, source`,
      [communityId, name, cover, source, appid, userId])
    return rows[0]
  } catch (e) {
    await fs.unlink(path.join(DIR, path.basename(cover))).catch(() => {})
    if ((e as { code?: string }).code === '23505') throw new GameError('GAME_EXISTS', 409, 'Ce jeu est déjà dans le catalogue')
    throw e
  }
}

export async function addUploadedGame(communityId: string, userId: string, rawName: unknown, buf: Buffer, mime: string): Promise<Game> {
  const name = cleanName(rawName)
  if (!name) throw new GameError('GAME_NAME_REQUIRED', 400, 'Le nom du jeu est requis')
  const cover = await storeCover(buf, mime)
  return insertGame(communityId, userId, name, cover, 'upload', null)
}

// Steam range aussi les bandes-son et les artbooks parmi les « apps » : ce ne sont pas des jeux
const NOT_A_GAME = /\b(soundtrack|ost|artbook|art book|wallpapers?)\b/i

// ── Steam : recherche publique, sans clé ; adresses FIGÉES, garde anti-SSRF en plus ──
export async function steamSearch(q: string): Promise<{ appid: number; name: string }[]> {
  if (!steamEnabled()) throw new GameError('STEAM_DISABLED', 403, 'Import Steam désactivé sur cette instance')
  const term = cleanName(q)
  if (term.length < 2) return []
  const r = await safeRequest(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(term)}&l=french&cc=FR`,
    { headers: { 'User-Agent': UA, Accept: 'application/json' }, timeoutMs: 6000, maxBytes: 512 * 1024 })
    .catch(() => { throw new GameError('STEAM_UNREACHABLE', 502, 'Steam ne répond pas') })
  if (r.status !== 200 || r.truncated) throw new GameError('STEAM_UNREACHABLE', 502, 'Steam ne répond pas')
  let items: { id?: unknown; name?: unknown }[] = []
  try { items = JSON.parse(r.body.toString('utf8')).items ?? [] } catch { /* réponse illisible : rien */ }
  return items
    .filter(i => Number.isInteger(i.id) && (i.id as number) > 0 && typeof i.name === 'string')
    .map(i => ({ appid: i.id as number, name: cleanName(i.name) }))
    .filter(i => i.name && !NOT_A_GAME.test(i.name))
    .slice(0, 8)
}

/** La jaquette portrait (library_600x900), ou l'en-tête pour un vieux jeu qui n'en a pas. */
async function steamCover(appid: number): Promise<{ buf: Buffer; mime: string }> {
  for (const file of ['library_600x900.jpg', 'header.jpg']) {
    const r = await safeRequest(`https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/${file}`,
      { headers: { 'User-Agent': UA }, timeoutMs: 8000, maxBytes: MAX_UPLOAD + 1 }).catch(() => null)
    const mime = String(r?.headers['content-type'] ?? '').split(';')[0].trim()
    if (r && r.status === 200 && !r.truncated && IMAGE_MIME.includes(mime)) return { buf: r.body, mime }
  }
  throw new GameError('STEAM_NO_COVER', 404, 'Pas de jaquette pour ce jeu sur Steam')
}

export async function importSteamGame(communityId: string, userId: string, appid: unknown, rawName: unknown): Promise<Game> {
  if (!steamEnabled()) throw new GameError('STEAM_DISABLED', 403, 'Import Steam désactivé sur cette instance')
  if (!Number.isInteger(appid) || (appid as number) <= 0 || (appid as number) > 99_999_999) throw new GameError('STEAM_APPID_INVALID', 400, 'Identifiant Steam invalide')
  const name = cleanName(rawName)
  if (!name) throw new GameError('GAME_NAME_REQUIRED', 400, 'Le nom du jeu est requis')
  const { buf, mime } = await steamCover(appid as number)
  const cover = await storeCover(buf, mime)
  return insertGame(communityId, userId, name, cover, 'steam', appid as number)
}

/** Retirer un jeu : ses événements gardent leur titre, ils perdent seulement la jaquette. */
export async function deleteGame(communityId: string, id: string): Promise<boolean> {
  const { rows } = await db.query<{ cover_path: string }>(
    `DELETE FROM event_games WHERE id = $1 AND community_id = $2 RETURNING cover_path`, [id, communityId])
  if (!rows[0]) return false
  await fs.unlink(path.join(DIR, path.basename(rows[0].cover_path))).catch(() => {})
  return true
}

/** Un jeu de CETTE communauté (pour l'accrocher à un événement). */
export async function gameInCommunity(communityId: string, id: string): Promise<boolean> {
  const { rows } = await db.query(`SELECT 1 FROM event_games WHERE id = $1 AND community_id = $2`, [id, communityId])
  return rows.length > 0
}
