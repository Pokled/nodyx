import { describe, it, expect } from 'vitest'
import { levelOf, intendedOf, patchForLevel, categoryOf, sanctionOf } from './rules'

describe('les crans, traduits vers et depuis le moteur', () => {
	it('lit le cran d\'une règle', () => {
		expect(levelOf({ action: 'delete', dry_run: true })).toBe('observe')
		expect(levelOf({ action: 'report_only', dry_run: false })).toBe('report')
		expect(levelOf({ action: 'notify_only', dry_run: false })).toBe('report')
		expect(levelOf({ action: 'warn', dry_run: false })).toBe('warn')
		expect(levelOf({ action: 'mute', dry_run: false })).toBe('delete')
		expect(intendedOf({ action: 'ban_temp' })).toBe('delete')
	})

	it('observer garde l\'action prévue : on sait ce que la règle aurait fait', () => {
		expect(patchForLevel({ action: 'warn' }, 'observe')).toEqual({ dry_run: true })
	})

	it('écrit l\'action du cran choisi', () => {
		expect(patchForLevel({ action: 'delete' }, 'report')).toEqual({ dry_run: false, action: 'report_only' })
		expect(patchForLevel({ action: 'report_only' }, 'warn')).toEqual({ dry_run: false, action: 'warn' })
		expect(patchForLevel({ action: 'warn' }, 'delete')).toEqual({ dry_run: false, action: 'delete' })
	})

	it('une règle qui sanctionne garde sa sanction au cran Supprimer', () => {
		expect(patchForLevel({ action: 'mute' }, 'delete')).toEqual({ dry_run: false })
		expect(sanctionOf({ action: 'mute' })).toBe('mute')
		expect(sanctionOf({ action: 'delete' })).toBeNull()
	})
})

describe('les catégories', () => {
	it('range chaque type, et les comptes neufs à part', () => {
		expect(categoryOf({ type: 'keywords' })).toBe('words')
		expect(categoryOf({ type: 'caps' })).toBe('words')
		expect(categoryOf({ type: 'flood' })).toBe('spam')
		expect(categoryOf({ type: 'link_spam', conditions: { account_max_age_days: 2 } })).toBe('newcomers')
		expect(categoryOf({ type: 'zalgo' })).toBe('content')
		expect(categoryOf({ type: 'regex' })).toBe('custom')
	})
})
