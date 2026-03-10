/**
 * hub.ts — Nexus Authenticator
 *
 * Communication avec l'API Hub pour :
 * - Enregistrement d'un appareil (clé publique)
 * - Réponse à un challenge (signature)
 * - Polling des challenges en attente (fallback si push non disponible)
 */

import type { ExportedPublicKey, SignedChallenge } from './crypto'
import type { PendingChallenge } from './storage'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RegisterDevicePayload {
	deviceId: string
	deviceLabel: string
	publicKey: ExportedPublicKey
	enrollmentToken: string
}

export interface RegisterDeviceResponse {
	success: boolean
	deviceToken: string
	message?: string
}

export interface PollChallengesResponse {
	challenges: PendingChallenge[]
}

export interface ApproveResponse {
	success: boolean
	message?: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hubApiUrl(hubUrl: string, path: string): string {
	const base = hubUrl.replace(/\/$/, '')
	return `${base}/api/auth${path}`
}

async function hubFetch<T>(url: string, init?: RequestInit): Promise<T> {
	const res = await fetch(url, {
		...init,
		headers: {
			'Content-Type': 'application/json',
			...(init?.headers ?? {})
		}
	})

	if (!res.ok) {
		const text = await res.text().catch(() => res.statusText)
		throw new Error(`Hub error ${res.status}: ${text}`)
	}

	return res.json() as Promise<T>
}

// ─── API ──────────────────────────────────────────────────────────────────────

/**
 * Enregistre cet appareil auprès d'un Hub.
 * À appeler une seule fois lors du setup.
 */
export async function registerDevice(
	hubUrl: string,
	payload: RegisterDevicePayload
): Promise<RegisterDeviceResponse> {
	return hubFetch<RegisterDeviceResponse>(hubApiUrl(hubUrl, '/devices/register'), {
		method: 'POST',
		body: JSON.stringify(payload)
	})
}

/**
 * Envoie la signature d'un challenge au Hub.
 * Appelé depuis l'écran d'approbation.
 */
export async function approveChallenge(
	hubUrl: string,
	deviceToken: string,
	signed: SignedChallenge
): Promise<ApproveResponse> {
	return hubFetch<ApproveResponse>(hubApiUrl(hubUrl, '/challenges/approve'), {
		method: 'POST',
		headers: { Authorization: `Bearer ${deviceToken}` },
		body: JSON.stringify(signed)
	})
}

/**
 * Refuse un challenge (l'utilisateur a appuyé sur "Refuser").
 */
export async function rejectChallenge(
	hubUrl: string,
	deviceToken: string,
	challengeId: string
): Promise<void> {
	await hubFetch<void>(hubApiUrl(hubUrl, '/challenges/reject'), {
		method: 'POST',
		headers: { Authorization: `Bearer ${deviceToken}` },
		body: JSON.stringify({ challengeId })
	})
}

/**
 * Polling — récupère les challenges en attente pour cet appareil.
 * Utilisé quand les push notifications ne sont pas disponibles.
 */
export async function pollChallenges(
	hubUrl: string,
	deviceToken: string
): Promise<PendingChallenge[]> {
	const res = await hubFetch<PollChallengesResponse>(
		hubApiUrl(hubUrl, '/challenges/pending'),
		{
			headers: { Authorization: `Bearer ${deviceToken}` }
		}
	)
	return res.challenges
}

/**
 * Révoque cet appareil sur le Hub (clé publique supprimée).
 * Appelé depuis la gestion des clés.
 */
export async function revokeDevice(
	hubUrl: string,
	deviceToken: string,
	deviceId: string
): Promise<void> {
	await hubFetch<void>(hubApiUrl(hubUrl, `/devices/${deviceId}`), {
		method: 'DELETE',
		headers: { Authorization: `Bearer ${deviceToken}` }
	})
}

/**
 * Vérifie que l'URL de Hub est accessible et retourne ses infos.
 */
export async function pingHub(hubUrl: string): Promise<{ name: string; version: string; authenticator?: boolean }> {
	const base = hubUrl.replace(/\/$/, '')
	return hubFetch<{ name: string; version: string; authenticator?: boolean }>(`${base}/api/auth/info`)
}
