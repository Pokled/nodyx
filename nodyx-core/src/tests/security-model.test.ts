// ─── Les invariants du modèle de sécurité ────────────────────────────────────
//
// Ces contrôles lisent les migrations, pas la base : ils protègent des décisions
// de conception, pas des données. Une migration est jouée une fois en production
// et devient irréversible ; ce qu'on y écrit mérite un garde-fou de la même
// nature que le code.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const EVENTS = readFileSync(
  new URL('../migrations/114_security_events.sql', import.meta.url).pathname, 'utf-8')
const DECISIONS = readFileSync(
  new URL('../migrations/115_security_decisions.sql', import.meta.url).pathname, 'utf-8')

describe('modèle de sécurité — événements', () => {
  it('ne recopie AUCUNE donnée existante dans la table', () => {
    // Le choix structurant : `security_events` accueille les sources nouvelles,
    // une vue d'union y projette l'existant. Recopier les 18 463 lignes du pot de
    // miel créerait deux vérités à purger séparément, et le jour où elles
    // divergent on ne saurait plus laquelle croire.
    expect(EVENTS).not.toMatch(/INSERT\s+INTO\s+security_events/i)
    expect(EVENTS).toMatch(/CREATE OR REPLACE VIEW security_events_all/i)
  })

  it('expose les tables historiques par la vue, sans les modifier', () => {
    expect(EVENTS).toMatch(/FROM honeypot_hits/i)
    expect(EVENTS).toMatch(/FROM bot_signup_attempts/i)
    // Aucune écriture sur les tables d'origine : elles restent maîtresses.
    expect(EVENTS).not.toMatch(/(UPDATE|DELETE FROM|ALTER TABLE)\s+honeypot_hits/i)
  })

  it('protège la vue contre une adresse mal formée', () => {
    // `honeypot_hits.ip` est de type TEXT là où les autres sont INET. Un cast nu
    // ferait échouer la vue ENTIÈRE sur une seule valeur douteuse.
    expect(EVENTS).toMatch(/pg_input_is_valid/)
  })

  it('indexe les deux axes réels : par IP et par source', () => {
    expect(EVENTS).toMatch(/idx_sec_events_ip_ts[\s\S]*?src_ip/)
    expect(EVENTS).toMatch(/idx_sec_events_source_ts[\s\S]*?source/)
  })
})

describe('modèle de sécurité — décisions', () => {
  it("porte le plan d'application, et il est obligatoire", () => {
    // LE champ qui évite une illusion de sécurité. Le trafic web arrive par
    // Cloudflare : l'adresse source au niveau paquet est toujours un edge. Un
    // ban nftables ne bloque donc PAS un attaquant web. Sans cette colonne,
    // Olympus afficherait « BLOQUÉ » pour une IP qui continue de passer — et une
    // fausse assurance est pire qu'une absence de protection, on cesse de
    // regarder.
    expect(DECISIONS).toMatch(/enforcement_plane\s+TEXT\s+NOT NULL/i)
    for (const plan of ['nftables', 'cloudflare', 'application', 'none']) {
      expect(DECISIONS, `plan « ${plan} » manquant`).toContain(`'${plan}'`)
    }
  })

  it("distingue la décision PRISE de l'application CONFIRMÉE", () => {
    // `enforced_at` NULL = décidé mais non vérifié. C'est exactement ce que le
    // banc d'essai doit détecter.
    expect(DECISIONS).toMatch(/enforced_at\s+TIMESTAMPTZ/i)
    expect(DECISIONS).not.toMatch(/enforced_at\s+TIMESTAMPTZ\s+NOT NULL/i)
  })

  it('refuse une adresse qui ne désigne aucun visiteur', () => {
    // Même règle que la contrainte posée sur `reported_ips` en #587 : une IP
    // privée ou de bouclage n'a aucun sens comme cible de décision.
    expect(DECISIONS).toMatch(/CHECK\s*\(NOT nodyx_ip_non_publique\(src_ip\)\)/)
  })

  it('sépare ce qui est en vigueur de ce qui est historique', () => {
    // Une décision expirée reste en base : c'est elle qui dira « déjà banni
    // hier », signal central de la continuité de campagne.
    expect(DECISIONS).toMatch(/CREATE OR REPLACE VIEW security_decisions_actives/i)
    expect(DECISIONS).toMatch(/expires_at IS NULL OR expires_at > NOW\(\)/i)
  })
})
