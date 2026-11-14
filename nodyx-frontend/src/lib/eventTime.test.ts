// L'heure d'un événement (audit du 14/11/2026, B1-B3) : prouvé à Paris et à New York,
// en heure d'hiver et d'été. Avant, le SERVEUR (UTC) convertissait « 20:00 » tapé en France.
import { describe, it, expect, afterEach } from 'vitest'
import { inputValue, isoFromInput, defaultLocal, isoFromForm, eventErrorKey } from './eventTime'

const TZ0 = process.env.TZ
const inZone = (tz: string) => { process.env.TZ = tz }
afterEach(() => { process.env.TZ = TZ0 })

describe('ce que le membre tape devient le bon instant', () => {
	it('Paris, hiver : 20:00 tapé = 19:00 UTC', () => { inZone('Europe/Paris'); expect(isoFromInput('2026-11-20T20:00', false)).toBe('2026-11-20T19:00:00.000Z') })
	it('Paris, été : 20:00 tapé = 18:00 UTC', () => { inZone('Europe/Paris'); expect(isoFromInput('2026-07-20T20:00', false)).toBe('2026-07-20T18:00:00.000Z') })
	it('New York : 20:00 tapé = 01:00 UTC le lendemain', () => { inZone('America/New_York'); expect(isoFromInput('2026-11-20T20:00', false)).toBe('2026-11-21T01:00:00.000Z') })
	it('toute la journée : une date de calendrier, la même partout', () => {
		inZone('Pacific/Auckland'); expect(isoFromInput('2026-11-20', true)).toBe('2026-11-20T00:00:00.000Z')
		inZone('America/Los_Angeles'); expect(isoFromInput('2026-11-20', true)).toBe('2026-11-20T00:00:00.000Z')
	})
	it('vide ou illisible : rien', () => { expect(isoFromInput('', false)).toBeNull(); expect(isoFromInput('demain', false)).toBeNull() })
})

describe('le formulaire montre l’heure du membre', () => {
	it('InCyber (09:00 UTC, mars) : le formulaire dit 11:00 à Paris, comme la page', () => { inZone('Europe/Paris'); expect(inputValue('2026-03-31T09:00:00Z', false)).toBe('2026-03-31T11:00') })
	it('aller-retour : modifier sans rien toucher ne décale plus rien', () => {
		inZone('Europe/Paris')
		const stored = '2026-11-20T19:00:00.000Z'
		expect(isoFromInput(inputValue(stored, false), false)).toBe(stored)
	})
	it('journée entière : la date enregistrée, sans décalage', () => { inZone('America/New_York'); expect(inputValue('2026-11-20T00:00:00.000Z', true)).toBe('2026-11-20') })
	it('par défaut : demain 18:00 à l’heure du membre (pas 17:00)', () => { inZone('Europe/Paris'); expect(defaultLocal(18).endsWith('T18:00')).toBe(true) })
})

describe('le serveur prend l’instant du navigateur', () => {
	it('starts_at_iso l’emporte sur la valeur brute', () => {
		const f = new FormData(); f.set('starts_at', '2026-11-20T20:00'); f.set('starts_at_iso', '2026-11-20T19:00:00.000Z')
		inZone('UTC'); expect(isoFromForm(f, 'starts_at')).toBe('2026-11-20T19:00:00.000Z')
	})
	it('sans JavaScript : repli (ancien comportement), date entière à minuit UTC', () => {
		const f = new FormData(); f.set('ends_at', '2026-11-20')
		expect(isoFromForm(f, 'ends_at')).toBe('2026-11-20T00:00:00.000Z')
		expect(isoFromForm(new FormData(), 'ends_at')).toBeNull()
	})
	it('un _iso illisible est ignoré', () => {
		const f = new FormData(); f.set('starts_at', '2026-11-20T20:00'); f.set('starts_at_iso', 'n’importe quoi')
		inZone('UTC'); expect(isoFromForm(f, 'starts_at')).toBe('2026-11-20T20:00:00.000Z')
	})
})

describe('les refus du cœur deviennent une phrase', () => {
	it('fin avant début, lien, coordonnées, droits, couverture', () => {
		expect(eventErrorKey({ code: 'VALIDATION_ERROR', error: 'ends_at: EVENT_ENDS_BEFORE_START' })).toBe('event.err_ends_before')
		expect(eventErrorKey({ code: 'EVENT_ENDS_BEFORE_START' })).toBe('event.err_ends_before')
		expect(eventErrorKey({ code: 'VALIDATION_ERROR', error: 'ticket_url: TICKET_URL_INVALID' })).toBe('event.err_ticket_url')
		expect(eventErrorKey({ code: 'VALIDATION_ERROR', error: 'location_lat: Too big' })).toBe('event.err_coords')
		expect(eventErrorKey({ code: 'EVENT_FORBIDDEN' })).toBe('event.err_forbidden')
		expect(eventErrorKey({ code: 'COVER_URL_INVALID' })).toBe('event.cover_invalid')
		expect(eventErrorKey({ code: 'X', error: 'autre' })).toBeNull()
	})
})
