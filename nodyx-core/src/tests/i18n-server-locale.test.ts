// ─── i18n backend : résolution de langue + emails/push traduits ────────────────
//
// Contrairement à une erreur API (retraduisible côté frontend à tout moment), un
// email ou un push partent définitivement dans la langue choisie ici. Ce test
// prouve : (1) l'ordre de repli exact (user > instance > français), et (2) que
// les emails générés portent VRAIMENT le bon texte selon la locale — pas juste
// que la fonction ne plante pas.
// cf feedback_test_first_critical (module critique = nodyx-core = SANCTUAIRE).

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resolveServerLocale } from '../i18n/serverStrings'

describe('resolveServerLocale — ordre de repli', () => {
	it('locale utilisateur connue et supportée -> prioritaire', () => {
		expect(resolveServerLocale('en', 'fr')).toBe('en')
	})

	it('pas de locale utilisateur -> retombe sur la langue de l\'instance', () => {
		expect(resolveServerLocale(null, 'en')).toBe('en')
		expect(resolveServerLocale(undefined, 'en')).toBe('en')
	})

	it('ni user ni instance supportés -> français par défaut (comportement historique)', () => {
		expect(resolveServerLocale(null, null)).toBe('fr')
		expect(resolveServerLocale('de', 'es')).toBe('fr') // aucune des deux traduite côté core
	})

	it('normalise les tags longs (fr-FR, en-US) sur leur langue primaire', () => {
		expect(resolveServerLocale('fr-FR', null)).toBe('fr')
		expect(resolveServerLocale('en-US,en;q=0.9', null)).toBe('en') // en-tête Accept-Language brut
	})

	it('une locale utilisateur non supportée retombe sur l\'instance, pas sur fr directement', () => {
		expect(resolveServerLocale('de', 'en')).toBe('en')
	})
})

// ── Emails : le texte généré correspond VRAIMENT à la locale demandée ──────────

const { sendMailMock } = vi.hoisted(() => ({ sendMailMock: vi.fn().mockResolvedValue(undefined) }))

vi.mock('nodemailer', () => ({
	default: { createTransport: () => ({ sendMail: sendMailMock }) },
}))

describe('emailService — le contenu généré suit la locale demandée', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		process.env.SMTP_HOST = 'smtp.test'
		process.env.SMTP_USER = 'test'
		process.env.SMTP_PASS = 'test'
		process.env.NODYX_COMMUNITY_NAME = 'TestCommunity'
	})

	it('sendVerificationEmail(locale: "en") produit un sujet et un corps en anglais', async () => {
		const { sendVerificationEmail } = await import('../services/emailService')
		await sendVerificationEmail({ to: 'a@b.com', username: 'Bob', verifyUrl: 'https://x/y', locale: 'en' })

		expect(sendMailMock).toHaveBeenCalledTimes(1)
		const call = sendMailMock.mock.calls[0][0]
		expect(call.subject).toBe('Confirm your email address — TestCommunity')
		expect(call.text).toContain('Hi Bob,')
		expect(call.html).toContain('lang="en"')
		expect(call.html).toContain('Activate my account')
	})

	it('sendVerificationEmail sans locale -> français (défaut historique, zéro régression)', async () => {
		const { sendVerificationEmail } = await import('../services/emailService')
		await sendVerificationEmail({ to: 'a@b.com', username: 'Bob', verifyUrl: 'https://x/y' })

		const call = sendMailMock.mock.calls[0][0]
		expect(call.subject).toBe('Confirmez votre adresse email — TestCommunity')
		expect(call.html).toContain('lang="fr"')
	})

	it('sendPasswordResetEmail(locale: "en") produit un sujet et un corps en anglais', async () => {
		const { sendPasswordResetEmail } = await import('../services/emailService')
		await sendPasswordResetEmail({ to: 'a@b.com', username: 'Bob', resetUrl: 'https://x/y', locale: 'en' })

		const call = sendMailMock.mock.calls[0][0]
		expect(call.subject).toBe('Reset your password — TestCommunity')
		expect(call.text).toContain('You requested a password reset')
		expect(call.html).toContain('Reset my password')
	})

	it('sendPasswordResetEmail(locale: "fr") produit un sujet et un corps en français', async () => {
		const { sendPasswordResetEmail } = await import('../services/emailService')
		await sendPasswordResetEmail({ to: 'a@b.com', username: 'Bob', resetUrl: 'https://x/y', locale: 'fr' })

		const call = sendMailMock.mock.calls[0][0]
		expect(call.subject).toBe('Réinitialisation de votre mot de passe — TestCommunity')
		expect(call.html).toContain('Réinitialiser mon mot de passe')
	})
})
