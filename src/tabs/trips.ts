/**
 * Trips tab: Start/Stop trip recording with GPS trail, distance, duration,
 * potholes passed; trip history with route map + summary detail.
 */
import { MapView } from '../mapView';
import { locationService } from '../location';
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
  let recording: {
    id: string;
    startedAt: number;
    points: TripPoint[];
    unsub: () => void;
    lastPoint: TripPoint | null;
    tickTimer: number | null;
  } | null = null;

  function render(): void {
    root.innerHTML = '';
    const head = el('div', 'page-head', 'Trips');
    root.appendChild(head);

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
    const trips = ctx.repo.listTrips();
    if (!trips.length && !recording) {
      list.appendChild(el('p', 'muted center', 'No trips yet. Start one before you drive.'));
    }
    for (const t of trips) {
      const item = el('button', 'trip-item glass');
      const title = t.endedAt
        ? formatDateTime(t.startedAt)
        : `In progress · started ${formatDateTime(t.startedAt)}`;
      item.append(
        el('div', 'trip-title', title),
        el(
          'div',
          'trip-sub muted',
          `${formatDistance(t.distanceMeters)} · ${formatDuration(
            ((t.endedAt ?? Date.now()) - t.startedAt) / 1000,
          )} · ${t.potholesPassed.length} pothole${t.potholesPassed.length === 1 ? '' : 's'} passed`,
        ),
      );
      item.addEventListener('click', () => showTripDetail(t));
      list.appendChild(item);
    }
    root.appendChild(list);
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
    toast('Trip recording started.');
    render();
  }

  function stopTrip(): void {
    if (!recording) return;
    const rec = recording;
    rec.unsub();
    if (rec.tickTimer !== null) window.clearInterval(rec.tickTimer);
    recording = null;
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
    const summary = el('div', 'trip-summary');
    summary.append(
      el('div', '', `Distance: ${formatDistance(t.distanceMeters)}`),
      el(
        'div',
        '',
        `Duration: ${formatDuration(((t.endedAt ?? Date.now()) - t.startedAt) / 1000)}`,
      ),
      el('div', '', `Points: ${t.points.length}`),
      el('div', '', `Potholes passed: ${t.potholesPassed.length}`),
    );
    sheet.appendChild(summary);

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
