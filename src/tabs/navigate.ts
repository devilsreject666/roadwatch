/**
 * Navigate tab: 3D map, live GPS dot, "Where to?" search (Nominatim),
 * route preview (OSRM), turn-by-turn navigation mode, report FAB.
 */
import { MapView } from '../mapView';
import type { Fix } from '../location';
import { locationService } from '../location';
import { autoDetect } from '../autoDetect';
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
  const searchRow = el('div', 'search-row');
  const searchInput = el('input', 'search-input') as HTMLInputElement;
  searchInput.placeholder = 'Where to?';
  searchInput.setAttribute('aria-label', 'Search destination');
  const micBtn = el('button', 'mic-btn', '🎙');
  micBtn.setAttribute('aria-label', 'Search by voice');
  micBtn.addEventListener('click', () => {
    const w = window as unknown as Record<string, any>;
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) {
      toast('Voice search is not available in this browser.');
      return;
    }
    try {
      const rec = new Ctor();
      rec.lang = 'en-US';
      rec.interimResults = false;
      rec.maxAlternatives = 1;
      micBtn.classList.add('listening');
      rec.onresult = (e: any) => {
        const heard = e.results?.[0]?.[0]?.transcript as string | undefined;
        if (heard) {
          searchInput.value = heard;
          void runSearch(heard);
        }
      };
      rec.onend = () => micBtn.classList.remove('listening');
      rec.onerror = () => {
        micBtn.classList.remove('listening');
        toast('Voice search did not hear anything.');
      };
      rec.start();
    } catch {
      micBtn.classList.remove('listening');
      toast('Voice search is not available in this browser.');
    }
  });
  searchRow.append(searchInput, micBtn);
  const resultsBox = el('div', 'search-results hidden');
  searchWrap.append(searchRow, resultsBox);
  root.appendChild(searchWrap);

  // --- quick-destination chips (photo: Home / Work / Gas / Food) ---
  const chipsRow = el('div', 'quick-chips');
  const chipDefs: Array<{ icon: string; label: string; key?: string; query?: string }> = [
    { icon: '🏠', label: 'Home', key: 'rw-saved-home' },
    { icon: '💼', label: 'Work', key: 'rw-saved-work' },
    { icon: '⛽', label: 'Gas', query: 'gas station' },
    { icon: '🍔', label: 'Food', query: 'restaurant' },
  ];
  for (const def of chipDefs) {
    const chip = el('button', 'quick-chip', `${def.icon} ${def.label}`);
    chip.addEventListener('click', () => {
      if (def.key) {
        const saved = loadSavedPlace(def.key);
        if (saved) {
          void selectDestination(saved);
        } else {
          toast(
            `No ${def.label.toLowerCase()} saved yet — search an address, then tap Save as ${def.label} on the route card.`,
          );
        }
        return;
      }
      if (def.query) {
        searchInput.value = def.label === 'Gas' ? 'Gas stations' : 'Restaurants';
        void runSearch(def.query);
      }
    });
    chipsRow.appendChild(chip);
  }
  root.appendChild(chipsRow);

  // --- Drive Safe card: only when road monitoring is genuinely active ---
  const driveSafe = el('div', 'drive-safe-card glass hidden');
  const shield = el('div', 'drive-safe-shield', '🛡️');
  const dsText = el('div', '');
  const dsSub = el('div', 'drive-safe-sub');
  dsSub.append(el('span', 'drive-safe-dot'), document.createTextNode('Road Monitoring Active'));
  dsText.append(el('div', 'drive-safe-title', 'Drive Safe'), dsSub);
  const dsSpeed = el('div', 'drive-safe-speed');
  const driveSpeed = el('div', 'stat-val', '—');
  dsSpeed.append(driveSpeed, el('div', 'stat-lbl', 'speed'));
  driveSafe.append(shield, dsText, dsSpeed);
  root.appendChild(driveSafe);

  function monitoringOn(): boolean {
    return ctx.repo.getPrivacy().autoDetect !== false && locationService.isTrackingEnabled();
  }

  function updateDriveSafe(): void {
    const show = !navigating && !route && monitoringOn();
    driveSafe.classList.toggle('hidden', !show);
    chipsRow.classList.toggle('hidden', navigating);
  }

  function loadSavedPlace(key: string): GeocodeResult | null {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const p = JSON.parse(raw) as GeocodeResult;
      if (typeof p.lat === 'number' && typeof p.lng === 'number' && p.label) return p;
      return null;
    } catch {
      return null;
    }
  }

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
  let releaseAutoDetect: (() => void) | null = null;

  const unsub = locationService.subscribe((fix) => {
    currentFix = fix;
    map.updateUserPosition(fix, fix.heading);
    driveSpeed.textContent = formatSpeed(fix.speed);
    updateDriveSafe();
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
    const isSeed = r.source === 'denver311';
    const { sheet } = openSheet(
      `${r.severity} pothole${r.isSample ? ' (sample)' : ''}${isSeed ? ' · Denver 311' : ''}`,
    );
    if (r.photoDataUrl) {
      const img = el('img', 'detail-photo') as HTMLImageElement;
      img.src = r.photoDataUrl;
      sheet.appendChild(img);
    }
    const rows = el('div', 'detail-rows');
    const addRow = (k: string, v: string) => {
      const row = el('div', 'detail-row');
      row.append(el('span', 'detail-k', k), el('span', 'detail-v', v));
      rows.appendChild(row);
    };
    addRow('Severity', r.severity);
    addRow('Reported', new Date(r.createdAt).toLocaleString());
    addRow('Location', `${r.lat.toFixed(5)}, ${r.lng.toFixed(5)}`);
    addRow('Source', isSeed ? 'Denver 311 (public record)' : r.isSample ? 'Sample report' : 'Your report');
    sheet.appendChild(rows);
    if (r.notes) sheet.append(el('p', '', r.notes));
    const shareBtn = el('button', 'btn btn-ghost btn-block', 'Share');
    shareBtn.addEventListener('click', () => void shareReport(r));
    sheet.appendChild(shareBtn);
  }

  async function shareReport(r: PotholeReport): Promise<void> {
    const text = `${r.severity} pothole — ${r.lat.toFixed(5)}, ${r.lng.toFixed(5)}`;
    const url = `https://maps.google.com/?q=${r.lat},${r.lng}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: 'RoadWatch pothole', text, url });
        return;
      } catch {
        return; // user dismissed the share sheet
      }
    }
    try {
      await navigator.clipboard.writeText(`${text} ${url}`);
      toast('Location copied.');
    } catch {
      toast('Sharing is not available here.');
    }
  }

  // --- search ---
  async function runSearch(q: string): Promise<void> {
    if (q.trim().length < 3) {
      resultsBox.classList.add('hidden');
      return;
    }
    try {
      const near = currentFix ? { lat: currentFix.lat, lng: currentFix.lng } : undefined;
      const results = await ctx.geocoder.search(q, near);
      renderResults(results);
    } catch {
      toast('Search failed — check your connection.');
    }
  }

  searchInput.addEventListener('input', () => {
    if (searchTimer) window.clearTimeout(searchTimer);
    const q = searchInput.value;
    if (q.trim().length < 3) {
      resultsBox.classList.add('hidden');
      return;
    }
    searchTimer = window.setTimeout(() => void runSearch(q), 450);
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
      updateDriveSafe();
    } catch {
      route = null;
      routeCard.innerHTML = '';
      routeCard.appendChild(el('div', '', 'Could not find a route.'));
      toast('Routing failed — try again.');
      updateDriveSafe();
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
      updateDriveSafe();
    });
    const saveRow = el('div', 'route-save-row');
    const saveHome = el('button', 'btn btn-ghost', 'Save as Home');
    saveHome.addEventListener('click', () => {
      localStorage.setItem('rw-saved-home', JSON.stringify(r));
      toast('Home saved.');
    });
    const saveWork = el('button', 'btn btn-ghost', 'Save as Work');
    saveWork.addEventListener('click', () => {
      localStorage.setItem('rw-saved-work', JSON.stringify(r));
      toast('Work saved.');
    });
    saveRow.append(saveHome, saveWork);
    routeCard.append(start, cancel, saveRow);
  }

  // --- navigation mode ---
  function startNavigation(): void {
    if (!route || !dest) return;
    navigating = true;
    stepIndex = 0;
    releaseAutoDetect = autoDetect.acquire();
    routeCard.classList.add('hidden');
    searchWrap.classList.add('hidden');
    fab.classList.add('hidden');
    themeBtn.classList.add('hidden');
    navOverlay.classList.remove('hidden');
    updateDriveSafe();
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
    releaseAutoDetect?.();
    releaseAutoDetect = null;
    route = null;
    dest = null;
    map.clearRoute();
    navOverlay.classList.add('hidden');
    searchWrap.classList.remove('hidden');
    fab.classList.remove('hidden');
    themeBtn.classList.remove('hidden');
    map.map.setPitch(45);
    updateDriveSafe();
  }
  endBtn.addEventListener('click', endNavigation);

  // Called by the shell when this tab becomes visible again.
  return () => {
    map.resize();
  };
}
