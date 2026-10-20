/**
 * Pure impact-detection core for automatic pothole detection.
 *
 * No DOM / platform dependencies: feed it raw accelerometer samples
 * (accelerationIncludingGravity, m/s^2) plus the current ground speed and it
 * decides when a sharp vertical jolt looks like a pothole strike.
 *
 * Method: a low-pass filter tracks the gravity vector; subtracting it gives
 * linear acceleration. The "vertical" component is the projection of the
 * linear acceleration onto the gravity direction, so it works no matter how
 * the phone is oriented in the car. A hit must:
 *   - spike past IMPACT_THRESHOLD_MS2 on the vertical axis,
 *   - have a matching 3D magnitude (sanity check against single-axis noise),
 *   - rise from near-quiet to the threshold within RISE_WINDOW_MS,
 *   - happen while travelling faster than MIN_SPEED_MS,
 *   - be outside the cooldown since the previous detection.
 * The peak is captured over a short settle window after the trigger so the
 * reported severity reflects the strongest part of the jolt.
 */
import type { Severity } from './config';

/** ~1.7 g of vertical linear acceleration. */
export const IMPACT_THRESHOLD_MS2 = 17;
/** The jolt must rise from quiet to threshold within this window. */
export const RISE_WINDOW_MS = 150;
/** "|vertical| below this" counts as quiet for rise-time purposes. */
export const RISE_BASELINE_MS2 = 4;
/** 3D magnitude must reach at least this fraction of the threshold. */
export const MAGNITUDE_SANITY_RATIO = 0.7;
/** Minimum ground speed for a detection: ~8 km/h. */
export const MIN_SPEED_MS = 8 / 3.6;
/** Minimum gap between two detections. */
export const COOLDOWN_MS = 15000;
/** Low-pass weight for the gravity estimate (per sample, ~60 Hz stream).
 *  Slow on purpose (~325 ms time constant) so a sharp jolt does not get
 *  absorbed into the gravity estimate before it can be detected. */
export const GRAVITY_ALPHA = 0.95;
/** How long after the trigger we keep watching for a bigger peak. */
export const SETTLE_MS = 250;

export interface ImpactEvent {
  /** Peak vertical linear acceleration of the jolt, m/s^2. */
  peakMs2: number;
  /** Timestamp (same clock as the samples) when the jolt triggered. */
  atMs: number;
}

/** Map an impact peak to a report severity. */
export function severityForPeak(peakMs2: number): Severity {
  if (peakMs2 >= 40) return 'Extreme';
  if (peakMs2 >= 30) return 'Dangerous';
  if (peakMs2 >= 22) return 'Severe';
  return 'Moderate';
}

export class ImpactDetector {
  private gx = 0;
  private gy = 0;
  private gz = 0;
  private gravityReady = false;
  /** When the current excursion above the quiet baseline began. */
  private riseStartMs: number | null = null;
  /** Settle-window bookkeeping while a triggered jolt plays out. */
  private settlingUntilMs = -Infinity;
  private pendingPeak = 0;
  private pendingAtMs = 0;
  private lastFiredAtMs = -Infinity;

  reset(): void {
    this.gravityReady = false;
    this.riseStartMs = null;
    this.settlingUntilMs = -Infinity;
    this.pendingPeak = 0;
    this.lastFiredAtMs = -Infinity;
  }

  /**
   * Feed one accelerometer sample.
   * @param speedMs current ground speed in m/s, or null when unknown.
   * @returns an ImpactEvent once per detected jolt (after the settle
   *   window), otherwise null.
   */
  sample(
    ax: number,
    ay: number,
    az: number,
    tMs: number,
    speedMs: number | null,
  ): ImpactEvent | null {
    // --- gravity estimate (low-pass) + linear acceleration ---
    if (!this.gravityReady) {
      this.gx = ax;
      this.gy = ay;
      this.gz = az;
      this.gravityReady = true;
    } else {
      this.gx = GRAVITY_ALPHA * this.gx + (1 - GRAVITY_ALPHA) * ax;
      this.gy = GRAVITY_ALPHA * this.gy + (1 - GRAVITY_ALPHA) * ay;
      this.gz = GRAVITY_ALPHA * this.gz + (1 - GRAVITY_ALPHA) * az;
    }
    const lx = ax - this.gx;
    const ly = ay - this.gy;
    const lz = az - this.gz;
    const gMag = Math.hypot(this.gx, this.gy, this.gz);
    if (gMag < 1e-6) return null;
    // Vertical = component of linear acceleration along gravity.
    const vertical = (lx * this.gx + ly * this.gy + lz * this.gz) / gMag;
    const magnitude = Math.hypot(lx, ly, lz);
    const absV = Math.abs(vertical);

    // --- settle window: track the peak, then emit the event ---
    if (tMs <= this.settlingUntilMs) {
      if (absV > this.pendingPeak) this.pendingPeak = absV;
      return null;
    }
    if (this.pendingPeak > 0) {
      const ev: ImpactEvent = { peakMs2: this.pendingPeak, atMs: this.pendingAtMs };
      this.pendingPeak = 0;
      return ev;
    }

    // --- rise tracking: when did the current excursion leave quiet? ---
    if (absV > RISE_BASELINE_MS2) {
      if (this.riseStartMs === null) this.riseStartMs = tMs;
    } else {
      this.riseStartMs = null;
    }

    // --- trigger conditions ---
    if (absV < IMPACT_THRESHOLD_MS2) return null;
    if (magnitude < IMPACT_THRESHOLD_MS2 * MAGNITUDE_SANITY_RATIO) return null;
    if (this.riseStartMs === null || tMs - this.riseStartMs > RISE_WINDOW_MS) return null;
    if (speedMs === null || speedMs <= MIN_SPEED_MS) return null;
    if (tMs - this.lastFiredAtMs < COOLDOWN_MS) return null;

    this.lastFiredAtMs = tMs;
    this.pendingAtMs = tMs;
    this.pendingPeak = absV;
    this.settlingUntilMs = tMs + SETTLE_MS;
    return null;
  }
}
