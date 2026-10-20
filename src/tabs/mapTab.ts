/**
 * Map tab: full pothole map — color-coded markers, tap for details,
 * report FAB, day/night toggle.
 */
import { MapView } from '../mapView';
import { locationService } from '../location';
import { SEVERITY_COLORS } from '../config';
import type { PotholeReport } from '../types';
import type { TabContext } from '../context';
import { openReportSheet } from '../report';
import { formatDateTime } from '../geo';
import { el, openSheet, toast, confirmDialog } from '../ui';

export function createMapTab(root: HTMLElement, ctx: TabContext): () => void {
  root.className = 'tab-page tab-map';

  const mapDiv = el('div', 'map-fill');
  root.appendChild(mapDiv);
  const map = new MapView(mapDiv, ctx.theme);
  ctx.onThemeChange((t) => map.setTheme(t));

  const legend = el('div', 'legend glass');
  const severities: PotholeReport['severity'][] = [
    'Minor',
    'Moderate',
    'Severe',
    'Dangerous',
    'Extreme',
  ];
  for (const s of severities) {
    const item = el('span', 'legend-item');
    const dot = el('span', 'legend-dot');
    dot.style.background = SEVERITY_COLORS[s];
    item.append(dot, document.createTextNode(s));
    legend.appendChild(item);
  }
  root.appendChild(legend);

  const fab = el('button', 'fab-report', '+');
  fab.setAttribute('aria-label', 'Report pothole');
  fab.addEventListener('click', () => {
    openReportSheet(ctx.repo, locationService.lastFix, () => ctx.refreshPotholeLayers());
  });
  root.appendChild(fab);

  const refresh = () => {
    map.showPotholes(ctx.repo.listPotholes(), showDetail);
  };
  ctx.registerPotholeLayer(refresh);
  refresh();

  let centered = false;
  const unsub = locationService.subscribe((fix) => {
    map.updateUserPosition(fix, fix.heading);
    if (!centered) {
      centered = true;
      map.flyTo(fix, 13);
    }
  });
  void unsub;

  function showDetail(r: PotholeReport): void {
    const isSeed = r.source === 'denver311';
    const { sheet, close } = openSheet(
      `${r.severity} pothole${r.isSample ? ' · sample' : ''}${isSeed ? ' · Denver 311' : ''}`,
    );
    if (r.photoDataUrl) {
      const img = el('img', 'detail-photo') as HTMLImageElement;
      img.src = r.photoDataUrl;
      sheet.appendChild(img);
    }
    sheet.append(
      el('p', '', `Reported ${formatDateTime(r.createdAt)}`),
      el('p', '', r.notes || 'No notes.'),
      el('p', 'muted', `${r.lat.toFixed(5)}, ${r.lng.toFixed(5)}`),
    );
    if (isSeed) {
      // 311 pins are public record, not the user's data: no delete button.
      sheet.append(el('p', 'muted small', 'Public record from Denver 311 — not your report.'));
      return;
    }
    const del = el('button', 'btn btn-danger btn-block', 'Delete this report');
    del.addEventListener('click', async () => {
      if (await confirmDialog('Delete this pothole report?')) {
        ctx.repo.deletePothole(r.id);
        ctx.refreshPotholeLayers();
        toast('Report deleted.');
        close();
      }
    });
    sheet.appendChild(del);
  }

  return () => {
    map.resize();
  };
}
