import { redirect, fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { apiFetch } from '$lib/api';

export const load: PageServerLoad = async ({ cookies }) => {
	const token = cookies.get('token');
	if (!token) redirect(303, '/auth/login?redirectTo=/calendar/new');
	return { token };
};

export const actions: Actions = {
	default: async ({ fetch, request, cookies }) => {
		const token = cookies.get('token');
		if (!token) redirect(303, '/auth/login');

		const form = await request.formData();

		const title        = (form.get('title')       as string).trim();
		const description  = (form.get('description') as string | null) ?? '';
		const location     = (form.get('location')    as string | null)?.trim() || null;
		const starts_at    = form.get('starts_at')    as string;
		const ends_at      = (form.get('ends_at')     as string | null) || null;
		const is_all_day   = form.get('is_all_day')   === 'true';
		const is_public    = form.get('is_public')    !== 'false';
		const rsvp_enabled = form.get('rsvp_enabled') === 'true';
		const max_att      = form.get('max_attendees') as string | null;
		const tagsRaw      = (form.get('tags') as string | null) ?? '';
		const tags         = tagsRaw.split(',').map(t => t.trim()).filter(Boolean).slice(0, 10);
		const cover_url    = (form.get('cover_url') as string | null)?.trim() || null;

		if (!title || !starts_at) {
			return fail(400, { error: 'Le titre et la date de début sont obligatoires.' });
		}

		const res = await apiFetch(fetch, '/events', {
			method: 'POST',
			headers: { Authorization: `Bearer ${token}` },
			body: JSON.stringify({
				title, description, location,
				starts_at, ends_at,
				is_all_day, is_public, rsvp_enabled,
				max_attendees: max_att ? parseInt(max_att, 10) : null,
				tags, cover_url,
			}),
		});

		const json = await res.json();
		if (!res.ok) return fail(res.status, { error: json.error });

		redirect(303, `/calendar/${json.event.id}`);
	},
};
