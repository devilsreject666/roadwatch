/**
 * Profile tab: vehicle, privacy controls, sample-data management,
 * data export/delete, version + about.
 */
import { APP_VERSION } from '../config';
import { locationService } from '../location';
import { autoDetect } from '../autoDetect';
import type { TabContext } from '../context';
import { el, toast, confirmDialog } from '../ui';

export function createProfileTab(root: HTMLElement, ctx: TabContext): () => void {
  root.className = 'tab-page tab-profile';

  function render(): void {
    root.innerHTML = '';
    root.appendChild(el('div', 'page-head', 'Profile'));

    // --- vehicle ---
    const vCard = el('div', 'card glass');
    vCard.appendChild(el('h3', '', 'My vehicle'));
    const v = ctx.repo.getVehicle();
    const year = input('Year', v.year, 'e.g. 2018');
    const make = input('Make', v.make, 'e.g. Toyota');
    const model = input('Model', v.model, 'e.g. Camry');
    const saveV = el('button', 'btn btn-primary btn-block', 'Save vehicle');
    saveV.addEventListener('click', () => {
      ctx.repo.saveVehicle({
        year: year.input.value.trim(),
        make: make.input.value.trim(),
        model: model.input.value.trim(),
      });
      toast('Vehicle saved.');
    });
    vCard.append(year.wrap, make.wrap, model.wrap, saveV);
    root.appendChild(vCard);

    // --- privacy ---
    const pCard = el('div', 'card glass');
    pCard.appendChild(el('h3', '', 'Privacy'));
    const priv = ctx.repo.getPrivacy();
    const trackRow = el('label', 'toggle-row');
    const trackBox = el('input', '') as HTMLInputElement;
    trackBox.type = 'checkbox';
    trackBox.checked = priv.locationTracking;
    trackRow.append(trackBox, el('span', '', 'Location tracking'));
    trackBox.addEventListener('change', () => {
      const on = trackBox.checked;
      ctx.repo.savePrivacy({ ...ctx.repo.getPrivacy(), locationTracking: on });
      locationService.setTrackingEnabled(on);
      toast(on ? 'Location tracking on.' : 'Location tracking off.');
    });
    pCard.appendChild(trackRow);

    const detectRow = el('label', 'toggle-row');
    const detectBox = el('input', '') as HTMLInputElement;
    detectBox.type = 'checkbox';
    detectBox.checked = ctx.repo.getPrivacy().autoDetect !== false;
    detectRow.append(detectBox, el('span', '', 'Auto-detect potholes'));
    detectBox.addEventListener('change', () => {
      const on = detectBox.checked;
      ctx.repo.savePrivacy({ ...ctx.repo.getPrivacy(), autoDetect: on });
      autoDetect.setEnabled(on);
      toast(on ? 'Auto-detect on.' : 'Auto-detect off.');
    });
    pCard.appendChild(detectRow);
    pCard.appendChild(
      el(
        'p',
        'muted small',
        'Uses the motion sensor while you drive to catch pothole impacts and offer a one-tap report.',
      ),
    );
    pCard.appendChild(
      el(
        'p',
        'muted small',
        'RoadWatch stores your reports, trips and vehicle on this device only. Nothing is uploaded anywhere — there is no server.',
      ),
    );

    const exportBtn = el('button', 'btn btn-ghost btn-block', 'Export my data (JSON)');
    exportBtn.addEventListener('click', () => {
      const data = {
        exportedAt: new Date().toISOString(),
        app: 'RoadWatch',
        version: APP_VERSION,
        potholes: ctx.repo.listPotholes().filter((p) => p.source !== 'denver311'),
        trips: ctx.repo.listTrips(),
        vehicle: ctx.repo.getVehicle(),
      };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `roadwatch-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      toast('Data exported.');
    });

    const clearSamples = el('button', 'btn btn-ghost btn-block', 'Clear sample data');
    clearSamples.addEventListener('click', async () => {
      if (await confirmDialog('Remove the sample pothole reports? Your own reports stay.')) {
        ctx.repo.clearSamplePotholes();
        ctx.refreshPotholeLayers();
        toast('Sample data cleared.');
      }
    });

    const deleteAll = el('button', 'btn btn-danger btn-block', 'Delete all my data');
    deleteAll.addEventListener('click', async () => {
      if (
        await confirmDialog(
          'Delete ALL RoadWatch data on this device — reports, trips, vehicle, settings? This cannot be undone.',
        )
      ) {
        ctx.repo.deleteAllUserData();
        ctx.refreshPotholeLayers();
        render();
        toast('All data deleted.');
      }
    });
    pCard.append(exportBtn, clearSamples, deleteAll);
    root.appendChild(pCard);

    // --- about ---
    const aCard = el('div', 'card glass');
    aCard.appendChild(el('h3', '', 'About RoadWatch'));
    aCard.appendChild(
      el(
        'p',
        'muted',
        'RoadWatch is a GPS navigation app that watches the road with you. ' +
          'It maps potholes reported by drivers, guides you around them, and keeps ' +
          'a private record of your trips — all stored on your device.',
      ),
    );
    aCard.appendChild(el('p', 'muted small', `Version ${APP_VERSION} · MVP`));
    root.appendChild(aCard);
  }

  function input(label: string, value: string, placeholder: string) {
    const wrap = el('label', 'field');
    wrap.appendChild(el('span', 'field-label', label));
    const inp = el('input', 'text-input') as HTMLInputElement;
    inp.value = value;
    inp.placeholder = placeholder;
    wrap.appendChild(inp);
    return { wrap, input: inp };
  }

  render();
  return () => render();
}
