import { env } from '$env/dynamic/public';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ fetch }) => {
  const apiUrl = env.PUBLIC_API_URL ?? 'http://localhost:3000';
  try {
    const res = await fetch(`${apiUrl}/api/directory`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return { instances: data.instances ?? [] };
  } catch (err) {
    console.error('[communities] Failed to load directory:', err);
    return { instances: [] };
  }
};
