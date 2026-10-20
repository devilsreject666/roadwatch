/**
 * Live GPS: Capacitor Geolocation on native, navigator.geolocation on web.
 * Single shared watcher; tabs subscribe. Honors the privacy toggle.
 */
import { Geolocation } from '@capacitor/geolocation';
import { Capacitor } from '@capacitor/core';
import type { LatLng } from './types';

export interface Fix extends LatLng {
  accuracy: number | null;
  speed: number | null; // m/s
  heading: number | null; // degrees
  timestamp: number;
}

type Listener = (fix: Fix) => void;

const listeners = new Set<Listener>();
let watchId: string | number | null = null;
let lastFix: Fix | null = null;
let trackingEnabled = true;

function emit(fix: Fix): void {
  lastFix = fix;
  for (const l of listeners) l(fix);
}

function toFix(p: {
  coords: {
    latitude: number;
    longitude: number;
    accuracy?: number | null;
    speed?: number | null;
    heading?: number | null;
  };
  timestamp: number;
}): Fix {
  return {
    lat: p.coords.latitude,
    lng: p.coords.longitude,
    accuracy: p.coords.accuracy ?? null,
    speed: p.coords.speed ?? null,
    heading: p.coords.heading ?? null,
    timestamp: p.timestamp,
  };
}

async function startNative(): Promise<void> {
  try {
    await Geolocation.requestPermissions();
  } catch {
    /* user denied; watcher will just never fire */
  }
  watchId = await Geolocation.watchPosition(
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 3000 },
    (pos) => {
      if (pos) emit(toFix(pos));
    },
  );
}

function startWeb(): void {
  if (!('geolocation' in navigator)) return;
  watchId = navigator.geolocation.watchPosition(
    (pos) => emit(toFix(pos)),
    () => {},
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 3000 },
  );
}

export const locationService = {
  get lastFix(): Fix | null {
    return lastFix;
  },

  setTrackingEnabled(on: boolean): void {
    trackingEnabled = on;
    if (!on) {
      this.stop();
      lastFix = null;
    } else if (listeners.size > 0) {
      void this.start();
    }
  },

  isTrackingEnabled(): boolean {
    return trackingEnabled;
  },

  async start(): Promise<void> {
    if (!trackingEnabled || watchId !== null) return;
    if (Capacitor.isNativePlatform()) await startNative();
    else startWeb();
  },

  stop(): void {
    if (watchId === null) return;
    if (Capacitor.isNativePlatform()) {
      void Geolocation.clearWatch({ id: String(watchId) });
    } else {
      navigator.geolocation.clearWatch(watchId as number);
    }
    watchId = null;
  },

  subscribe(fn: Listener): () => void {
    listeners.add(fn);
    if (lastFix) fn(lastFix);
    void this.start();
    return () => {
      listeners.delete(fn);
      if (listeners.size === 0) this.stop();
    };
  },
};
