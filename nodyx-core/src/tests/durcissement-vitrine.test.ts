// ─── Invariants du durcissement vitrine (incident nerti, 2026-09-01) ─────────
//
// Ces contrôles lisent la migration 117, pas la base : ils protègent des choix
// de conception qui deviennent irréversibles une fois la migration jouée.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const M117 = readFileSync(
  new URL('../migrations/117_durcissement_vitrine.sql', import.meta.url).pathname, 'utf-8')

describe('migration 117 — durcissement vitrine', () => {
  it('ajoute post_min_role avec défaut inerte "member" et une contrainte de valeurs', () => {
    expect(M117).toMatch(/ADD COLUMN IF NOT EXISTS post_min_role TEXT NOT NULL DEFAULT 'member'/i)
    expect(M117).toMatch(/CHECK \(post_min_role IN \('member', 'moderator', 'admin', 'owner'\)\)/i)
  })

  it('verrouille la catégorie annonces sans toucher les autres', () => {
    // Une seule UPDATE ciblée par slug, jamais un balayage global des catégories.
    expect(M117).toMatch(/UPDATE categories SET post_min_role = 'admin' WHERE slug = 'annonces'/i)
    expect(M117).not.toMatch(/UPDATE categories SET post_min_role = 'admin';\s*$/im)
  })

  it('ajoute showcased_at sans jamais rétrograder un fil déjà featured', () => {
    expect(M117).toMatch(/ADD COLUMN IF NOT EXISTS showcased_at TIMESTAMPTZ/i)
    // Le backfill ne fait que POSER une date sur les fils featured, il ne
    // dé-featured personne (pas de UPDATE ... SET is_featured).
    expect(M117).toMatch(/WHERE is_featured = true\s+AND showcased_at IS NULL/i)
    expect(M117).not.toMatch(/SET is_featured/i)
  })

  it('rogne les pseudos sans provoquer de collision d’unicité', () => {
    expect(M117).toMatch(/SET username = btrim\(u\.username\)/i)
    // La garde anti-collision est obligatoire : sans elle, un btrim qui heurte
    // un pseudo existant ferait échouer la migration, donc le démarrage.
    expect(M117).toMatch(/NOT EXISTS \(\s*SELECT 1 FROM users x/i)
  })

  it('ajoute last_seen_ip pour donner une cible au ban IP', () => {
    expect(M117).toMatch(/ADD COLUMN IF NOT EXISTS last_seen_ip INET/i)
  })

  it('toutes les colonnes sont additives (IF NOT EXISTS), aucune suppression', () => {
    expect(M117).not.toMatch(/DROP COLUMN/i)
    expect(M117).not.toMatch(/DROP TABLE/i)
    const addCols = M117.match(/ADD COLUMN/gi) ?? []
    const guarded = M117.match(/ADD COLUMN IF NOT EXISTS/gi) ?? []
    expect(addCols.length).toBe(guarded.length)
  })
})
