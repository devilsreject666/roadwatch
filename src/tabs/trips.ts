/**
 * Trips tab: Start/Stop trip recording with GPS trail, distance, duration,
 * potholes passed; trip history with route map + summary detail.
 */
import { MapView } from '../mapView';
import { locationService } from '../location';
import { autoDetect } from '../autoDetect';
import type { Fix } from '../location';
import { formatDateTime, formatDistance, formatDuration, haversineMeters, uid } from '../geo';
import type { Trip, TripPoint } from '../types';
import type { TabContext } from '../context';
import { el, openSheet, toast, confirmDialog } from '../ui';

const POINT_MIN_GAP_MS = 3000;
const POINT_MIN_DIST_M = 8;
const POTHOLE_PROXIMITY_M = 60;

export function createTripsTab(root: HTMLElement, ctx: TabContext): () => void {
  root.className = 'tab-page tab-trips';
  let filter: 'all' | 'week' | 'month' = 'all';
  let recording: {
    id: string;
    startedAt: number;
    points: TripPoint[];
    unsub: () => void;
    lastPoint: TripPoint | null;
    tickTimer: number | null;
  } | null = null;
  let releaseAutoDetect: (() => void) | null = null;

  function render(): void {
    root.innerHTML = '';
    const head = el('div', 'page-head', 'Trips');
    root.appendChild(head);

    const filterRow = el('div', 'filter-row');
    const filters: Array<{ key: typeof filter; label: string }> = [
      { key: 'all', label: 'All' },
      { key: 'week', label: 'This Week' },
      { key: 'month', label: 'This Month' },
    ];
    for (const f of filters) {
      const chip = el('button', `filter-chip${filter === f.key ? ' active' : ''}`, f.label);
      chip.addEventListener('click', () => {
        filter = f.key;
        render();
      });
      filterRow.appendChild(chip);
    }
    root.appendChild(filterRow);

    if (recording) {
      const card = el('div', 'card glass recording-card');
      card.append(el('div', 'rec-dot'), el('div', 'rec-title', 'Recording trip…'));
      const stats = el('div', 'trip-live-stats');
      const distEl = el('div', 'stat-val', '0 m');
      const durEl = el('div', 'stat-val', '0s');
      stats.append(
        statBox(distEl, 'distance'),
        statBox(durEl, 'duration'),
      );
      card.appendChild(stats);
      const stop = el('button', 'btn btn-danger btn-block', 'Stop trip');
      stop.addEventListener('click', stopTrip);
      card.appendChild(stop);
      root.appendChild(card);

      const tick = () => {
        if (!recording) return;
        const d = tripDistance(recording.points);
        distEl.textContent = formatDistance(d);
        durEl.textContent = formatDuration((Date.now() - recording.startedAt) / 1000);
      };
      if (recording.tickTimer !== null) window.clearInterval(recording.tickTimer);
      recording.tickTimer = window.setInterval(tick, 1000);
      tick();
    } else {
      const start = el('button', 'btn btn-primary btn-block btn-big', '▶ Start trip');
      start.addEventListener('click', startTrip);
      root.appendChild(start);
      root.appendChild(
        el('p', 'muted center', 'Records your GPS trail, distance and duration.'),
      );
    }

    const list = el('div', 'trip-list');
    const allTrips = ctx.repo.listTrips();
    const now = Date.now();
    const trips = allTrips.filter((t) => {
      if (filter === 'week') return t.startedAt >= now - 7 * 24 * 3600 * 1000;
      if (filter === 'month') return t.startedAt >= now - 30 * 24 * 3600 * 1000;
      return true;
    });
    if (!trips.length && !recording) {
      list.appendChild(
        el(
          'p',
          'muted center',
          allTrips.length ? 'No trips in this range.' : 'No trips yet. Start one before you drive.',
        ),
      );
    }
    for (const t of trips) {
      const item = el('button', 'trip-item glass');
      const title = t.endedAt
        ? formatDateTime(t.startedAt)
        : `In progress · started ${formatDateTime(t.startedAt)}`;
      const dayLabel = dayName(t.startedAt);
      const grid = el('div', 'trip-card-grid');
      grid.appendChild(trailPreview(t));
      const stats = el('div', '');
      const dur = formatDuration(((t.endedAt ?? Date.now()) - t.startedAt) / 1000);
      stats.append(
        el('div', 'trip-title', formatDistance(t.distanceMeters)),
        el('div', 'trip-sub muted', `Distance`),
        el('div', 'trip-title', dur),
        el('div', 'trip-sub muted', `Duration`),
        el('div', 'trip-title', `${t.potholesPassed.length}`),
        el('div', 'trip-sub muted', `Pothole${t.potholesPassed.length === 1 ? '' : 's'} passed`),
      );
      grid.appendChild(stats);
      item.append(el('div', 'trip-title', `${dayLabel} · ${title}`), grid);
      item.addEventListener('click', () => showTripDetail(t));
      list.appendChild(item);
    }
    root.appendChild(list);
  }

  function dayName(epochMs: number): string {
    const d = new Date(epochMs);
    const today = new Date();
    const sameDay = (a: Date, b: Date) =>
      a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    if (sameDay(d, today)) return 'Today';
    const y = new Date(today);
    y.setDate(y.getDate() - 1);
    if (sameDay(d, y)) return 'Yesterday';
    return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  }

  /** Tiny SVG trail from the trip's real GPS points — no map instance per card. */
  function trailPreview(t: Trip): HTMLElement {
    const wrap = el('div', 'trip-mini-map');
    if (t.points.length < 2) {
      wrap.appendChild(el('div', 'muted small center', 'No GPS trail'));
      return wrap;
    }
    const lats = t.points.map((p) => p.lat);
    const lngs = t.points.map((p) => p.lng);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    const spanLat = Math.max(maxLat - minLat, 0.0001);
    const spanLng = Math.max(maxLng - minLng, 0.0001);
    const W = 140;
    const H = 96;
    const px = (p: TripPoint) => (8 + ((p.lng - minLng) / spanLng) * (W - 16)).toFixed(1);
    const py = (p: TripPoint) => (8 + (1 - (p.lat - minLat) / spanLat) * (H - 16)).toFixed(1);
    const pts = t.points.map((p) => `${px(p)},${py(p)}`).join(' ');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '96');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    line.setAttribute('points', pts);
    line.setAttribute('fill', 'none');
    line.setAttribute('stroke', '#267cff');
    line.setAttribute('stroke-width', '3');
    line.setAttribute('stroke-linejoin', 'round');
    line.setAttribute('stroke-linecap', 'round');
    svg.appendChild(line);
    const dot = (p: TripPoint, color: string) => {
      const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      c.setAttribute('cx', px(p));
      c.setAttribute('cy', py(p));
      c.setAttribute('r', '4.5');
      c.setAttribute('fill', color);
      c.setAttribute('stroke', '#fff');
      c.setAttribute('stroke-width', '1.5');
      svg.appendChild(c);
    };
    dot(t.points[0], '#32d583');
    dot(t.points[t.points.length - 1], '#f04452');
    wrap.appendChild(svg);
    return wrap;
  }

  function statBox(val: HTMLElement, label: string): HTMLElement {
    const b = el('div', 'nav-stat');
    b.append(val, el('div', 'stat-lbl', label));
    return b;
  }

  function tripDistance(points: TripPoint[]): number {
    let d = 0;
    for (let i = 1; i < points.length; i++) d += haversineMeters(points[i - 1], points[i]);
    return d;
  }

  function startTrip(): void {
    if (!locationService.isTrackingEnabled()) {
      toast('Location tracking is off — enable it in Profile.');
      return;
    }
    const rec = {
      id: uid('trip'),
      startedAt: Date.now(),
      points: [] as TripPoint[],
      lastPoint: null as TripPoint | null,
      tickTimer: null as number | null,
      unsub: () => {},
    };
    rec.unsub = locationService.subscribe((fix: Fix) => {
      const p: TripPoint = { lat: fix.lat, lng: fix.lng, t: fix.timestamp, speed: fix.speed };
      const last = rec.lastPoint;
      if (
        last &&
        fix.timestamp - last.t < POINT_MIN_GAP_MS &&
        haversineMeters(last, p) < POINT_MIN_DIST_M
      ) {
        return;
      }
      rec.points.push(p);
      rec.lastPoint = p;
    });
    recording = rec;
    releaseAutoDetect = autoDetect.acquire();
    toast('Trip recording started.');
    render();
  }

  function stopTrip(): void {
    if (!recording) return;
    const rec = recording;
    rec.unsub();
    if (rec.tickTimer !== null) window.clearInterval(rec.tickTimer);
    recording = null;
    releaseAutoDetect?.();
    releaseAutoDetect = null;
    const endedAt = Date.now();
    const reports = ctx.repo.listPotholes();
    const passed = new Set<string>();
    for (const rp of reports) {
      for (const p of rec.points) {
        if (haversineMeters(p, rp) <= POTHOLE_PROXIMITY_M) {
          passed.add(rp.id);
          break;
        }
      }
    }
    const trip: Trip = {
      id: rec.id,
      startedAt: rec.startedAt,
      endedAt,
      points: rec.points,
      distanceMeters: tripDistance(rec.points),
      potholesPassed: [...passed],
    };
    ctx.repo.saveTrip(trip);
    toast(
      `Trip saved: ${formatDistance(trip.distanceMeters)}, ${formatDuration(
        (endedAt - rec.startedAt) / 1000,
      )}.`,
    );
    render();
  }

  function showTripDetail(t: Trip): void {
    const { sheet, close } = openSheet(formatDateTime(t.startedAt));
    const dur = formatDuration(((t.endedAt ?? Date.now()) - t.startedAt) / 1000);
    const metrics = el('div', 'metric-grid');
    const metric = (value: string, label: string) => {
      const m = el('div', 'metric');
      m.append(el('span', 'metric-value', value), el('span', 'metric-label', label));
      return m;
    };
    metrics.append(
      metric(formatDistance(t.distanceMeters), 'Distance'),
      metric(dur, 'Duration'),
      metric(`${t.potholesPassed.length}`, 'Potholes'),
    );
    sheet.appendChild(metrics);
    sheet.appendChild(
      el('div', 'trip-summary muted', `${t.points.length} GPS points · started ${formatDateTime(t.startedAt)}`),
    );

    if (t.potholesPassed.length) {
      sheet.appendChild(el('h3', '', 'Potholes passed'));
      const byId = new Map(ctx.repo.listPotholes().map((r) => [r.id, r]));
      for (const id of t.potholesPassed) {
        const r = byId.get(id);
        if (!r) continue;
        const row = el('div', 'detail-row');
        const pillClass =
          r.severity === 'Severe' || r.severity === 'Dangerous' || r.severity === 'Extreme'
            ? 'status-pill danger'
            : r.severity === 'Moderate'
              ? 'status-pill warning'
              : 'status-pill success';
        row.append(
          el('span', pillClass, r.severity),
          el(
            'span',
            'detail-v',
            `${r.lat.toFixed(4)}, ${r.lng.toFixed(4)}${r.source === 'denver311' ? ' · Denver 311' : ''}`,
          ),
        );
        sheet.appendChild(row);
      }
    }

    if (t.points.length > 1) {
      const mapWrap = el('div', 'mini-map');
      sheet.appendChild(mapWrap);
      const mv = new MapView(mapWrap, ctx.theme);
      // Draw the trail as a route line.
      mv.showRoute(t.points.map((p) => ({ lat: p.lat, lng: p.lng })));
      mv.fitToRoute(t.points.map((p) => ({ lat: p.lat, lng: p.lng })));
      mv.map.scrollZoom.disable();
      mv.map.dragPan.disable();
    } else {
      sheet.appendChild(el('p', 'muted', 'Not enough GPS points to draw a route.'));
    }

    const del = el('button', 'btn btn-danger btn-block', 'Delete trip');
    del.addEventListener('click', async () => {
      if (await confirmDialog('Delete this trip?')) {
        ctx.repo.deleteTrip(t.id);
        toast('Trip deleted.');
        close();
        render();
      }
    });
    sheet.appendChild(del);
  }

  render();
  return () => render();
}
