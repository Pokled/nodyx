import type { PageServerLoad, Actions } from './$types';
import { getAllInstances, archiveInactiveInstances, unarchiveInstance } from '$lib/server/pg.js';
import { blockInstance, unblockInstance } from '$lib/server/pg.js';
import { fail } from '@sveltejs/kit';

export const load: PageServerLoad = async () => {
  // On charge tout (archivées incluses) — la page split en 2 sections
  // (actives + archivées dépliable) pour permettre l'unarchive.
  const instances = await getAllInstances({ includeArchived: true });
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
  },

  // Archive en masse les instances inactives depuis > N jours (défaut 30).
  // Garde la row en DB (historique), mais exclue de la carte et placée en
  // section 'Archivées' dans /instances. Reverse possible via 'unarchive'.
  archiveInactive: async ({ request }) => {
    const form = await request.formData();
    const days = Number(form.get('days')) || 30;
    if (days < 7) return fail(400, { error: 'Le seuil doit être >= 7 jours (sécurité)' });
    const result = await archiveInactiveInstances(days);
    return { success: true, action: 'archive_inactive', count: result.count, archived: result.archived };
  },

  unarchive: async ({ request }) => {
    const form = await request.formData();
    const id   = Number(form.get('id'));
    if (!id) return fail(400, { error: 'ID manquant' });
    await unarchiveInstance(id);
    return { success: true, action: 'unarchive' };
  },
};
