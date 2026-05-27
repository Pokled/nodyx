import type { PageServerLoad } from './$types'
import { apiFetch } from '$lib/api'

export const load: PageServerLoad = async ({ fetch, parent }) => {
	const { token } = await parent()
	const auth = { headers: { Authorization: `Bearer ${token}` } }

	// Loads in parallel: connected streamers, EventSub subs, recent events, hub health, setup checklist, stats 7j, twitch profile, scope du Control Panel, scopes engagement (polls + predictions).
	const [meRes, subsRes, eventsRes, healthRes, setupRes, statsRes, profileRes, controlRes, engagementRes, rewardsScopeRes] = await Promise.all([
		apiFetch(fetch, '/streamer/twitch/me',                auth),
		apiFetch(fetch, '/streamer/twitch/eventsub-status',   auth),
		apiFetch(fetch, '/streamer/events?limit=20',          auth),
		apiFetch(fetch, '/streamer/health',                   auth),
		apiFetch(fetch, '/streamer/setup-status',             auth),
		apiFetch(fetch, '/streamer/stats?days=7',             auth),
		apiFetch(fetch, '/streamer/twitch/profile',           auth),
		apiFetch(fetch, '/streamer/twitch/control-status',    auth),
		apiFetch(fetch, '/streamer/twitch/engagement-status', auth),
		apiFetch(fetch, '/streamer/twitch/rewards/scope-status', auth),
	])

	const me      = meRes.ok      ? await meRes.json()      : { streamers: [] }
	const status  = subsRes.ok    ? await subsRes.json()    : { subscriptions: [], primaryStreamer: null }
	const events  = eventsRes.ok  ? await eventsRes.json()  : { events: [] }
	const health  = healthRes.ok  ? await healthRes.json()  : null
	const setup   = setupRes.ok   ? await setupRes.json()   : null
	const stats   = statsRes.ok   ? await statsRes.json()   : null
	const profile = profileRes.ok ? await profileRes.json() : null
	const control    = controlRes.ok    ? await controlRes.json()    : { hasScope: false }
	const engagement   = engagementRes.ok   ? await engagementRes.json()   : { hasPolls: false, hasPredictions: false }
	const rewardsScope = rewardsScopeRes.ok ? await rewardsScopeRes.json() : { hasScope: false }

	return {
		streamers:           me.streamers ?? [],
		primaryStreamer:     status.primaryStreamer ?? null,
		subscriptions:       status.subscriptions ?? [],
		recentEvents:        events.events ?? [],
		health,
		setup,
		stats,
		profile,
		controlHasScope:     control.hasScope === true,
		engagementHasPolls:       engagement.hasPolls === true,
		engagementHasPredictions: engagement.hasPredictions === true,
		rewardsHasScope:          rewardsScope.hasScope === true,
	}
}
