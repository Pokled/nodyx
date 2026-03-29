import { fail, redirect } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { apiFetch } from '$lib/api';

export const load: PageServerLoad = async ({ url }) => {
	return {
		redirectTo:    url.searchParams.get('redirectTo') ?? '/',
		passwordReset: url.searchParams.get('reset') === '1',
		signetError:   url.searchParams.get('signet_error') ?? null,
	};
};

function setCookieAndRedirect(cookies: any, token: string, redirectTo: string | null) {
	cookies.set('token', token, {
		path:     '/',
		httpOnly: true,
		sameSite: 'lax',
		secure:   true,
		maxAge:   60 * 60 * 24 * 7
	})
	redirect(303, redirectTo && redirectTo.startsWith('/') && !redirectTo.startsWith('//') ? redirectTo : '/')
}

export const actions: Actions = {
	/** Pose le cookie httpOnly après approbation Nodyx Signet côté client */
	signet: async ({ request, cookies }) => {
		const form       = await request.formData()
		const token      = form.get('token')      as string | null
		const redirectTo = form.get('redirectTo') as string | null

		if (!token) return fail(400, { error: 'Token manquant', redirectTo })

		setCookieAndRedirect(cookies, token, redirectTo)
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
			return fail(res.status, { error: json.error, code: json.code ?? null, redirectTo });
		}

		// 2FA Signet — on délègue à l'app Signet (prioritaire)
		if (json.requires_signet) {
			return fail(200, {
				requires_signet: true,
				username:        json.username as string,
				redirectTo,
			})
		}

		// 2FA TOTP — fallback si pas d'appareil Signet
		if (json.requires_totp) {
			return fail(200, {
				requires_totp: true,
				totp_pending:  json.totp_pending as string,
				redirectTo,
			})
		}

		setCookieAndRedirect(cookies, json.token, redirectTo)
	},

	/** Validation du code TOTP (2ème étape du login) */
	totp: async ({ fetch, request, cookies }) => {
		const form         = await request.formData()
		const totp_pending = form.get('totp_pending') as string | null
		const code         = form.get('code')         as string | null
		const redirectTo   = form.get('redirectTo')   as string | null

		if (!totp_pending || !code) {
			return fail(400, { error: 'Données manquantes.', requires_totp: true, totp_pending, redirectTo })
		}

		const res  = await apiFetch(fetch, '/auth/totp/validate', {
			method: 'POST',
			body: JSON.stringify({ totp_pending, code })
		})
		const json = await res.json()

		if (!res.ok) {
			return fail(res.status, {
				error: json.error ?? 'Code incorrect.',
				requires_totp: true,
				totp_pending,
				redirectTo,
			})
		}

		setCookieAndRedirect(cookies, json.token, redirectTo)
	},
};
