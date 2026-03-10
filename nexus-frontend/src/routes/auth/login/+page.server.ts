import { fail, redirect } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { apiFetch } from '$lib/api';

export const load: PageServerLoad = async ({ url }) => {
	return {
		redirectTo:   url.searchParams.get('redirectTo') ?? '/',
		passwordReset: url.searchParams.get('reset') === '1',
	};
};

export const actions: Actions = {
	/** Pose le cookie httpOnly après approbation Nexus Signet côté client */
	signet: async ({ request, cookies }) => {
		const form       = await request.formData()
		const token      = form.get('token')      as string | null
		const redirectTo = form.get('redirectTo') as string | null

		if (!token) return fail(400, { error: 'Token manquant', redirectTo })

		cookies.set('token', token, {
			path:     '/',
			httpOnly: true,
			sameSite: 'lax',
			secure:   false,
			maxAge:   60 * 60 * 24 * 7
		})

		redirect(303, redirectTo && redirectTo.startsWith('/') ? redirectTo : '/')
	},

	login: async ({ fetch, request, cookies }) => {
		const form       = await request.formData();
		const email      = form.get('email')      as string;
		const password   = form.get('password')   as string;
		const redirectTo = form.get('redirectTo') as string | null;

		const res  = await apiFetch(fetch, '/auth/login', {
			method: 'POST',
			body: JSON.stringify({ email, password })
		});
		const json = await res.json();

		if (!res.ok) {
			return fail(res.status, { error: json.error, redirectTo });
		}

		cookies.set('token', json.token, {
			path:     '/',
			httpOnly: true,
			sameSite: 'lax',
			secure:   false,
			maxAge:   60 * 60 * 24 * 7
		});

		redirect(303, redirectTo && redirectTo.startsWith('/') ? redirectTo : '/');
	}
};
