import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { verifyPassword, createSession } from '$lib/server/auth.js';

export const load: PageServerLoad = async ({ cookies, url }) => {
  // Already logged in
  const session = cookies.get('hub_session');
  if (session) redirect(303, url.searchParams.get('redirectTo') ?? '/');
  return { redirectTo: url.searchParams.get('redirectTo') ?? '/' };
};

export const actions: Actions = {
  default: async ({ request, cookies, getClientAddress }) => {
    const form = await request.formData();
    const password   = form.get('password')   as string;
    const redirectTo = form.get('redirectTo') as string ?? '/';

    // Rate limit: simple — just verify
    if (!password || !verifyPassword(password)) {
      await new Promise(r => setTimeout(r, 800)); // slow down brute force
      return fail(401, { error: 'Mot de passe incorrect.' });
    }

    const sessionId = createSession(getClientAddress());
    cookies.set('hub_session', sessionId, {
      path:     '/',
      httpOnly: true,
      sameSite: 'strict',
      secure:   process.env.NODE_ENV === 'production',
      maxAge:   Number(process.env.HUB_SESSION_HOURS ?? 8) * 3600,
    });

    redirect(303, redirectTo.startsWith('/') ? redirectTo : '/');
  }
};
