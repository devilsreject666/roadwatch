/**
 * MapLibre GL JS wrapper: 3D map, user location dot, pothole markers,
 * route line, and navigation camera. Provider URLs come from config.ts.
 */
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { DEFAULT_CENTER, PROVIDERS, SEVERITY_COLORS } from './config';
import type { LatLng, PotholeReport } from './types';

export type Theme = 'dark' | 'light';

const ROUTE_SRC = 'rw-route';
const ROUTE_LAYER = 'rw-route-line';
const SEED_SRC = 'rw-seed311';
const SEED_LAYER = 'rw-seed311-circles';

export class MapView {
  readonly map: maplibregl.Map;
  private userMarker: maplibregl.Marker | null = null;
  private potholeMarkers: maplibregl.Marker[] = [];
  private theme: Theme = 'dark';
  private terrainAdded = false;

  constructor(container: HTMLElement, theme: Theme = 'dark') {
    this.theme = theme;
    this.map = new maplibregl.Map({
      container,
      style: this.styleUrl(),
      center: DEFAULT_CENTER,
      zoom: 14,
      pitch: 0,
      attributionControl: { compact: true },
    });
    this.map.addControl(
      new maplibregl.NavigationControl({ visualizePitch: true }),
      'top-right',
    );
    this.map.on('load', () => this.addTerrain());
  }

  private styleUrl(): string {
    return this.theme === 'dark'
      ? PROVIDERS.map.darkStyle
      : PROVIDERS.map.lightStyle;
  }

  setTheme(theme: Theme): void {
    if (theme === this.theme) return;
    this.theme = theme;
    this.terrainAdded = false;
    // Preserve dynamic layers/markers across the style swap.
    const center = this.map.getCenter();
    const zoom = this.map.getZoom();
    const pitch = this.map.getPitch();
    const bearing = this.map.getBearing();
    this.map.setStyle(this.styleUrl());
    this.map.once('styledata', () => {
      this.map.setCenter(center);
      this.map.setZoom(zoom);
      this.map.setPitch(pitch);
      this.map.setBearing(bearing);
      this.addTerrain();
      this.repaintRoute();
      this.repaintSeeds();
    });
  }

  private addTerrain(): void {
    if (this.terrainAdded) return;
    try {
      this.map.addSource('rw-terrain', {
        type: 'raster-dem',
        tiles: [PROVIDERS.map.terrainTiles],
        tileSize: 256,
        maxzoom: 14,
      });
      this.map.setTerrain({ source: 'rw-terrain', exaggeration: 1.2 });
      this.terrainAdded = true;
    } catch {
      // Terrain is a nice-to-have; the map works fine without it.
    }
  }

  resize(): void {
    this.map.resize();
  }

  /** Pulsing blue dot for the live GPS position. */
  updateUserPosition(pos: LatLng, heading: number | null): void {
    if (!this.userMarker) {
      const el = document.createElement('div');
      el.className = 'user-dot';
      this.userMarker = new maplibregl.Marker({ element: el }).setLngLat([pos.lng, pos.lat]);
      this.userMarker.addTo(this.map);
    } else {
      this.userMarker.setLngLat([pos.lng, pos.lat]);
    }
    if (heading != null) {
      const el = this.userMarker.getElement();
      el.style.setProperty('--heading', `${heading}deg`);
      el.classList.add('has-heading');
    }
  }

  hideUserPosition(): void {
    this.userMarker?.remove();
    this.userMarker = null;
  }

  /** Color-coded pothole markers. onTap receives the report that was tapped.
   *  The Denver 311 seed pins (often thousands) render as one GPU circle
   *  layer instead of individual DOM markers; user reports keep tappable
   *  DOM markers. */
  showPotholes(reports: PotholeReport[], onTap: (r: PotholeReport) => void): void {
    this.clearPotholes();
    const seeds: PotholeReport[] = [];
    for (const r of reports) {
      if (r.source === 'denver311') {
        seeds.push(r);
        continue;
      }
      const el = document.createElement('button');
      el.className = 'pothole-marker';
      el.style.background = SEVERITY_COLORS[r.severity];
      el.setAttribute('aria-label', `${r.severity} pothole reported`);
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        onTap(r);
      });
      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([r.lng, r.lat])
        .addTo(this.map);
      this.potholeMarkers.push(marker);
    }
    this.lastSeeds = seeds;
    this.lastSeedTap = onTap;
    this.lastSeedById = new Map(seeds.map((r) => [r.id, r]));
    this.repaintSeeds();
  }

  clearPotholes(): void {
    for (const m of this.potholeMarkers) m.remove();
    this.potholeMarkers = [];
    this.lastSeeds = [];
    this.lastSeedById = new Map();
    if (this.map.getLayer(SEED_LAYER)) this.map.removeLayer(SEED_LAYER);
    if (this.map.getSource(SEED_SRC)) this.map.removeSource(SEED_SRC);
  }

  private lastSeeds: PotholeReport[] = [];
  private lastSeedById = new Map<string, PotholeReport>();
  private lastSeedTap: ((r: PotholeReport) => void) | null = null;
  private seedHandlersBound = false;

  /** (Re)draw the 311 seed circle layer; safe to call before style load. */
  private repaintSeeds(): void {
    if (!this.lastSeeds.length) return;
    if (!this.map.isStyleLoaded()) {
      this.map.once('idle', () => this.repaintSeeds());
      return;
    }
    const data = {
      type: 'FeatureCollection' as const,
      features: this.lastSeeds.map((r) => ({
        type: 'Feature' as const,
        properties: { id: r.id },
        geometry: {
          type: 'Point' as const,
          coordinates: [r.lng, r.lat] as [number, number],
        },
      })),
    };
    if (this.map.getSource(SEED_SRC)) {
      (this.map.getSource(SEED_SRC) as maplibregl.GeoJSONSource).setData(data);
    } else {
      this.map.addSource(SEED_SRC, { type: 'geojson', data });
      this.map.addLayer({
        id: SEED_LAYER,
        type: 'circle',
        source: SEED_SRC,
        minzoom: 8,
        paint: {
          'circle-color': SEVERITY_COLORS['Moderate'],
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 2.5, 14, 5, 17, 8],
          'circle-stroke-width': 1,
          'circle-stroke-color': '#0b1220',
          'circle-opacity': 0.9,
        },
      });
    }
    if (!this.seedHandlersBound) {
      this.seedHandlersBound = true;
      this.map.on('click', SEED_LAYER, (e) => {
        const id = e.features?.[0]?.properties?.['id'];
        const report = id ? this.lastSeedById.get(String(id)) : undefined;
        if (report && this.lastSeedTap) this.lastSeedTap(report);
      });
      this.map.on('mouseenter', SEED_LAYER, () => {
        this.map.getCanvas().style.cursor = 'pointer';
      });
      this.map.on('mouseleave', SEED_LAYER, () => {
        this.map.getCanvas().style.cursor = '';
      });
    }
  }

  private lastRoute: LatLng[] | null = null;

  showRoute(points: LatLng[]): void {
    this.lastRoute = points;
    this.repaintRoute();
  }

  private repaintRoute(): void {
    if (!this.map.getSource(ROUTE_SRC)) {
      if (!this.lastRoute) return;
      if (!this.map.isStyleLoaded()) {
        // Style swap in progress — retry once the map is idle.
        this.map.once('idle', () => this.repaintRoute());
        return;
      }
      this.map.addSource(ROUTE_SRC, {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: this.lastRoute.map((p) => [p.lng, p.lat]),
          },
        },
      });
      this.map.addLayer({
        id: ROUTE_LAYER,
        type: 'line',
        source: ROUTE_SRC,
        paint: {
          'line-color': '#38bdf8',
          'line-width': 6,
          'line-opacity': 0.9,
        },
      });
      return;
    }
    const src = this.map.getSource(ROUTE_SRC) as maplibregl.GeoJSONSource;
    src.setData({
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'LineString',
        coordinates: (this.lastRoute ?? []).map((p) => [p.lng, p.lat]),
      },
    });
  }

  clearRoute(): void {
    this.lastRoute = null;
    if (this.map.getLayer(ROUTE_LAYER)) this.map.removeLayer(ROUTE_LAYER);
    if (this.map.getSource(ROUTE_SRC)) this.map.removeSource(ROUTE_SRC);
    this.map.setTerrain(null);
    this.map.setPitch(0);
  }

  fitToRoute(points: LatLng[]): void {
    if (!points.length) return;
    const bounds = new maplibregl.LngLatBounds();
    for (const p of points) bounds.extend([p.lng, p.lat]);
    this.map.fitBounds(bounds, { padding: 60, pitch: 0 });
  }

  /** 3D follow camera for navigation mode. */
  followPosition(pos: LatLng, bearing: number | null): void {
    this.map.easeTo({
      center: [pos.lng, pos.lat],
      zoom: 17,
      pitch: 60,
      bearing: bearing ?? this.map.getBearing(),
      duration: 800,
    });
  }

  flyTo(pos: LatLng, zoom = 15): void {
    this.map.flyTo({ center: [pos.lng, pos.lat], zoom, duration: 1200 });
  }

  destroy(): void {
    this.map.remove();
  }
}
