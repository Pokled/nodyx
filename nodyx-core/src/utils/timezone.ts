// Un fuseau horaire IANA valide (« Europe/Paris », « America/Montreal »), selon le moteur
// lui-même : pas de liste à maintenir. 64 caractères au plus.
export function isTimeZone(v: unknown): v is string {
  if (typeof v !== 'string' || !v || v.length > 64) return false
  try { new Intl.DateTimeFormat('en-US', { timeZone: v }); return true } catch { return false }
}

/** La ville d'un fuseau : « Europe/Paris » → « Paris », « America/New_York » → « New York ». */
export function zoneCity(tz: string): string {
  return (tz.split('/').pop() ?? tz).replace(/_/g, ' ')
}

/** Le nom d'un fuseau dans une langue (« heure d'Europe centrale », « Eastern Time »), selon Intl. */
export function zoneName(tz: string, locale: string, at: string | Date = new Date()): string {
  const d = typeof at === 'string' ? new Date(at) : at
  for (const style of ['longGeneric', 'long'] as const) {
    try {
      const n = new Intl.DateTimeFormat(locale, { timeZone: tz, timeZoneName: style }).formatToParts(d).find(x => x.type === 'timeZoneName')?.value
      if (n) return n
    } catch { /* style non pris en charge : le suivant */ }
  }
  return tz
}
