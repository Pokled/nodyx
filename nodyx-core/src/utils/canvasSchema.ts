// ── Éléments du canvas : la définition partagée (10/10/2026) ──────────────────
//
// Miroir de `nodyx-frontend/src/lib/canvas.ts`. Avant cette date, le serveur
// connaissait 8 types d'éléments sur 11 : les cadres, les formes avancées
// (hexagone, étoile, nuage…) et les connecteurs, ajoutés au frontend le 16/04,
// étaient IGNORÉS en silence par la sauvegarde en direct (socket/canvas.ts) et
// REFUSÉS par l'API (routes/canvas.ts) : dessinés, puis disparus au
// rechargement. Les deux chemins lisent désormais la même liste, et le test
// canvas-schema.test.ts la compare au frontend.

import { z } from 'zod'

/** Les types d'éléments enregistrés (les outils `select` et `eraser` n'en créent pas, `eraser` reste admis pour les anciens tableaux). */
export const ELEMENT_KINDS = [
  'pen', 'sticky', 'rect', 'circle', 'shape', 'text', 'arrow', 'connector', 'image', 'frame', 'eraser',
] as const
export type ElementKind = (typeof ELEMENT_KINDS)[number]

const couleur  = z.string().max(32)
const opacite  = z.number().min(0).max(1)
// Bornes larges exprès : le frontend ne limite ni la longueur des textes ni
// la taille des éléments, et la sauvegarde en direct n'en refusait aucun. La
// vraie borne reste MAX_DATA_BYTES, appliquée par chaque appelant.
const texte = (max: number) => z.string().max(max)
const epaisseur = z.number().min(0).max(500)
const extremite = z.enum(['none', 'arrow', 'dot'])
const trait    = z.enum(['solid', 'dashed', 'dotted'])

export const PathDataSchema = z.object({
  points:  z.array(z.tuple([z.number(), z.number()])).max(20_000),
  color:   couleur,
  width:   epaisseur,
  opacity: opacite.optional(),
})
export const StickyDataSchema = z.object({
  x: z.number(), y: z.number(),
  w: z.number().optional(), h: z.number().optional(),
  text:  texte(20_000),
  color: couleur,
})
export const ShapeDataSchema = z.object({
  x: z.number(), y: z.number(), w: z.number(), h: z.number(),
  color:       couleur,
  fill:        z.boolean(),
  strokeColor: couleur.optional(),
  strokeWidth: epaisseur.optional(),
  opacity:     opacite.optional(),
  shape:       z.enum(['triangle', 'diamond', 'star', 'hexagon', 'cloud']).optional(),
  label:       texte(20_000).optional(),
})
export const TextDataSchema = z.object({
  x: z.number(), y: z.number(),
  text:          texte(20_000),
  color:         couleur,
  fontSize:      z.number().min(1).max(1000).optional(),
  bold:          z.boolean().optional(),
  italic:        z.boolean().optional(),
  underline:     z.boolean().optional(),
  strikethrough: z.boolean().optional(),
  align:         z.enum(['left', 'center', 'right']).optional(),
  fontFamily:    z.enum(['sans', 'serif', 'mono']).optional(),
  w:             z.number().optional(),
})
export const ArrowDataSchema = z.object({
  x1: z.number(), y1: z.number(), x2: z.number(), y2: z.number(),
  color:     couleur,
  width:     epaisseur,
  lineStyle: trait.optional(),
  startCap:  extremite.optional(),
  endCap:    extremite.optional(),
})
export const ImageDataSchema = z.object({
  x: z.number(), y: z.number(), w: z.number(), h: z.number(),
  url:     texte(2000),
  assetId: z.string().uuid().optional(),
  opacity: opacite.optional(),
})
export const FrameDataSchema = z.object({
  x: z.number(), y: z.number(), w: z.number(), h: z.number(),
  name:  texte(1000),
  color: couleur,
})
export const ConnectorDataSchema = z.object({
  x1: z.number(), y1: z.number(), x2: z.number(), y2: z.number(),
  type:     z.enum(['straight', 'bezier', 'elbow']),
  style:    trait,
  color:    couleur,
  width:    epaisseur,
  startCap: extremite,
  endCap:   extremite,
})

/** Le schéma des données attendu pour chaque type d'élément. */
export const DATA_SCHEMA_BY_KIND: Record<ElementKind, z.ZodTypeAny> = {
  pen: PathDataSchema, eraser: PathDataSchema,
  sticky: StickyDataSchema,
  rect: ShapeDataSchema, circle: ShapeDataSchema, shape: ShapeDataSchema,
  text: TextDataSchema,
  arrow: ArrowDataSchema,
  connector: ConnectorDataSchema,
  image: ImageDataSchema,
  frame: FrameDataSchema,
}

/** Un lien attaché à un élément : http(s) seulement, jamais `javascript:` ni `data:`. */
export const lienSur = z.string().max(500).regex(/^https?:\/\//i)

const base = {
  id:      z.string().uuid(),
  ts:      z.number(),
  author:  z.string().uuid(),
  deleted: z.boolean().optional(),
  locked:  z.boolean().optional(),
  url:     lienSur.optional(),
}

/**
 * Un élément, validé selon SON type : avant, une union retenait le premier
 * schéma compatible, et un texte passait pour une note (perdant sa taille et
 * son gras). Les champs inconnus sont retirés.
 */
const element = <K extends ElementKind>(kind: K) =>
  z.object({ ...base, kind: z.literal(kind), data: DATA_SCHEMA_BY_KIND[kind] })

export const CanvasElementSchema = z.discriminatedUnion('kind', [
  element('pen'), element('sticky'), element('rect'), element('circle'), element('shape'), element('text'),
  element('arrow'), element('connector'), element('image'), element('frame'), element('eraser'),
])

export const SnapshotSchema = z.array(CanvasElementSchema).max(5000)

/** Plafond du JSON de `data` par élément (audit du 16/09, cf socket/canvas.ts). */
export const MAX_DATA_BYTES = 64_000

export type ParsedCanvasElement = z.infer<typeof CanvasElementSchema>

/** Valide un élément reçu ; renvoie sa version nettoyée, ou null s'il est refusé. */
export function parseCanvasElement(input: unknown): ParsedCanvasElement | null {
  const r = CanvasElementSchema.safeParse(input)
  if (!r.success) return null
  try {
    return JSON.stringify(r.data.data).length <= MAX_DATA_BYTES ? r.data : null
  } catch {
    return null
  }
}
