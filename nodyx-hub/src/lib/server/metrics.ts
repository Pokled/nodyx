import os from 'os';
import { execSync } from 'child_process';

export interface SystemMetrics {
  cpu_pct:    number;
  mem_pct:    number;
  mem_used_mb: number;
  mem_total_mb: number;
  disk_pct:   number;
  disk_used_gb: number;
  disk_total_gb: number;
  uptime_s:   number;
  load_1:     number;
  load_5:     number;
  load_15:    number;
}

export function getSystemMetrics(): SystemMetrics {
  const totalMem  = os.totalmem();
  const freeMem   = os.freemem();
  const usedMem   = totalMem - freeMem;
  const mem_pct   = Math.round((usedMem / totalMem) * 100);
  const load      = os.loadavg();

  let disk_pct = 0, disk_used_gb = 0, disk_total_gb = 0;
  try {
    const df = execSync("df -BG / | tail -1 | awk '{print $2,$3,$5}'", { encoding: 'utf8' }).trim();
    const [total, used, pct] = df.split(' ');
    disk_total_gb = parseInt(total);
    disk_used_gb  = parseInt(used);
    disk_pct      = parseInt(pct);
  } catch { /* ignore */ }

  // CPU: average load as % of cores
  const cpu_pct = Math.min(100, Math.round((load[0] / os.cpus().length) * 100));

  return {
    cpu_pct,
    mem_pct,
    mem_used_mb:  Math.round(usedMem  / 1024 / 1024),
    mem_total_mb: Math.round(totalMem / 1024 / 1024),
    disk_pct,
    disk_used_gb,
    disk_total_gb,
    uptime_s:  os.uptime(),
    load_1:    load[0],
    load_5:    load[1],
    load_15:   load[2],
  };
}

export function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}j ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
