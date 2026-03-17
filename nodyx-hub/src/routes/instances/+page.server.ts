import type { PageServerLoad, Actions } from './$types';
import { getAllInstances } from '$lib/server/pg.js';
import { blockInstance, unblockInstance } from '$lib/server/pg.js';
import { fail } from '@sveltejs/kit';

export const load: PageServerLoad = async () => {
  const instances = await getAllInstances();
  return { instances };
};

export const actions: Actions = {
  block: async ({ request }) => {
    const form   = await request.formData();
    const id     = Number(form.get('id'));
    const reason = String(form.get('reason') ?? '').trim();
    if (!id) return fail(400, { error: 'ID manquant' });
    if (!reason) return fail(400, { error: 'Raison requise' });
    await blockInstance(id, reason);
    return { success: true, action: 'block' };
  },
  unblock: async ({ request }) => {
    const form = await request.formData();
    const id   = Number(form.get('id'));
    if (!id) return fail(400, { error: 'ID manquant' });
    await unblockInstance(id);
    return { success: true, action: 'unblock' };
  }
};
