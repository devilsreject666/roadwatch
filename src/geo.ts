import type { LatLng } from './types';

const EARTH_R = 6371000; // meters

export function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(h));
}

export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  const km = meters / 1000;
  return `${km.toFixed(km < 10 ? 1 : 0)} km`;
}

export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m} min`;
  return `${s}s`;
}

export function formatSpeed(mps: number | null): string {
  if (mps == null || Number.isNaN(mps)) return '—';
  return `${Math.round(mps * 3.6)} km/h`;
}

export function formatDateTime(epochMs: number): string {
  return new Date(epochMs).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Turn instruction text from an OSRM step into a short driver-friendly line. */
export function humanizeInstruction(type: string, modifier: string | undefined, roadName: string): string {
  const road = roadName ? ` onto ${roadName}` : '';
  if (type === 'arrive') return 'You have arrived';
  if (type === 'depart') return `Head${road}`;
  if (type === 'turn') {
    const dir = modifier ? modifier.replace('slight ', 'slight-').replace(/-/g, ' ') : 'turn';
    return `Turn ${dir}${road}`;
  }
  if (type === 'roundabout' || type === 'rotary') return `At the roundabout${road}`;
  if (type === 'merge') return `Merge${road}`;
  if (type === 'on ramp' || type === 'off ramp') return `Take the ramp${road}`;
  if (type === 'fork') return `Keep ${modifier ?? ''}${road}`.trim();
  if (type === 'end of road') return `At the end of the road, turn ${modifier ?? ''}${road}`.trim();
  if (type === 'continue') return `Continue${road}`;
  return `Continue${road}`;
}
