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
		// Normalise "YYYY-MM-DDTHH:mm" (datetime-local) ou "YYYY-MM-DD" (date) → ISO 8601 complet
		const toISO = (v: string | null) => {
			if (!v) return null;
			if (v.includes('T') && !v.endsWith('Z')) return new Date(v).toISOString();
			if (!v.includes('T')) return new Date(v + 'T00:00:00').toISOString();
			return v;
		};
		const starts_at = toISO(form.get('starts_at') as string) as string;
		const ends_at   = toISO(form.get('ends_at')   as string | null);
		const is_all_day   = form.get('is_all_day')   === 'true';
		const is_public    = form.get('is_public')    !== 'false';
		const rsvp_enabled = form.get('rsvp_enabled') === 'true';
		const cover_url    = (form.get('cover_url')   as string | null)?.trim() || null;

		const tagsRaw = (form.get('tags') as string | null) ?? '';
		const tags    = tagsRaw.split(',').map(t => t.trim()).filter(Boolean).slice(0, 10);

		// Géolocalisation
		const latRaw = form.get('location_lat') as string | null;
		const lngRaw = form.get('location_lng') as string | null;
		const location_lat = latRaw && latRaw.trim() ? parseFloat(latRaw) : null;
		const location_lng = lngRaw && lngRaw.trim() ? parseFloat(lngRaw) : null;

		// Billetterie
		const priceRaw    = form.get('ticket_price')    as string | null;
		const ticket_price    = priceRaw && priceRaw.trim() ? parseFloat(priceRaw) : null;
		const ticket_currency = (form.get('ticket_currency') as string | null) || 'EUR';
		const ticket_url      = (form.get('ticket_url') as string | null)?.trim() || null;

		// Capacité
		const maxAtt = form.get('max_attendees') as string | null;
		const max_attendees = maxAtt && maxAtt.trim() ? parseInt(maxAtt, 10) : null;

		if (!title || !starts_at) {
			return fail(400, { error: 'Le titre et la date de début sont obligatoires.' });
		}

		const res = await apiFetch(fetch, '/events', {
			method: 'POST',
			headers: { Authorization: `Bearer ${token}` },
			body: JSON.stringify({
				title, description, location,
				location_lat, location_lng,
				starts_at, ends_at,
				is_all_day, is_public, rsvp_enabled,
				max_attendees, tags, cover_url,
				ticket_price, ticket_currency, ticket_url,
			}),
		});

		const json = await res.json();
		if (!res.ok) {
			if (json.code === 'COVER_URL_INVALID') return fail(res.status, { errorKey: 'event.cover_invalid' });
			return fail(res.status, { error: json.error });
		}

		redirect(303, `/calendar/${json.event.id}`);
	},
};
