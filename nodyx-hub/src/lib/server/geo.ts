import geoip from 'geoip-lite';

export interface GeoInfo {
  lat: number;
  lng: number;
  city: string;
  country: string;
}

export function lookupIp(ip: string): GeoInfo | null {
  if (!ip || ip === '127.0.0.1' || ip === '::1' || ip.startsWith('192.168.') || ip.startsWith('10.')) {
    return null;
  }
  try {
    const geo = geoip.lookup(ip);
    if (!geo || !geo.ll) return null;
    return {
      lat:     geo.ll[0],
      lng:     geo.ll[1],
      city:    geo.city    || '',
      country: geo.country || '',
    };
  } catch {
    return null;
  }
}
