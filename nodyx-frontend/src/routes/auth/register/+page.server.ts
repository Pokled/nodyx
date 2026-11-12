import { fail, redirect } from '@sveltejs/kit';
import type { Actions } from './$types';
import { apiFetch } from '$lib/api';

export const actions: Actions = {
	default: async ({ fetch, request, cookies }) => {
		const form = await request.formData();
		const username       = form.get('username')         as string;
		const email          = form.get('email')            as string;
		const password       = form.get('password')         as string;
		const confirmPassword = form.get('confirm_password') as string;
		// Anti-bot : on forward les 2 champs anti-bot vers le backend.
		const website  = (form.get('website') as string | null) ?? '';
		const formTRaw = form.get('form_t')   as string | null;
		const formT    = formTRaw ? Number(formTRaw) : undefined;

		if (password !== confirmPassword) {
			return fail(400, { error: 'Les mots de passe ne correspondent pas.' });
		}

		const res  = await apiFetch(fetch, '/auth/register', {
			method: 'POST',
			body: JSON.stringify({
				username, email, password,
				...(website ? { website } : {}),
				...(formT   ? { form_t: formT } : {}),
			})
		});
		const json = await res.json();

		if (!res.ok) {
			if (json.code === 'USERNAME_INVALID_CHARS') return fail(res.status, { errorKey: 'auth.register.username_chars' });
			return fail(res.status, { error: json.error });
		}

		// SMTP configuré : vérification email requise
		if (json.pending_verification) {
			redirect(303, `/auth/verify-pending?email=${encodeURIComponent(email)}`);
		}

		cookies.set('token', json.token, {
			path:     '/',
			httpOnly: true,
			sameSite: 'strict',
			maxAge:   60 * 60 * 24 * 7
		});

		redirect(303, '/');
	}
};
