/**
 * Shared "Report pothole" bottom sheet used by the Navigate and Map tabs.
 */
import { SEVERITY_COLORS, SEVERITY_ORDER } from './config';
import type { Severity } from './config';
import { uid } from './geo';
import { capturePhoto } from './camera';
import type { Fix } from './location';
import type { Repository } from './store';
import type { PotholeReport } from './types';
import { el, openSheet, toast } from './ui';

export function openReportSheet(
  repo: Repository,
  fix: Fix | null,
  onSaved: () => void,
): void {
  const { sheet, close } = openSheet('Report pothole');
  let photo: string | null = null;
  let severity: Severity = 'Moderate';

  if (!fix) {
    sheet.append(
      el('p', 'warn', 'Waiting for GPS… move somewhere with a clear sky view, then try again.'),
    );
  }

  const photoBtn = el('button', 'btn btn-ghost photo-btn', '📷 Add photo');
  const preview = el('img', 'photo-preview hidden') as HTMLImageElement;
  photoBtn.addEventListener('click', async () => {
    photoBtn.textContent = 'Opening camera…';
    const url = await capturePhoto();
    photoBtn.textContent = '📷 Add photo';
    if (url) {
      photo = url;
      preview.src = url;
      preview.classList.remove('hidden');
    }
  });

  const segLabel = el('div', 'field-label', 'Severity');
  const seg = el('div', 'severity-seg');
  for (const s of SEVERITY_ORDER) {
    const b = el('button', 'seg-btn' + (s === severity ? ' active' : ''), s);
    b.style.setProperty('--sev', SEVERITY_COLORS[s]);
    b.addEventListener('click', () => {
      severity = s;
      seg.querySelectorAll('.seg-btn').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
    });
    seg.appendChild(b);
  }

  const notesLabel = el('div', 'field-label', 'Notes (optional)');
  const notes = el('textarea', 'notes-input') as HTMLTextAreaElement;
  notes.placeholder = 'e.g. deep pothole in the right lane';
  notes.rows = 3;

  const save = el('button', 'btn btn-primary btn-block', 'Save report');
  save.addEventListener('click', () => {
    if (!fix) {
      toast('No GPS fix yet — cannot attach a location.');
      return;
    }
    const report: PotholeReport = {
      id: uid('ph'),
      lat: fix.lat,
      lng: fix.lng,
      severity,
      notes: notes.value.trim(),
      photoDataUrl: photo,
      createdAt: Date.now(),
      isSample: false,
    };
    repo.savePothole(report);
    toast('Pothole reported — thanks!');
    close();
    onSaved();
  });

  sheet.append(photoBtn, preview, segLabel, seg, notesLabel, notes, save);
}
