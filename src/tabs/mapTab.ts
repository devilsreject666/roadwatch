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
    const rows = el('div', 'detail-rows');
    const addRow = (k: string, v: string) => {
      const row = el('div', 'detail-row');
      row.append(el('span', 'detail-k', k), el('span', 'detail-v', v));
      rows.appendChild(row);
    };
    addRow('Severity', r.severity);
    addRow('Reported', formatDateTime(r.createdAt));
    addRow('Location', `${r.lat.toFixed(5)}, ${r.lng.toFixed(5)}`);
    addRow('Source', isSeed ? 'Denver 311 (public record)' : r.isSample ? 'Sample report' : 'Your report');
    sheet.appendChild(rows);
    if (r.notes) sheet.append(el('p', '', r.notes));
    const shareBtn = el('button', 'btn btn-ghost btn-block', 'Share');
    shareBtn.addEventListener('click', () => void shareReport(r));
    sheet.appendChild(shareBtn);
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

  return () => {
    map.resize();
  };
}
