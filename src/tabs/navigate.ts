/**
 * Navigate tab: 3D map, live GPS dot, "Where to?" search (Nominatim),
 * route preview (OSRM), turn-by-turn navigation mode, report FAB.
 */
import { MapView } from '../mapView';
import type { Fix } from '../location';
import { locationService } from '../location';
import { formatDistance, formatDuration, formatSpeed, haversineMeters } from '../geo';
import type { GeocodeResult, RouteResult } from '../types';
import type { TabContext } from '../context';
import type { PotholeReport } from '../types';
import { openReportSheet } from '../report';
import { el, openSheet, toast } from '../ui';

export function createNavigateTab(root: HTMLElement, ctx: TabContext): () => void {
  root.className = 'tab-page tab-navigate';

  const mapDiv = el('div', 'map-fill');
  root.appendChild(mapDiv);
  const map = new MapView(mapDiv, ctx.theme);
  ctx.onThemeChange((t) => map.setTheme(t));

  // --- top search bar ---
  const searchWrap = el('div', 'search-wrap glass');
  const searchInput = el('input', 'search-input') as HTMLInputElement;
  searchInput.placeholder = 'Where to?';
  searchInput.setAttribute('aria-label', 'Search destination');
  const resultsBox = el('div', 'search-results hidden');
  searchWrap.append(searchInput, resultsBox);
  root.appendChild(searchWrap);

  // --- day/night toggle ---
  const themeBtn = el('button', 'fab-btn glass', ctx.theme === 'dark' ? '☀️' : '🌙');
  themeBtn.id = 'theme-toggle';
  themeBtn.setAttribute('aria-label', 'Toggle day/night map');
  themeBtn.addEventListener('click', () => {
    const next = ctx.theme === 'dark' ? 'light' : 'dark';
    ctx.setTheme(next);
    document.body.dataset.theme = next;
    themeBtn.textContent = next === 'dark' ? '☀️' : '🌙';
  });
  root.appendChild(themeBtn);

  // --- report FAB ---
  const fab = el('button', 'fab-report', '+');
  fab.setAttribute('aria-label', 'Report pothole');
  fab.addEventListener('click', () => {
    openReportSheet(ctx.repo, locationService.lastFix, () => ctx.refreshPotholeLayers());
  });
  root.appendChild(fab);

  // --- route preview card ---
  const routeCard = el('div', 'route-card glass hidden');
  root.appendChild(routeCard);

  // --- navigation overlay ---
  const navOverlay = el('div', 'nav-overlay hidden');
  const navInstr = el('div', 'nav-instr glass');
  const navTurn = el('div', 'nav-turn', '');
  const navDist = el('div', 'nav-dist', '');
  navInstr.append(navTurn, navDist);
  const navBar = el('div', 'nav-bar glass');
  const navSpeed = el('div', 'nav-stat', '—');
  const navEta = el('div', 'nav-stat', '—');
  const navRemain = el('div', 'nav-stat', '—');
  const endBtn = el('button', 'btn btn-danger', 'End');
  navBar.append(navSpeed, navEta, navRemain, endBtn);
  navOverlay.append(navInstr, navBar);
  root.appendChild(navOverlay);

  // --- state ---
  let currentFix: Fix | null = null;
  let centered = false;
  let route: RouteResult | null = null;
  let dest: GeocodeResult | null = null;
  let navigating = false;
  let stepIndex = 0;
  let searchTimer: number | null = null;

  const unsub = locationService.subscribe((fix) => {
    currentFix = fix;
    map.updateUserPosition(fix, fix.heading);
    if (!centered) {
      centered = true;
      map.flyTo(fix, 15);
    }
    if (navigating && route) updateNavigation(fix);
  });

  // Potholes on the navigate map too.
  const refreshPotholes = () => {
    map.showPotholes(ctx.repo.listPotholes(), (r) => showPotholeDetail(r));
  };
  ctx.registerPotholeLayer(refreshPotholes);
  refreshPotholes();

  function showPotholeDetail(r: PotholeReport): void {
    const { sheet } = openSheet(`${r.severity} pothole${r.isSample ? ' (sample)' : ''}${r.source === 'denver311' ? ' · Denver 311' : ''}`);
    if (r.photoDataUrl) {
      const img = el('img', 'detail-photo') as HTMLImageElement;
      img.src = r.photoDataUrl;
      sheet.appendChild(img);
    }
    sheet.append(
      el('p', '', `Reported ${new Date(r.createdAt).toLocaleString()}`),
      el('p', '', r.notes || 'No notes.'),
      el('p', 'muted', `${r.lat.toFixed(5)}, ${r.lng.toFixed(5)}`),
    );
  }

  // --- search ---
  searchInput.addEventListener('input', () => {
    if (searchTimer) window.clearTimeout(searchTimer);
    const q = searchInput.value;
    if (q.trim().length < 3) {
      resultsBox.classList.add('hidden');
      return;
    }
    searchTimer = window.setTimeout(async () => {
      try {
        const near = currentFix ? { lat: currentFix.lat, lng: currentFix.lng } : undefined;
        const results = await ctx.geocoder.search(q, near);
        renderResults(results);
      } catch {
        toast('Search failed — check your connection.');
      }
    }, 450);
  });

  function renderResults(results: GeocodeResult[]): void {
    resultsBox.innerHTML = '';
    if (!results.length) {
      resultsBox.appendChild(el('div', 'search-empty', 'No places found'));
    }
    for (const r of results) {
      const item = el('button', 'search-item', r.label);
      item.addEventListener('click', () => selectDestination(r));
      resultsBox.appendChild(item);
    }
    resultsBox.classList.remove('hidden');
  }

  async function selectDestination(r: GeocodeResult): Promise<void> {
    resultsBox.classList.add('hidden');
    searchInput.value = r.label.split(',').slice(0, 2).join(',');
    dest = r;
    const from = currentFix ?? { lat: map.map.getCenter().lat, lng: map.map.getCenter().lng };
    routeCard.innerHTML = '';
    routeCard.appendChild(el('div', '', 'Finding route…'));
    routeCard.classList.remove('hidden');
    try {
      route = await ctx.router.route(from, { lat: r.lat, lng: r.lng });
      map.showRoute(route.geometry);
      map.fitToRoute(route.geometry);
      renderRouteCard(r);
    } catch {
      route = null;
      routeCard.innerHTML = '';
      routeCard.appendChild(el('div', '', 'Could not find a route.'));
      toast('Routing failed — try again.');
    }
  }

  function renderRouteCard(r: GeocodeResult): void {
    if (!route) return;
    routeCard.innerHTML = '';
    routeCard.append(
      el('div', 'route-dest', r.label.split(',').slice(0, 2).join(',')),
      el('div', 'route-meta', `${formatDistance(route.distanceMeters)} · ${formatDuration(route.durationSeconds)}`),
    );
    const start = el('button', 'btn btn-primary btn-block', 'Start Navigation');
    start.addEventListener('click', startNavigation);
    const cancel = el('button', 'btn btn-ghost btn-block', 'Clear');
    cancel.addEventListener('click', () => {
      route = null;
      dest = null;
      map.clearRoute();
      routeCard.classList.add('hidden');
    });
    routeCard.append(start, cancel);
  }

  // --- navigation mode ---
  function startNavigation(): void {
    if (!route || !dest) return;
    navigating = true;
    stepIndex = 0;
    routeCard.classList.add('hidden');
    searchWrap.classList.add('hidden');
    fab.classList.add('hidden');
    themeBtn.classList.add('hidden');
    navOverlay.classList.remove('hidden');
    if (currentFix) {
      map.followPosition(currentFix, currentFix.heading);
      updateNavigation(currentFix);
    }
    toast('Navigation started — drive safe.');
  }

  function updateNavigation(fix: Fix): void {
    if (!route) return;
    // Advance past maneuvers we've reached.
    while (stepIndex < route.steps.length - 1) {
      const m = route.steps[stepIndex];
      const d = haversineMeters(fix, { lat: m.maneuverLat, lng: m.maneuverLng });
      if (d < 30) stepIndex++;
      else break;
    }
    const step = route.steps[Math.min(stepIndex, route.steps.length - 1)];
    const distToTurn = haversineMeters(fix, { lat: step.maneuverLat, lng: step.maneuverLng });
    navTurn.textContent = step.instruction;
    navDist.textContent = distToTurn < 25 ? 'Now' : `in ${formatDistance(distToTurn)}`;

    // Remaining distance / ETA from the remaining steps.
    let remaining = distToTurn;
    for (let i = stepIndex + 1; i < route.steps.length; i++) {
      remaining += route.steps[i].distanceMeters;
    }
    const avg = route.durationSeconds > 0 ? route.distanceMeters / route.durationSeconds : 8;
    const speed = fix.speed && fix.speed > 2 ? fix.speed : avg;
    const etaSec = remaining / Math.max(speed, 2);
    const arrival = new Date(Date.now() + etaSec * 1000).toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    });

    navSpeed.innerHTML = '';
    navSpeed.append(el('div', 'stat-val', formatSpeed(fix.speed)), el('div', 'stat-lbl', 'speed'));
    navEta.innerHTML = '';
    navEta.append(el('div', 'stat-val', arrival), el('div', 'stat-lbl', 'arrival'));
    navRemain.innerHTML = '';
    navRemain.append(
      el('div', 'stat-val', formatDistance(remaining)),
      el('div', 'stat-lbl', 'remaining'),
    );

    map.followPosition(fix, fix.heading);
    if (stepIndex >= route.steps.length - 1 && distToTurn < 40) {
      endNavigation();
      toast('You have arrived.');
    }
  }

  function endNavigation(): void {
    navigating = false;
    route = null;
    dest = null;
    map.clearRoute();
    navOverlay.classList.add('hidden');
    searchWrap.classList.remove('hidden');
    fab.classList.remove('hidden');
    themeBtn.classList.remove('hidden');
    map.map.setPitch(0);
  }
  endBtn.addEventListener('click', endNavigation);

  // Called by the shell when this tab becomes visible again.
  return () => {
    map.resize();
  };
}
