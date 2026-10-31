// ─── Streamer Notif Settings — préférences sonores par event type ─────────
// Persistées dans localStorage côté client (per-device). Le store est dispo
// même pour les non-admins, mais le listener global ne déclenchera de son
// que pour les owners/admins (Socket.IO joint la room sur emit, le serveur
// gate par rôle).

import { writable } from 'svelte/store'
import { browser } from '$app/env'
import type { PresetKey } from './presetSounds'

export type StreamerEventKey =
	| 'channel.follow'
	| 'channel.subscribe'
	| 'channel.subscription.gift'
	| 'channel.cheer'
	| 'channel.raid'

export interface PerEvent {
	enabled: boolean
	preset:  PresetKey       // 'none' = silence sur cet event
}

export interface StreamerNotifSettings {
	masterEnabled: boolean
	volume:        number    // 0..1
	events:        Record<StreamerEventKey, PerEvent>
}

const DEFAULTS: StreamerNotifSettings = {
	masterEnabled: true,
	volume:        0.7,
	events: {
		'channel.follow':            { enabled: true, preset: 'pop'     },
		'channel.subscribe':         { enabled: true, preset: 'fanfare' },
		'channel.subscription.gift': { enabled: true, preset: 'fanfare' },
		'channel.cheer':             { enabled: true, preset: 'ding'    },
		'channel.raid':              { enabled: true, preset: 'bell'    },
	},
}

const STORAGE_KEY = 'nodyx:streamer-notifs'

function load(): StreamerNotifSettings {
	if (!browser) return clone(DEFAULTS)
	try {
		const raw = localStorage.getItem(STORAGE_KEY)
		if (!raw) return clone(DEFAULTS)
		const parsed = JSON.parse(raw) as Partial<StreamerNotifSettings>
		const events = { ...DEFAULTS.events }
		const inEvts = (parsed.events ?? {}) as Partial<Record<StreamerEventKey, Partial<PerEvent>>>
		for (const k of Object.keys(events) as StreamerEventKey[]) {
			const v = inEvts[k]
			if (v && typeof v === 'object') {
				events[k] = {
					enabled: typeof v.enabled === 'boolean' ? v.enabled : events[k].enabled,
					preset:  typeof v.preset  === 'string'  ? v.preset as PresetKey : events[k].preset,
				}
			}
		}
		return {
			masterEnabled: typeof parsed.masterEnabled === 'boolean' ? parsed.masterEnabled : DEFAULTS.masterEnabled,
			volume:        typeof parsed.volume === 'number' && parsed.volume >= 0 && parsed.volume <= 1 ? parsed.volume : DEFAULTS.volume,
			events,
		}
	} catch {
		return clone(DEFAULTS)
	}
}

function clone(v: StreamerNotifSettings): StreamerNotifSettings {
	return JSON.parse(JSON.stringify(v)) as StreamerNotifSettings
}

export const streamerNotifSettings = writable<StreamerNotifSettings>(load())

streamerNotifSettings.subscribe(v => {
	if (!browser) return
	try { localStorage.setItem(STORAGE_KEY, JSON.stringify(v)) } catch { /* ignore */ }
})

// ── Public API ─────────────────────────────────────────────────────────────

import { get } from 'svelte/store'
import { playPreset, type PresetKey as _Preset } from './presetSounds'

/**
 * Joue le son configuré pour cet event type. No-op si :
 *   - master disabled
 *   - per-event disabled
 *   - preset = 'none'
 */
export function playStreamerNotif(eventType: string): void {
	const s = get(streamerNotifSettings)
	if (!s.masterEnabled) return
	const cfg = s.events[eventType as StreamerEventKey]
	if (!cfg || !cfg.enabled || cfg.preset === 'none') return
	playPreset(cfg.preset, s.volume)
}

/** Bouton "Tester" : ignore les toggles et joue le preset associé. */
export function testStreamerNotif(eventType: StreamerEventKey): void {
	const s = get(streamerNotifSettings)
	const cfg = s.events[eventType]
	if (!cfg || cfg.preset === 'none') return
	playPreset(cfg.preset, s.volume)
}
