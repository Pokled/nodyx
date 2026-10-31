/**
 * Nodyx Sound Engine — Web Audio API, zero assets
 * Tous les sons sont synthétisés en temps réel.
 */
import { browser } from '$app/env'
import { get } from 'svelte/store'
import { soundSettings } from './soundSettings'

let ctx: AudioContext | null = null

function getCtx(): AudioContext | null {
	if (!browser) return null
	if (!ctx) ctx = new AudioContext()
	if (ctx.state === 'suspended') ctx.resume()
	return ctx
}

function masterVolume(): number {
	const s = get(soundSettings)
	return s.enabled ? s.volume : 0
}

/** Nouveau message dans le channel actif — soft "pop" */
export function playMessage() {
	const s = get(soundSettings)
	if (!s.enabled || !s.message) return
	const c = getCtx(); if (!c) return
	const vol = masterVolume() * 0.18

	const osc  = c.createOscillator()
	const gain = c.createGain()
	osc.connect(gain); gain.connect(c.destination)
	osc.type = 'sine'
	osc.frequency.setValueAtTime(700, c.currentTime)
	osc.frequency.exponentialRampToValueAtTime(320, c.currentTime + 0.09)
	gain.gain.setValueAtTime(vol, c.currentTime)
	gain.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.12)
	osc.start(c.currentTime)
	osc.stop(c.currentTime + 0.14)
}

/** @mention — deux tons ascendants, plus présent */
export function playMention() {
	const s = get(soundSettings)
	if (!s.enabled || !s.mention) return
	const c = getCtx(); if (!c) return
	const vol = masterVolume() * 0.3

	function tone(freq: number, start: number, dur: number) {
		const osc  = c!.createOscillator()
		const gain = c!.createGain()
		osc.connect(gain); gain.connect(c!.destination)
		osc.type = 'sine'
		osc.frequency.setValueAtTime(freq, c!.currentTime + start)
		gain.gain.setValueAtTime(vol, c!.currentTime + start)
		gain.gain.exponentialRampToValueAtTime(0.0001, c!.currentTime + start + dur)
		osc.start(c!.currentTime + start)
		osc.stop(c!.currentTime + start + dur + 0.01)
	}

	tone(880, 0,    0.13)
	tone(1100, 0.12, 0.18)
}

/** Nouveau DM reçu — sweep chaud, signature unique */
export function playDm() {
	const s = get(soundSettings)
	if (!s.enabled || !s.dm) return
	const c = getCtx(); if (!c) return
	const vol = masterVolume() * 0.25

	// Ton principal — sweep montant
	const osc1  = c.createOscillator()
	const gain1 = c.createGain()
	osc1.connect(gain1); gain1.connect(c.destination)
	osc1.type = 'sine'
	osc1.frequency.setValueAtTime(380, c.currentTime)
	osc1.frequency.exponentialRampToValueAtTime(580, c.currentTime + 0.18)
	gain1.gain.setValueAtTime(vol, c.currentTime)
	gain1.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.28)
	osc1.start(c.currentTime)
	osc1.stop(c.currentTime + 0.30)

	// Harmonique douce
	const osc2  = c.createOscillator()
	const gain2 = c.createGain()
	osc2.connect(gain2); gain2.connect(c.destination)
	osc2.type = 'sine'
	osc2.frequency.setValueAtTime(760, c.currentTime + 0.08)
	osc2.frequency.exponentialRampToValueAtTime(1100, c.currentTime + 0.22)
	gain2.gain.setValueAtTime(vol * 0.4, c.currentTime + 0.08)
	gain2.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.28)
	osc2.start(c.currentTime + 0.08)
	osc2.stop(c.currentTime + 0.30)
}
