import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
  const parentData = await parent();
  // Utilise les instances déjà chargées par le layout (évite un fetch externe redondant)
  return { instances: (parentData as any).directoryInstances ?? [] };
};
