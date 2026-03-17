import type { LayoutServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { validateSession } from '$lib/server/auth.js';

export const load: LayoutServerLoad = async ({ cookies, url }) => {
  if (url.pathname.startsWith('/auth')) return {};
  const session = cookies.get('hub_session');
  if (!validateSession(session ?? '')) {
    redirect(303, `/auth/login?redirectTo=${encodeURIComponent(url.pathname)}`);
  }
  return {};
};
