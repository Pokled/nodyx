import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { apiFetch } from '$lib/api';

export const load: PageServerLoad = async ({ fetch, cookies }) => {
	const token = cookies.get('token');
	if (!token) redirect(303, '/auth/login');

	const res  = await apiFetch(fetch, '/notifications', {
		headers: { Authorization: `Bearer ${token}` }
	});

	if (!res.ok) error(res.status, 'Erreur chargement notifications');

	const { notifications } = await res.json();
	return { notifications };
};

export const actions: Actions = {
	markRead: async ({ fetch, request, cookies }) => {
		const token = cookies.get('token');
		if (!token) redirect(303, '/auth/login');

		const form = await request.formData();
		const id   = form.get('id') as string;

		await apiFetch(fetch, `/notifications/${id}/read`, {
			method: 'PATCH',
			headers: { Authorization: `Bearer ${token}` }
		});
	},

	markAllRead: async ({ fetch, cookies }) => {
		const token = cookies.get('token');
		if (!token) redirect(303, '/auth/login');

		await apiFetch(fetch, '/notifications/read-all', {
			method: 'PATCH',
			headers: { Authorization: `Bearer ${token}` }
		});
	},

	clearRead: async ({ fetch, cookies }) => {
		const token = cookies.get('token');
		if (!token) redirect(303, '/auth/login');

		await apiFetch(fetch, '/notifications/read', {
			method: 'DELETE',
			headers: { Authorization: `Bearer ${token}` }
		});
	},
};
