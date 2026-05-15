import type { PageServerLoad } from './$types';
import { getAllInstances, getStats } from '$lib/server/pg.js';
import { getSystemMetrics } from '$lib/server/metrics.js';
import { lookupIp, countryCenter } from '$lib/server/geo.js';
import { getPool } from '$lib/server/pg.js';

// Jitter déterministe basé sur le slug : 2 instances avec le même centroid
// pays (ex: 'iris' et 'french-godot' tous deux en FR) seront décalées
// d'environ 50-150 km autour du centre. Reproductible (même slug → même
// décalage à chaque load). On évite que tous les markers FR se superposent
// au point (46.228, 2.214) sans rien voir.
function slugJitter(slug: string): { dlat: number; dlng: number } {
  let h1 = 5381, h2 = 7919;
  for (let i = 0; i < slug.length; i++) {
    const c = slug.charCodeAt(i);
    h1 = ((h1 << 5) - h1 + c) | 0;
    h2 = ((h2 << 7) - h2 + c * 31) | 0;
  }
  // h1, h2 ∈ Z (32-bit signé) → normalise sur [-0.5, 0.5]
  const n1 = ((h1 & 0xffff) / 0xffff) - 0.5;
  const n2 = ((h2 & 0xffff) / 0xffff) - 0.5;
  // ±0.75° de latitude ≈ ±83 km, ±1.2° de longitude ≈ ±90 km à 45°N.
  return { dlat: n1 * 1.5, dlng: n2 * 2.4 };
}

export const load: PageServerLoad = async () => {
  const [instances, stats, sysMetrics] = await Promise.all([
    // Vue carte = instances actives uniquement (les archivées sont gérées
    // depuis /instances → section dépliable).
    getAllInstances({ includeArchived: false }),
    getStats(),
    Promise.resolve(getSystemMetrics()),
  ]);

  // Enrich instances with geo if not cached
  const pool = getPool();
  const enriched = instances.map(inst => {
    let lat = inst.lat, lng = inst.lng, geo_city = inst.geo_city;
    let isApproximate = false;
    if (!lat && inst.ip) {
      const geo = lookupIp(inst.ip);
      if (geo) {
        lat = geo.lat; lng = geo.lng; geo_city = geo.city;
        pool.query(
          `UPDATE directory_instances SET lat=$1, lng=$2, geo_city=$3 WHERE id=$4`,
          [geo.lat, geo.lng, geo.city, inst.id]
        ).catch(() => {});
      }
    }
    // Fallback : centroid du pays + jitter par slug pour éviter la
    // superposition de markers quand plusieurs instances déclarent le
    // même pays sans qu'on ait pu géolocaliser leur IP réelle (typique
    // des sous-domaines derrière Cloudflare).
    if (!lat && inst.country) {
      const center = countryCenter(inst.country);
      if (center) {
        const j = slugJitter(inst.slug || inst.url || String(inst.id));
        lat = center.lat + j.dlat;
        lng = center.lng + j.dlng;
        isApproximate = true;
      }
    }
    return { ...inst, lat, lng, geo_city, isApproximate };
  });

  return {
    instances: enriched,
    stats: {
      total:         Number(stats.total),
      active:        Number(stats.active),
      banned:        Number(stats.banned),
      totalMembers:  Number(stats.total_members),
      onlineMembers: Number(stats.total_online),
    },
    sys: sysMetrics,
  };
};
