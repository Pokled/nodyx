// ─── Savoir quand le port 7443 pourra être retiré ────────────────────────────
//
// Le chantier relais ajoute une seconde porte en WebSocket sur 443, sans toucher
// au port 7443 hérité dont dépendent les instances déjà installées. Le CDC
// prévoit de le retirer « quand la télémétrie montre que plus personne ne
// l'utilise ».
//
// Cette télémétrie n'existait pas. Rien ne distinguait une instance connectée en
// TCP brut d'une instance en WebSocket : la dépréciation aurait été un pari, et
// fermer le port aurait pu couper quelqu'un sans qu'on l'apprenne jamais.
//
// Ces contrôles lisent la migration, pas la base : ils protègent une décision de
// conception, pas des données. Même approche que `security-model.test.ts`.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const SQL = readFileSync(
  new URL('../migrations/116_relais_transport.sql', import.meta.url).pathname, 'utf-8')

describe('télémétrie de dépréciation du 7443', () => {
  it("n'enregistre QUE le transport et la date", () => {
    // Nodyx revendique zéro analytique. La seule question à laquelle ces
    // colonnes servent est « reste-t-il quelqu'un sur 7443 ? ». Toute colonne
    // supplémentaire serait de la collecte sans usage.
    expect(SQL).toMatch(/relay_transport\s+TEXT/i)
    expect(SQL).toMatch(/relay_transport_at\s+TIMESTAMPTZ/i)
    for (const interdit of ['ip', 'user_agent', 'count', 'requests']) {
      expect(SQL.toLowerCase()).not.toMatch(new RegExp(`add column[^;]*\\b${interdit}\\b`))
    }
  })

  it('fige les deux seules valeurs possibles', () => {
    // Une faute de frappe côté relais ferait croire à tort que personne n'est
    // resté sur l'ancien port, et donc autoriserait une fermeture prématurée.
    expect(SQL).toMatch(/CHECK\s*\(\s*relay_transport IS NULL OR relay_transport IN \('tcp7443',\s*'wss'\)\s*\)/)
  })

  it('reste applicable deux fois de suite', () => {
    // Les migrations sont rejouées au démarrage : une migration non idempotente
    // ferait échouer le démarrage du cœur au deuxième lancement.
    expect(SQL).toMatch(/ADD COLUMN IF NOT EXISTS/i)
    expect(SQL).toMatch(/CREATE INDEX IF NOT EXISTS/i)
    expect(SQL).toMatch(/IF NOT EXISTS\s*\(\s*SELECT 1 FROM pg_constraint/i)
  })

  it("indexe l'unique requête de décision", () => {
    // Qui est encore sur l'ancien port, et quand l'a-t-on vu pour la dernière
    // fois : c'est le seul axe d'interrogation prévu.
    expect(SQL).toMatch(/ON directory_instances \(relay_transport, relay_transport_at DESC\)/)
  })

  it('documente que NULL ne veut pas dire migré', () => {
    // Le piège de lecture : conclure d'un NULL qu'une instance a migré
    // autoriserait à fermer le port sur une instance simplement dormante.
    expect(SQL).toMatch(/NULL[^\n]*ne veut PAS dire migré|NULL = jamais observé/)
  })

  it('ne touche à aucune donnée existante', () => {
    // Une migration qui écrirait une valeur par défaut inventerait une
    // télémétrie qu'on n'a pas observée.
    expect(SQL).not.toMatch(/UPDATE\s+directory_instances/i)
    expect(SQL).not.toMatch(/SET DEFAULT/i)
  })
})
