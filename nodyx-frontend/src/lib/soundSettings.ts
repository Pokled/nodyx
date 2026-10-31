import { writable } from 'svelte/store'
import { browser } from '$app/env'

export interface SoundSettings {
	enabled: boolean
	volume:  number   // 0–1
	message: boolean
	mention: boolean
	dm:      boolean
}

const DEFAULTS: SoundSettings = {
	enabled: true,
	volume:  0.5,
	message: true,
	mention: true,
	dm:      true,
}

function load(): SoundSettings {
	if (!browser) return { ...DEFAULTS }
	try {
		const raw = localStorage.getItem('nodyx:sounds')
		return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS }
	} catch { return { ...DEFAULTS } }
}

export const soundSettings = writable<SoundSettings>(load())

// Persistance automatique
soundSettings.subscribe(v => {
	if (!browser) return
	try { localStorage.setItem('nodyx:sounds', JSON.stringify(v)) } catch { /* ignore */ }
})
