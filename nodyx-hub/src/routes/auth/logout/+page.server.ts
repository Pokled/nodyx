import { redirect } from '@sveltejs/kit';
import type { Actions } from './$types';
import { deleteSession } from '$lib/server/auth.js';

export const actions: Actions = {
  default: async ({ cookies }) => {
    const session = cookies.get('hub_session');
    if (session) deleteSession(session);
    cookies.delete('hub_session', { path: '/' });
    redirect(303, '/auth/login');
  }
};
