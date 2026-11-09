import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { apiFetch } from '$lib/api';

export const load: PageServerLoad = async ({ fetch, params, cookies }) => {
	const { token } = params;

	const res  = await apiFetch(fetch, `/auth/verify-email/${token}`);
	const json = await res.json().catch(() => ({}));

	// Le code seulement : la page le traduit (jamais la phrase du cœur)
	if (!res.ok) {
		return { code: json.code === 'TOKEN_EXPIRED' ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN' };
	}

	cookies.set('token', json.token, {
		path:     '/',
		httpOnly: true,
		sameSite: 'lax',
		secure:   true,
		maxAge:   60 * 60 * 24 * 7,
	});

	redirect(303, '/?verified=1');
};
