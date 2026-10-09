/**
 * Seed script — génère des assets d'exemple pour la bibliothèque
 * Usage : npx tsx src/scripts/seed_assets.ts
 */
import crypto from 'crypto'
import fs from 'fs/promises'
import path from 'path'
import sharp from 'sharp'
import { db } from '../config/database'

const UPLOADS = path.join(process.cwd(), 'uploads', 'assets')
const THUMB_SIZE = 256

interface AssetDef {
  name: string
  description: string
  asset_type: string
  tags: string[]
  image: () => Promise<Buffer>  // génère le contenu WebP
}

// ── Générateurs d'images ─────────────────────────────────────────────────────

function svgToBuffer(svg: string) {
  return sharp(Buffer.from(svg)).webp({ quality: 90 }).toBuffer()
}

const ASSETS: AssetDef[] = [
  {
    name: 'Cadre Doré',
    description: 'Un cadre de profil élégant aux tons dorés, parfait pour mettre en valeur ton avatar.',
    asset_type: 'frame',
    tags: ['doré', 'élégant', 'classique'],
    image: () => svgToBuffer(`
      <svg width="512" height="512" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%"   stop-color="#f59e0b"/>
            <stop offset="50%"  stop-color="#fde68a"/>
            <stop offset="100%" stop-color="#d97706"/>
          </linearGradient>
        </defs>
        <rect width="512" height="512" fill="none"/>
        <rect x="8" y="8" width="496" height="496" rx="20" fill="none" stroke="url(#g)" stroke-width="16"/>
        <rect x="24" y="24" width="464" height="464" rx="14" fill="none" stroke="url(#g)" stroke-width="4" opacity="0.6"/>
        <circle cx="20"  cy="20"  r="8" fill="#f59e0b"/>
        <circle cx="492" cy="20"  r="8" fill="#f59e0b"/>
        <circle cx="20"  cy="492" r="8" fill="#f59e0b"/>
        <circle cx="492" cy="492" r="8" fill="#f59e0b"/>
      </svg>`),
  },
  {
    name: 'Bannière Coucher de Soleil',
    description: 'Une bannière de profil avec un dégradé chaud rappelant le coucher de soleil.',
    asset_type: 'banner',
    tags: ['sunset', 'chaud', 'orange', 'dégradé'],
    image: () => svgToBuffer(`
      <svg width="1200" height="400" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="sky" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%"   stop-color="#7c3aed"/>
            <stop offset="40%"  stop-color="#db2777"/>
            <stop offset="70%"  stop-color="#f97316"/>
            <stop offset="100%" stop-color="#fbbf24"/>
          </linearGradient>
        </defs>
        <rect width="1200" height="400" fill="url(#sky)"/>
        <ellipse cx="600" cy="420" rx="500" ry="120" fill="#1c1917" opacity="0.5"/>
        <circle cx="900" cy="120" r="60" fill="#fde68a" opacity="0.9"/>
        <circle cx="900" cy="120" r="80" fill="#fde68a" opacity="0.15"/>
      </svg>`),
  },
  {
    name: 'Badge Fondateur',
    description: 'Badge exclusif pour les membres fondateurs. Montre que tu étais là dès le début !',
    asset_type: 'badge',
    tags: ['fondateur', 'exclusif', 'or', 'prestige'],
    image: () => svgToBuffer(`
      <svg width="256" height="256" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%"   stop-color="#1e1b4b"/>
            <stop offset="100%" stop-color="#312e81"/>
          </linearGradient>
          <linearGradient id="rim" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%"   stop-color="#f59e0b"/>
            <stop offset="50%"  stop-color="#fde68a"/>
            <stop offset="100%" stop-color="#d97706"/>
          </linearGradient>
        </defs>
        <polygon points="128,16 160,80 232,88 184,140 200,216 128,180 56,216 72,140 24,88 96,80"
                 fill="url(#bg)" stroke="url(#rim)" stroke-width="6"/>
        <text x="128" y="120" font-family="serif" font-size="28" font-weight="bold"
              fill="#fde68a" text-anchor="middle">NODYX</text>
        <text x="128" y="152" font-family="serif" font-size="16"
              fill="#a5b4fc" text-anchor="middle">FONDATEUR</text>
      </svg>`),
  },
  {
    name: 'Sticker Flamme Nodyx',
    description: 'Un sticker flamme animée pour exprimer ton énergie dans les discussions.',
    asset_type: 'sticker',
    tags: ['flamme', 'feu', 'energie', 'sticker'],
    image: () => svgToBuffer(`
      <svg width="256" height="256" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <radialGradient id="glow" cx="50%" cy="80%" r="60%">
            <stop offset="0%"   stop-color="#fde68a" stop-opacity="0.4"/>
            <stop offset="100%" stop-color="#f97316" stop-opacity="0"/>
          </radialGradient>
        </defs>
        <ellipse cx="128" cy="220" rx="80" ry="20" fill="url(#glow)"/>
        <path d="M128,240 C80,200 60,160 90,120 C70,140 100,100 128,60
                 C128,100 150,80 160,110 C180,80 170,40 190,20
                 C220,80 210,140 190,170 C200,150 210,130 200,110
                 C195,160 180,200 128,240Z"
              fill="#f97316"/>
        <path d="M128,220 C100,190 90,160 108,135 C100,150 120,125 128,100
                 C128,125 142,115 148,135 C155,115 150,90 162,75
                 C178,115 170,160 158,180 C165,165 170,148 162,135
                 C158,165 148,195 128,220Z"
              fill="#fbbf24"/>
        <path d="M128,200 C115,180 112,160 120,145 C117,157 128,148 128,135
                 C132,148 138,142 140,152 C142,142 138,130 144,122
                 C154,145 148,172 140,184 C143,175 146,165 140,155
                 C138,173 134,188 128,200Z"
              fill="#fde68a"/>
      </svg>`),
  },
  {
    name: 'Bannière Galaxie',
    description: 'Une bannière spatiale avec des étoiles scintillantes pour les explorateurs du cosmos.',
    asset_type: 'banner',
    tags: ['espace', 'galaxie', 'étoiles', 'sombre', 'cosmos'],
    image: () => svgToBuffer(`
      <svg width="1200" height="400" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <radialGradient id="nebula" cx="30%" cy="50%" r="60%">
            <stop offset="0%"   stop-color="#4c1d95" stop-opacity="0.8"/>
            <stop offset="100%" stop-color="#0f0a1a" stop-opacity="0"/>
          </radialGradient>
          <radialGradient id="nebula2" cx="70%" cy="40%" r="50%">
            <stop offset="0%"   stop-color="#1e3a8a" stop-opacity="0.6"/>
            <stop offset="100%" stop-color="#0f0a1a" stop-opacity="0"/>
          </radialGradient>
        </defs>
        <rect width="1200" height="400" fill="#0f0a1a"/>
        <rect width="1200" height="400" fill="url(#nebula)"/>
        <rect width="1200" height="400" fill="url(#nebula2)"/>
        ${Array.from({ length: 80 }, (_, i) => {
          const x = (i * 137.5) % 1200
          const y = (i * 97.3) % 400
          const r = (i % 3 === 0) ? 2.5 : (i % 2 === 0) ? 1.5 : 1
          const op = 0.4 + (i % 5) * 0.12
          return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}" fill="white" opacity="${op.toFixed(2)}"/>`
        }).join('')}
        <ellipse cx="360" cy="200" rx="180" ry="80" fill="#7c3aed" opacity="0.15" transform="rotate(-20 360 200)"/>
      </svg>`),
  },
  {
    name: 'Cadre Néon Cyberpunk',
    description: 'Un cadre de profil aux lignes néon inspirées de l\'esthétique cyberpunk.',
    asset_type: 'frame',
    tags: ['néon', 'cyberpunk', 'violet', 'futuriste'],
    image: () => svgToBuffer(`
      <svg width="512" height="512" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <filter id="glow">
            <feGaussianBlur stdDeviation="4" result="blur"/>
            <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
        </defs>
        <rect width="512" height="512" fill="none"/>
        <!-- Outer frame -->
        <rect x="6"  y="6"  width="500" height="500" rx="4" fill="none" stroke="#a855f7" stroke-width="2" filter="url(#glow)"/>
        <rect x="14" y="14" width="484" height="484" rx="2" fill="none" stroke="#7c3aed" stroke-width="1" opacity="0.6"/>
        <!-- Corners -->
        <path d="M6,80 L6,6 L80,6"   fill="none" stroke="#e879f9" stroke-width="6" stroke-linecap="square" filter="url(#glow)"/>
        <path d="M432,6 L506,6 L506,80" fill="none" stroke="#e879f9" stroke-width="6" stroke-linecap="square" filter="url(#glow)"/>
        <path d="M6,432 L6,506 L80,506" fill="none" stroke="#e879f9" stroke-width="6" stroke-linecap="square" filter="url(#glow)"/>
        <path d="M432,506 L506,506 L506,432" fill="none" stroke="#e879f9" stroke-width="6" stroke-linecap="square" filter="url(#glow)"/>
        <!-- Side accents -->
        <line x1="6"   y1="200" x2="6"   y2="312" stroke="#06b6d4" stroke-width="4" filter="url(#glow)"/>
        <line x1="506" y1="200" x2="506" y2="312" stroke="#06b6d4" stroke-width="4" filter="url(#glow)"/>
        <line x1="200" y1="6"   x2="312" y2="6"   stroke="#06b6d4" stroke-width="4" filter="url(#glow)"/>
        <line x1="200" y1="506" x2="312" y2="506" stroke="#06b6d4" stroke-width="4" filter="url(#glow)"/>
      </svg>`),
  },
]

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  await fs.mkdir(UPLOADS, { recursive: true })

  // Find or use a system user for creator_id
  const { rows: users } = await db.query<{ id: string }>(`SELECT id FROM users LIMIT 1`)
  const creatorId = users[0]?.id ?? null

  console.log(`Seeding ${ASSETS.length} assets (creator: ${creatorId ?? 'none'})…`)

  for (const def of ASSETS) {
    // Generate the main WebP
    const buffer = await def.image()
    const hash   = crypto.createHash('sha256').update(buffer).digest('hex')

    // Check if already seeded
    const { rows: existing } = await db.query(`SELECT id FROM community_assets WHERE file_hash = $1`, [hash])
    if (existing.length > 0) {
      console.log(`  ⏭  ${def.name} (already exists)`)
      continue
    }

    const filePath = `assets/${hash}.webp`
    await fs.writeFile(path.join(process.cwd(), 'uploads', filePath), buffer)

    // Generate thumbnail
    const thumbBuffer = await sharp(buffer)
      .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'cover' })
      .webp({ quality: 75 })
      .toBuffer()
    const thumbPath = `assets/${hash}_thumb.webp`
    await fs.writeFile(path.join(process.cwd(), 'uploads', thumbPath), thumbBuffer)

    await db.query(
      `INSERT INTO community_assets
         (asset_type, name, description, creator_id,
          file_path, file_hash, file_size, mime_type, original_filename,
          thumbnail_path, tags, metadata, is_public)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true)`,
      [
        def.asset_type, def.name, def.description, creatorId,
        filePath, hash, buffer.length, 'image/webp', `${def.name.toLowerCase().replace(/ /g, '_')}.webp`,
        thumbPath, def.tags, '{}',
      ]
    )
    console.log(`  ✅  ${def.name} (${(buffer.length / 1024).toFixed(1)} Ko)`)
  }

  console.log('Done.')
  process.exit(0)
}

main().catch(err => { console.error(err); process.exit(1) })
