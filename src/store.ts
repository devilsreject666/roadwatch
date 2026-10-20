/**
 * Storage layer: a clean Repository interface backed by localStorage.
 * Swap in IndexedDB / SQLite / a remote API later by implementing Repository.
 */
import { uid } from './geo';
import type { PotholeReport, PrivacySettings, Trip, VehicleProfile } from './types';
import { SEED_311, type Seed311Row } from './seed311';

export interface Repository {
  // potholes
  listPotholes(): PotholeReport[];
  savePothole(r: PotholeReport): void;
  deletePothole(id: string): void;
  clearSamplePotholes(): void;
  // trips
  listTrips(): Trip[];
  saveTrip(t: Trip): void;
  deleteTrip(id: string): void;
  // profile
  getVehicle(): VehicleProfile;
  saveVehicle(v: VehicleProfile): void;
  getPrivacy(): PrivacySettings;
  savePrivacy(p: PrivacySettings): void;
  // nuclear option
  deleteAllUserData(): void;
}

const K = {
  potholes: 'roadwatch.potholes.v1',
  trips: 'roadwatch.trips.v1',
  vehicle: 'roadwatch.vehicle.v1',
  privacy: 'roadwatch.privacy.v1',
  seeded: 'roadwatch.samplesSeeded.v1',
};

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value));
}

/** Clearly-labeled sample reports near Denver, CO so the map is not empty
 *  on first launch. Removable with one tap in Profile. */
function samplePotholes(): PotholeReport[] {
  const now = Date.now();
  const day = 86400000;
  const mk = (
    lat: number,
    lng: number,
    severity: PotholeReport['severity'],
    notes: string,
    daysAgo: number,
  ): PotholeReport => ({
    id: uid('sample'),
    lat,
    lng,
    severity,
    notes: `[SAMPLE] ${notes}`,
    photoDataUrl: null,
    createdAt: now - daysAgo * day,
    isSample: true,
  });
  return [
    mk(39.7392, -104.9903, 'Severe', 'Deep pothole in right lane near Union Station', 2),
    mk(39.7525, -104.9995, 'Moderate', 'Cracked asphalt patch, left lane', 5),
    mk(39.728, -104.987, 'Dangerous', 'Large crater by the bus stop', 1),
    mk(39.761, -104.982, 'Minor', 'Small surface crack, easy to miss', 9),
    mk(39.735, -105.002, 'Extreme', 'Wheel-bender across two lanes', 3),
    mk(39.745, -104.975, 'Moderate', 'Pothole cluster after rain', 6),
  ];
}

/** Denver 311 public-record seed (Oct 2025 - Sep 2026). Immutable: it is merged
 *  in at read time and never written to localStorage, so user actions like
 *  delete/clear-samples can never remove or alter the public record.
 *  Severity is unknown in the 311 feed, so every seed pin is 'Moderate'. */
function seed311Reports(): PotholeReport[] {
  return SEED_311.map((row: Seed311Row): PotholeReport => {
    const [id, lat, lng, month, summary, address, neighborhood] = row;
    const [y, m] = month.split('-').map(Number);
    const bits = [`[311 · ${month}]`, summary];
    if (address) bits.push(`— ${address}`);
    if (neighborhood) bits.push(`(${neighborhood})`);
    return {
      id,
      lat,
      lng,
      severity: 'Moderate',
      notes: `${bits.join(' ')} · reported to Denver 311 (public record)`,
      photoDataUrl: null,
      createdAt: Date.UTC(y, m - 1, 1),
      isSample: false,
      source: 'denver311',
    };
  });
}

const SEED_311_REPORTS: PotholeReport[] = seed311Reports();

export class LocalStorageRepository implements Repository {
  constructor() {
    if (!localStorage.getItem(K.seeded)) {
      const existing = read<PotholeReport[]>(K.potholes, []);
      write(K.potholes, [...samplePotholes(), ...existing]);
      localStorage.setItem(K.seeded, '1');
    }
  }

  listPotholes(): PotholeReport[] {
    const user = read<PotholeReport[]>(K.potholes, []);
    // 311 seed pins are public record, merged in at read time (never stored).
    return [...SEED_311_REPORTS, ...user].sort((a, b) => b.createdAt - a.createdAt);
  }
  savePothole(r: PotholeReport): void {
    const all = read<PotholeReport[]>(K.potholes, []).filter((p) => p.id !== r.id);
    write(K.potholes, [r, ...all]);
  }
  deletePothole(id: string): void {
    write(
      K.potholes,
      read<PotholeReport[]>(K.potholes, []).filter((p) => p.id !== id),
    );
  }
  clearSamplePotholes(): void {
    write(
      K.potholes,
      read<PotholeReport[]>(K.potholes, []).filter((p) => !p.isSample),
    );
  }

  listTrips(): Trip[] {
    return read<Trip[]>(K.trips, []).sort((a, b) => b.startedAt - a.startedAt);
  }
  saveTrip(t: Trip): void {
    const all = read<Trip[]>(K.trips, []).filter((x) => x.id !== t.id);
    write(K.trips, [t, ...all]);
  }
  deleteTrip(id: string): void {
    write(
      K.trips,
      read<Trip[]>(K.trips, []).filter((x) => x.id !== id),
    );
  }

  getVehicle(): VehicleProfile {
    return read<VehicleProfile>(K.vehicle, { year: '', make: '', model: '' });
  }
  saveVehicle(v: VehicleProfile): void {
    write(K.vehicle, v);
  }

  getPrivacy(): PrivacySettings {
    return read<PrivacySettings>(K.privacy, { locationTracking: true });
  }
  savePrivacy(p: PrivacySettings): void {
    write(K.privacy, p);
  }

  deleteAllUserData(): void {
    for (const key of Object.values(K)) localStorage.removeItem(key);
  }
}
