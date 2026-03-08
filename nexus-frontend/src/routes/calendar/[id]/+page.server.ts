import { error, fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { apiFetch } from '$lib/api';

export const load: PageServerLoad = async ({ fetch, params, cookies }) => {
	const token = cookies.get('token') ?? null;

	const res  = await apiFetch(fetch, `/events/${params.id}`, token ? { headers: { Authorization: `Bearer ${token}` } } : {});
	const json = await res.json();

	if (!res.ok) error(res.status, json.error ?? 'Événement introuvable');

	return { event: json.event, attendees: json.attendees ?? [], token };
};

export const actions: Actions = {

	// ── RSVP ──────────────────────────────────────────────────────────────────
	rsvp: async ({ fetch, request, params, cookies }) => {
		const token = cookies.get('token');
		if (!token) return fail(401, { error: 'Non connecté' });

		const form   = await request.formData();
		const status = form.get('status') as string;

		const res = await apiFetch(fetch, `/events/${params.id}/rsvp`, {
			method:  'POST',
			headers: { Authorization: `Bearer ${token}` },
			body:    JSON.stringify({ status }),
		});

		if (!res.ok) {
			const json = await res.json();
			return fail(res.status, { error: json.error });
		}
	},

	// ── Annuler RSVP ──────────────────────────────────────────────────────────
	cancelRsvp: async ({ fetch, params, cookies }) => {
		const token = cookies.get('token');
		if (!token) return fail(401, { error: 'Non connecté' });

		await apiFetch(fetch, `/events/${params.id}/rsvp`, {
			method:  'DELETE',
			headers: { Authorization: `Bearer ${token}` },
		});
	},

	// ── Annuler l'événement ───────────────────────────────────────────────────
	cancelEvent: async ({ fetch, params, cookies }) => {
		const token = cookies.get('token');
		if (!token) return fail(401, { error: 'Non connecté' });

		await apiFetch(fetch, `/events/${params.id}`, {
			method:  'PATCH',
			headers: { Authorization: `Bearer ${token}` },
			body:    JSON.stringify({ is_cancelled: true }),
		});
	},

	// ── Supprimer l'événement ─────────────────────────────────────────────────
	deleteEvent: async ({ fetch, params, cookies }) => {
		const token = cookies.get('token');
		if (!token) return fail(401, { error: 'Non connecté' });

		await apiFetch(fetch, `/events/${params.id}`, {
			method:  'DELETE',
			headers: { Authorization: `Bearer ${token}` },
		});

		// redirect via enhance côté client
	},
};
