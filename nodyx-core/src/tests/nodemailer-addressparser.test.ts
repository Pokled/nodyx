/**
 * Régression : l'analyseur d'adresses de nodemailer < 10.0.13, par où passent
 * TOUS les destinataires de nos e-mails (emailService, certEmailService).
 *
 *  - GHSA-v53p-9fqp-m79j : une longue suite sans espace ni « @ » utilisable
 *    fait backtracker l'expression de repli en temps quadratique ; ~270 Ko
 *    gèlent la boucle d'événements des dizaines de secondes.
 *  - GHSA-prgh-xp8r-p3m5 : des atomes joints par des commentaires
 *    (`a@b(c)@b(c)...`) sont recollés en temps quadratique.
 *  - GHSA-g57g-f23g-4646 : `"user"@example.com(x)evil.com` donnait
 *    l'adresse « user@example.com evil.com », qui part telle quelle dans
 *    l'enveloppe SMTP.
 *
 * Passe par l'API publique (sendMail sur jsonTransport, aucun réseau), dans
 * un processus à part avec un délai : un analyseur gelé bloquerait aussi les
 * minuteurs de Vitest. Vérifié rouge sur 9.1.1, vert sur 10.0.13.
 */
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

const CORE = path.resolve(__dirname, '../..')

/**
 * Envoie un e-mail via jsonTransport au destinataire que produit l'expression
 * JS `toExpr`, évaluée DANS le processus : une charge de 150 Ko passée en
 * argument dépasserait la limite système (128 Ko) et le processus ne
 * démarrerait même pas. Renvoie l'enveloppe et la durée (ms).
 */
function send(toExpr: string) {
  const script = `
    const nodemailer = require('nodemailer')
    const t = nodemailer.createTransport({ jsonTransport: true })
    const start = Date.now()
    t.sendMail({ from: 'noreply@nodyx.test', to: ${toExpr}, subject: 's', text: 't' })
      .then(info => { console.log(JSON.stringify({ ms: Date.now() - start, to: info.envelope.to })) })
      .catch(e => { console.log(JSON.stringify({ ms: Date.now() - start, rejected: e.message.slice(0, 80) })) })
  `
  const r = spawnSync(process.execPath, ['-e', script], { cwd: CORE, timeout: 8000, encoding: 'utf8' })
  expect(r.error?.message ?? '', 'processus tué au délai : analyseur gelé').not.toContain('ETIMEDOUT')
  expect(r.status, r.stderr.slice(0, 300)).toBe(0)
  return JSON.parse(r.stdout.trim()) as { ms: number; to?: string[]; rejected?: string }
}

describe('nodemailer : analyseur d’adresses', () => {
  it('une longue suite sans espace ni @ utilisable reste linéaire (GHSA-v53p-9fqp-m79j)', () => {
    // Forme de l'avis : 117 Ko, ~9 s de gel sur une version vulnérable.
    const r = send(`'[x]'.repeat(40000)`)
    expect(r.ms).toBeLessThan(1500)
  }, 15000)

  it('des atomes joints par des commentaires restent linéaires (GHSA-prgh-xp8r-p3m5)', () => {
    const r = send(`'a@b' + '(c)@b'.repeat(120000)`)
    expect(r.ms).toBeLessThan(1500)
  }, 15000)

  it('un commentaire après le domaine n’ajoute pas de texte au destinataire (GHSA-g57g-f23g-4646)', () => {
    const r = send(JSON.stringify('"user"@example.com(x)evil.com'))
    for (const a of r.to ?? []) expect(a).not.toMatch(/\s|evil\.com/)
  }, 15000)
})
