export function instanceStatus(inst: { status: string; last_seen: string | null }): 'online' | 'warning' | 'danger' | 'banned' {
  if (inst.status === 'banned') return 'banned';
  if (inst.status !== 'active') return 'danger';
  if (!inst.last_seen) return 'warning';
  const ago = Date.now() - new Date(inst.last_seen).getTime();
  if (ago < 15 * 60 * 1000)  return 'online';
  if (ago < 60 * 60 * 1000)  return 'warning';
  return 'danger';
}

export function timeAgo(dateStr: string | null): string {
  if (!dateStr) return 'jamais';
  const diff = Date.now() - new Date(dateStr).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60)    return `il y a ${s}s`;
  if (s < 3600)  return `il y a ${Math.floor(s/60)}min`;
  if (s < 86400) return `il y a ${Math.floor(s/3600)}h`;
  return `il y a ${Math.floor(s/86400)}j`;
}
