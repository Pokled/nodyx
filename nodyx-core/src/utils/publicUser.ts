// Strict whitelists for what we expose to API responses.
//
// Two views over a User row:
//   - toPublicUser(): everything visible to any HTTP client (no auth or other user)
//   - toSelfUser():   everything visible to the user themselves (still no PII)
//
// Email, email_verified, registration_ip, password and any field added later
// stay backend-only by default. Anything that needs to be added to either view
// has to be added explicitly to one of the lists below.

const PUBLIC_FIELDS = [
	'id',
	'username',
	'avatar',
	'bio',
	'points',
	'created_at',
] as const

const SELF_EXTRA_FIELDS = [
	'linked_instances',
	'updated_at',
] as const

export type PublicUserView = Partial<Record<(typeof PUBLIC_FIELDS)[number], unknown>>
export type SelfUserView   = PublicUserView & Partial<Record<(typeof SELF_EXTRA_FIELDS)[number], unknown>>

export function toPublicUser(u: any): PublicUserView {
	const out: Record<string, unknown> = {}
	if (!u) return out
	for (const k of PUBLIC_FIELDS) {
		if (u[k] !== undefined) out[k] = u[k]
	}
	return out as PublicUserView
}

export function toSelfUser(u: any): SelfUserView {
	const out: Record<string, unknown> = toPublicUser(u) as Record<string, unknown>
	if (!u) return out as SelfUserView
	for (const k of SELF_EXTRA_FIELDS) {
		if (u[k] !== undefined) out[k] = u[k]
	}
	return out as SelfUserView
}
