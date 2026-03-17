import type { PageServerLoad } from './$types';
import { getAllInstances, getStats } from '$lib/server/pg.js';
import { getSystemMetrics } from '$lib/server/metrics.js';
import { lookupIp } from '$lib/server/geo.js';
import { getPool } from '$lib/server/pg.js';

export const load: PageServerLoad = async () => {
  const [instances, stats, sysMetrics] = await Promise.all([
    getAllInstances(),
    getStats(),
    Promise.resolve(getSystemMetrics()),
  ]);

  // Enrich instances with geo if not cached
  const pool = getPool();
  const enriched = instances.map(inst => {
    let lat = inst.lat, lng = inst.lng, geo_city = inst.geo_city;
    if (!lat && inst.ip) {
      const geo = lookupIp(inst.ip);
      if (geo) {
        lat = geo.lat; lng = geo.lng; geo_city = geo.city;
        // Cache async (fire and forget)
        pool.query(
          `UPDATE directory_instances SET lat=$1, lng=$2, geo_city=$3 WHERE id=$4`,
          [geo.lat, geo.lng, geo.city, inst.id]
        ).catch(() => {});
      }
    }
    return { ...inst, lat, lng, geo_city };
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
