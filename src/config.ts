/**
 * Central app configuration.
 * APP_ID is the single constant for the native application identifier.
 * Change it here (and in android/app/build.gradle after `cap add`) to rebrand.
 */
export const APP_ID = 'com.roadwatch.app';
export const APP_NAME = 'RoadWatch';
export const APP_VERSION = '0.1.0';

/**
 * Replaceable provider configuration.
 * Swap map / geocoding / routing providers by editing these URLs and the
 * provider classes in providers.ts — no other code changes needed.
 * All providers below are free and require no API keys.
 */
export const PROVIDERS = {
  map: {
    // OpenFreeMap — free vector tiles (OpenMapTiles schema), no key needed.
    darkStyle: 'https://tiles.openfreemap.org/styles/dark',
    lightStyle: 'https://tiles.openfreemap.org/styles/bright',
    // Free elevation tiles (Terrarium encoding) for 3D terrain. Optional.
    terrainTiles: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
  },
  geocoding: {
    // Nominatim (OpenStreetMap). Usage policy: max ~1 req/sec, identify your app.
    baseUrl: 'https://nominatim.openstreetmap.org/search',
    userAgent: 'RoadWatch/0.1.0 (pothole navigation MVP; contact: in-app about page)',
    language: 'en',
    limit: 6,
  },
  routing: {
    // OSRM public demo server. Fair-use only; swap for a self-hosted OSRM later.
    baseUrl: 'https://router.project-osrm.org/route/v1/driving',
  },
} as const;

/** Denver, CO — default map center when no GPS fix is available yet. */
export const DEFAULT_CENTER: [number, number] = [-104.9903, 39.7392];

export const SEVERITY_ORDER = ['Minor', 'Moderate', 'Severe', 'Dangerous', 'Extreme'] as const;
export type Severity = (typeof SEVERITY_ORDER)[number];

export const SEVERITY_COLORS: Record<Severity, string> = {
  Minor: '#22c55e',
  Moderate: '#eab308',
  Severe: '#f97316',
  Dangerous: '#ef4444',
  Extreme: '#a855f7',
};
