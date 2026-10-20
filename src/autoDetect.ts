/**
 * Automatic pothole detection service.
 *
 * Listens to the device accelerometer (DeviceMotionEvent) while armed and
 * fires an in-app prompt when a sharp vertical jolt looks like a pothole
 * strike. Arming is reference-counted: trips and navigation each hold a
 * lease while active, so the sensor is never watched while idle.
 *
 * iOS: motion access needs DeviceMotionEvent.requestPermission(), which must
 * run inside a user gesture — it is requested lazily the first time the
 * service arms (both arming points are button taps). If denied or
 * unavailable, the service degrades to a silent no-op.
 */
import { ImpactDetector, severityForPeak } from './impactDetector';
import { locationService } from './location';
import type { Fix } from './location';
import { uid } from './geo';
import { el, openSheet, toast } from './ui';
import type { Repository } from './store';
import type { PotholeReport } from './types';

/** Auto-dismiss the detection prompt after this long with no report. */
const PROMPT_TIMEOUT_MS = 12000;

/** iOS-only: the static permission API does not exist in lib.dom. */
interface DeviceMotionEventCtor {
  requestPermission?: () => Promise<'granted' | 'denied'>;
}

function motionCtor(): DeviceMotionEventCtor | undefined {
  return typeof DeviceMotionEvent === 'undefined'
    ? undefined
    : (DeviceMotionEvent as unknown as DeviceMotionEventCtor);
}

class AutoDetectService {
  private repo: Repository | null = null;
  private onSaved: (() => void) | null = null;
  private detector = new ImpactDetector();
  private arms = 0;
  private enabled = true;
  private listening = false;
  private permission: 'unknown' | 'granted' | 'denied' | 'unsupported' = 'unknown';
  private requestInFlight = false;
  private promptOpen = false;

  init(repo: Repository, onSaved: () => void): void {
    this.repo = repo;
    this.onSaved = onSaved;
    this.enabled = repo.getPrivacy().autoDetect !== false;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    this.syncListening();
  }

  /**
   * Arm the detector (one lease per caller). Call the returned function to
   * release the lease. The sensor is only watched while at least one lease
   * is held and the feature is enabled.
   */
  acquire(): () => void {
    let released = false;
    this.arms += 1;
    this.ensureStarted();
    return () => {
      if (released) return;
      released = true;
      this.arms = Math.max(0, this.arms - 1);
      this.syncListening();
    };
  }

  private permissionOk(): boolean {
    const ctor = motionCtor();
    if (!ctor) return false;
    if (typeof ctor.requestPermission === 'function') return this.permission === 'granted';
    return true;
  }

  /** Called from the arming tap's call stack so iOS sees a user gesture. */
  private ensureStarted(): void {
    if (!this.enabled || this.arms <= 0 || this.listening) return;
    const ctor = motionCtor();
    if (!ctor) {
      this.permission = 'unsupported';
      return;
    }
    if (typeof ctor.requestPermission === 'function' && this.permission !== 'granted') {
      if (this.permission === 'denied' || this.requestInFlight) return;
      this.requestInFlight = true;
      ctor
        .requestPermission()
        .then((r) => {
          this.requestInFlight = false;
          this.permission = r;
          if (r === 'granted') this.syncListening();
          else toast('Motion access denied — auto-detect is off.');
        })
        .catch(() => {
          this.requestInFlight = false;
          this.permission = 'denied';
        });
      return;
    }
    this.syncListening();
  }

  private syncListening(): void {
    const want = this.enabled && this.arms > 0 && this.permissionOk();
    if (want && !this.listening) {
      window.addEventListener('devicemotion', this.onMotion);
      this.listening = true;
      this.detector.reset();
    } else if (!want && this.listening) {
      window.removeEventListener('devicemotion', this.onMotion);
      this.listening = false;
    }
  }

  private onMotion = (e: DeviceMotionEvent): void => {
    const a = e.accelerationIncludingGravity;
    if (!a || a.x === null || a.y === null || a.z === null) return;
    const fix = locationService.lastFix;
    const ev = this.detector.sample(a.x, a.y, a.z, e.timeStamp || Date.now(), fix?.speed ?? null);
    if (ev && fix) this.onImpact(ev.peakMs2, fix);
  };

  private onImpact(peakMs2: number, fix: Fix): void {
    if (this.promptOpen || !this.repo) return;
    if ('vibrate' in navigator) {
      try {
        navigator.vibrate(200);
      } catch {
        /* vibration unsupported — visual prompt is enough */
      }
    }
    const severity = severityForPeak(peakMs2);
    const { sheet, close } = openSheet('Pothole detected');
    this.promptOpen = true;
    let done = false;
    let timer = 0;
    const dismiss = (): void => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      this.promptOpen = false;
      close();
    };
    timer = window.setTimeout(dismiss, PROMPT_TIMEOUT_MS);
    sheet.append(
      el('p', '', 'Pothole detected — add report?'),
      el(
        'p',
        'muted small',
        `Impact ≈ ${(peakMs2 / 9.81).toFixed(1)}g · suggested severity: ${severity}`,
      ),
    );
    const row = el('div', 'btn-row');
    const reportBtn = el('button', 'btn btn-primary', 'Report');
    const dismissBtn = el('button', 'btn btn-ghost', 'Dismiss');
    reportBtn.addEventListener('click', () => {
      const report: PotholeReport = {
        id: uid('ph'),
        lat: fix.lat,
        lng: fix.lng,
        severity,
        notes: '[auto-detected]',
        photoDataUrl: null,
        createdAt: Date.now(),
        isSample: false,
        source: 'auto',
      };
      this.repo!.savePothole(report);
      toast('Pothole reported — thanks!');
      this.onSaved?.();
      dismiss();
    });
    dismissBtn.addEventListener('click', dismiss);
    row.append(reportBtn, dismissBtn);
    sheet.appendChild(row);
  }
}

export const autoDetect = new AutoDetectService();
