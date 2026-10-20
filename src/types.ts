import type { Severity } from './config';

export interface LatLng {
  lat: number;
  lng: number;
}

export interface PotholeReport {
  id: string;
  lat: number;
  lng: number;
  severity: Severity;
  notes: string;
  photoDataUrl: string | null;
  createdAt: number; // epoch ms
  isSample: boolean;
  /** Set for the one-shot Denver 311 public-record seed (immutable, not user data). */
  source?: 'denver311';
}

export interface TripPoint extends LatLng {
  t: number; // epoch ms
  speed: number | null; // m/s
}

export interface Trip {
  id: string;
  startedAt: number;
  endedAt: number | null;
  points: TripPoint[];
  distanceMeters: number;
  potholesPassed: string[]; // report ids within proximity of the trail
}

export interface VehicleProfile {
  year: string;
  make: string;
  model: string;
}

export interface PrivacySettings {
  locationTracking: boolean;
}

export interface GeocodeResult {
  label: string;
  lat: number;
  lng: number;
}

export interface RouteStep {
  instruction: string;
  maneuverLat: number;
  maneuverLng: number;
  distanceMeters: number;
  durationSeconds: number;
}

export interface RouteResult {
  distanceMeters: number;
  durationSeconds: number;
  geometry: LatLng[]; // route polyline as lat/lng points
  steps: RouteStep[];
}
