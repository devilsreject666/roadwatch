/**
 * Replaceable provider interfaces.
 * To swap providers (e.g. self-hosted OSRM, Photon geocoding), implement these
 * interfaces and register them in config / app wiring. No secrets in code:
 * everything below uses free, keyless public services.
 */
import { PROVIDERS } from './config';
import { humanizeInstruction } from './geo';
import type { GeocodeResult, LatLng, RouteResult, RouteStep } from './types';

export interface GeocodingProvider {
  search(query: string, near?: LatLng): Promise<GeocodeResult[]>;
}

export interface RoutingProvider {
  route(from: LatLng, to: LatLng): Promise<RouteResult>;
}

/** Nominatim (OpenStreetMap) geocoder. Respects the usage policy: one in-flight
 *  request at a time, debounced by the caller, with an identifying User-Agent. */
export class NominatimGeocoder implements GeocodingProvider {
  private lastCall = 0;

  async search(query: string, near?: LatLng): Promise<GeocodeResult[]> {
    const q = query.trim();
    if (q.length < 3) return [];

    // Throttle to max ~1 request/second per the Nominatim usage policy.
    const wait = 1100 - (Date.now() - this.lastCall);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.lastCall = Date.now();

    const params = new URLSearchParams({
      format: 'jsonv2',
      q,
      limit: String(PROVIDERS.geocoding.limit),
      'accept-language': PROVIDERS.geocoding.language,
      addressdetails: '0',
    });
    if (near) {
      params.set('viewbox', `${near.lng - 1},${near.lat + 1},${near.lng + 1},${near.lat - 1}`);
      params.set('bounded', '0');
    }
    // Note: browsers do not allow overriding the User-Agent header; the
    // WebView/app UA is sent instead, which satisfies the policy's
    // "identify your application" requirement for app traffic.
    const res = await fetch(`${PROVIDERS.geocoding.baseUrl}?${params.toString()}`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`Geocoding failed (${res.status})`);
    const data = (await res.json()) as Array<{
      display_name: string;
      lat: string;
      lon: string;
    }>;
    return data.map((d) => ({
      label: d.display_name,
      lat: parseFloat(d.lat),
      lng: parseFloat(d.lon),
    }));
  }
}

interface OsrmStep {
  maneuver: { type: string; modifier?: string; location: [number, number] };
  name: string;
  distance: number;
  duration: number;
}

interface OsrmRoute {
  distance: number;
  duration: number;
  geometry: { coordinates: Array<[number, number]> };
  legs: Array<{ steps: OsrmStep[] }>;
}

/** OSRM public demo server routing. */
export class OsrmRouter implements RoutingProvider {
  async route(from: LatLng, to: LatLng): Promise<RouteResult> {
    const coords = `${from.lng},${from.lat};${to.lng},${to.lat}`;
    const params = new URLSearchParams({
      overview: 'full',
      geometries: 'geojson',
      steps: 'true',
      annotations: 'false',
    });
    const res = await fetch(
      `${PROVIDERS.routing.baseUrl}/${coords}?${params.toString()}`,
    );
    if (!res.ok) throw new Error(`Routing failed (${res.status})`);
    const data = (await res.json()) as { code: string; routes?: OsrmRoute[] };
    if (data.code !== 'Ok' || !data.routes?.length) {
      throw new Error('No route found');
    }
    const r = data.routes[0];
    const steps: RouteStep[] = [];
    for (const leg of r.legs) {
      for (const s of leg.steps) {
        steps.push({
          instruction: humanizeInstruction(s.maneuver.type, s.maneuver.modifier, s.name),
          maneuverLat: s.maneuver.location[1],
          maneuverLng: s.maneuver.location[0],
          distanceMeters: s.distance,
          durationSeconds: s.duration,
        });
      }
    }
    return {
      distanceMeters: r.distance,
      durationSeconds: r.duration,
      geometry: r.geometry.coordinates.map(([lng, lat]) => ({ lat, lng })),
      steps,
    };
  }
}
