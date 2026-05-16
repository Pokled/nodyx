import type { PageServerLoad, Actions } from './$types';
import { apiFetch } from '$lib/api';
import { fail } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ fetch, cookies }) => {
	const token = cookies.get('token');
	const res = await apiFetch(fetch, '/admin/channels', {
		headers: { Authorization: `Bearer ${token}` },
	});
	const all = res.ok ? (await res.json()).channels ?? [] : [];
	const channels = all.filter((c: any) => c.type === 'text' || !c.type);
	return { channels };
};

function pickStyling(form: FormData) {
	const colorRaw = String(form.get('name_color') ?? '').trim();
	const iconRaw  = String(form.get('icon_emoji') ?? '').trim();
	const out: Record<string, unknown> = {
		name_bold:      form.get('name_bold')      === '1',
		name_italic:    form.get('name_italic')    === '1',
		name_underline: form.get('name_underline') === '1',
	};
	out.name_color = /^#[0-9A-Fa-f]{6}$/.test(colorRaw) ? colorRaw : null;
	out.icon_emoji = iconRaw === '' ? null : iconRaw.slice(0, 64);
	return out;
}

export const actions: Actions = {
	create: async ({ request, fetch, cookies }) => {
		const token = cookies.get('token');
		const form  = await request.formData();
		const name        = String(form.get('name') ?? '').trim();
		const description = String(form.get('description') ?? '').trim();

		if (!name) return fail(400, { error: 'Le nom est requis' });

		const res = await apiFetch(fetch, '/admin/channels', {
			method: 'POST',
			headers: { Authorization: `Bearer ${token}` },
			body: JSON.stringify({
				name,
				description: description || undefined,
				...pickStyling(form),
			}),
		});

		if (!res.ok) {
			const json = await res.json().catch(() => ({}));
			return fail(res.status, { error: json.error ?? 'Erreur lors de la création' });
		}
		return { ok: true };
	},

	update: async ({ request, fetch, cookies }) => {
		const token = cookies.get('token');
		const form  = await request.formData();
		const id    = String(form.get('id') ?? '');
		if (!id) return fail(400, { error: 'ID manquant' });

		const name        = String(form.get('name') ?? '').trim();
		const description = String(form.get('description') ?? '').trim();

		const res = await apiFetch(fetch, `/admin/channels/${id}`, {
			method: 'PUT',
			headers: { Authorization: `Bearer ${token}` },
			body: JSON.stringify({
				...(name ? { name } : {}),
				description: description || null,
				...pickStyling(form),
			}),
		});

		if (!res.ok) {
			const json = await res.json().catch(() => ({}));
			return fail(res.status, { error: json.error ?? 'Erreur lors de la mise à jour' });
		}
		return { ok: true };
	},

	delete: async ({ request, fetch, cookies }) => {
		const token = cookies.get('token');
		const form  = await request.formData();
		const id    = String(form.get('id') ?? '');
		if (!id) return fail(400, { error: 'ID manquant' });

		const res = await apiFetch(fetch, `/admin/channels/${id}`, {
			method: 'DELETE',
			headers: { Authorization: `Bearer ${token}` },
		});

		if (!res.ok) return fail(res.status, { error: 'Erreur lors de la suppression' });
		return { ok: true };
	},

	reorder: async ({ request, fetch, cookies }) => {
		const token = cookies.get('token');
		const form  = await request.formData();
		const idsRaw = String(form.get('ids') ?? '');
		let ids: string[] = [];
		try { ids = JSON.parse(idsRaw); } catch { return fail(400, { error: 'JSON invalide' }); }

		const res = await apiFetch(fetch, '/admin/channels/reorder', {
			method: 'PUT',
			headers: { Authorization: `Bearer ${token}` },
			body: JSON.stringify({ ids }),
		});

		if (!res.ok) return fail(res.status, { error: 'Erreur lors du réordonnancement' });
		return { ok: true };
	},
};
