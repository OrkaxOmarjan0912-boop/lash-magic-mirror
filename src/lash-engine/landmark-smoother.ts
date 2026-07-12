// Converts raw normalized detections into smoothed, display-rate landmark
// positions in canvas pixel space (spec §4).
//
// Detection runs at <=30Hz; rendering runs every animation frame (~60Hz).
// Between detections we extrapolate using the last estimated velocity,
// clamped to 50ms so a missed detection or two doesn't cause overshoot.
// On tracking loss >200ms we fade opacity to 0 over the next 150ms instead
// of freezing the last pose or snapping. All buffers are preallocated;
// ingest()/sample() never allocate.
import { TRACKED_COUNT } from "./landmarks";
import { OneEuroBuffer, DEFAULT_ONE_EURO_PARAMS, type OneEuroParams } from "./one-euro";
import type { TrackedFrame } from "./face-tracker";

const EXTRAPOLATION_CLAMP_MS = 50;
// Beyond the clamp, decay the extrapolated offset back to the last confirmed
// position over this window instead of holding it frozen at a stale
// 50ms-out projection. Without this, a slow/late detection (or one noisy
// velocity sample) left the overlay visibly "stuck" at the wrong spot until
// the next detection arrived, rather than settling back toward ground truth.
const EXTRAPOLATION_DECAY_MS = 120;
/** Exported so the controller can use the same >200ms threshold for its faceLost event (spec §4). */
export const LOSS_FADE_START_MS = 200;
const LOSS_FADE_DURATION_MS = 150;
// Gap after which we treat re-acquisition as a fresh lock (reset the filter
// so the very next frame snaps to the true position instead of being damped
// toward a long-stale estimate) -- gives the "instant recovery" behavior
// required by the acceptance tests without sacrificing steady-state smoothing.
const FILTER_RESET_GAP_MS = 250;
// EMA weight applied to each new frame-to-frame velocity sample. A single
// noisy detection (model jitter divided by a short inter-detection dt) could
// otherwise produce an outlier velocity spike that gets projected forward
// during extrapolation, reading as the overlay "drifting" off in a wrong
// direction until the next detection corrects it. Blending damps that
// without materially adding lag, since it still fully incorporates a
// sustained motion within 2-3 detection frames.
const VELOCITY_EMA_ALPHA = 0.45;
// Hard ceiling on any single-axis velocity estimate (px/ms), as a backstop
// against pathological outliers regardless of EMA smoothing.
const MAX_VELOCITY_PX_PER_MS = 4;

export class LandmarkSmoother {
  private filter: OneEuroBuffer;

  // Last two smoothed detections, in pixel space, used to derive velocity.
  private curX = new Float64Array(TRACKED_COUNT);
  private curY = new Float64Array(TRACKED_COUNT);
  private prevSmoothX = new Float64Array(TRACKED_COUNT);
  private prevSmoothY = new Float64Array(TRACKED_COUNT);
  private velX = new Float64Array(TRACKED_COUNT); // px/ms
  private velY = new Float64Array(TRACKED_COUNT);

  // Scratch buffer for the pixel-space conversion of an incoming detection.
  private scratchX = new Float64Array(TRACKED_COUNT);
  private scratchY = new Float64Array(TRACKED_COUNT);

  private lastIngestMs = 0;
  private lastFoundMs = -Infinity;
  private hasEverIngested = false;
  private currentlyFound = false;

  constructor(params: OneEuroParams = DEFAULT_ONE_EURO_PARAMS) {
    this.filter = new OneEuroBuffer(TRACKED_COUNT, params);
  }

  setParams(params: Partial<OneEuroParams>): void {
    this.filter.setParams(params);
  }

  get isFound(): boolean {
    return this.currentlyFound;
  }

  /** Milliseconds since a face was last successfully detected. */
  msSinceFound(nowMs: number): number {
    return nowMs - this.lastFoundMs;
  }

  /**
   * Feed one detection result. `mirror` flips x for a front-camera selfie
   * view (canvasWidth - x) so displayed lashes match what the user sees.
   */
  ingest(frame: TrackedFrame, canvasWidth: number, canvasHeight: number, mirror: boolean): void {
    const nowMs = frame.timestampMs;

    if (!frame.found) {
      this.currentlyFound = false;
      return;
    }

    const wasStale = !this.hasEverIngested || nowMs - this.lastIngestMs > FILTER_RESET_GAP_MS;
    if (wasStale) this.filter.reset();

    for (let i = 0; i < TRACKED_COUNT; i++) {
      const nx = frame.x[i];
      const ny = frame.y[i];
      this.scratchX[i] = mirror ? canvasWidth - nx * canvasWidth : nx * canvasWidth;
      this.scratchY[i] = ny * canvasHeight;
    }

    // Stash the previous smoothed frame before overwriting, to derive velocity.
    this.prevSmoothX.set(this.curX);
    this.prevSmoothY.set(this.curY);
    const prevIngestMs = this.lastIngestMs;

    this.filter.filter(this.scratchX, this.scratchY, this.curX, this.curY, nowMs);

    const dt = wasStale ? 0 : Math.max(1, nowMs - prevIngestMs);
    if (dt > 0 && !wasStale) {
      for (let i = 0; i < TRACKED_COUNT; i++) {
        let rawVx = (this.curX[i] - this.prevSmoothX[i]) / dt;
        let rawVy = (this.curY[i] - this.prevSmoothY[i]) / dt;
        rawVx = Math.max(-MAX_VELOCITY_PX_PER_MS, Math.min(MAX_VELOCITY_PX_PER_MS, rawVx));
        rawVy = Math.max(-MAX_VELOCITY_PX_PER_MS, Math.min(MAX_VELOCITY_PX_PER_MS, rawVy));
        this.velX[i] = this.velX[i] + (rawVx - this.velX[i]) * VELOCITY_EMA_ALPHA;
        this.velY[i] = this.velY[i] + (rawVy - this.velY[i]) * VELOCITY_EMA_ALPHA;
      }
    } else {
      this.velX.fill(0);
      this.velY.fill(0);
    }

    this.lastIngestMs = nowMs;
    this.lastFoundMs = nowMs;
    this.hasEverIngested = true;
    this.currentlyFound = true;
  }

  /**
   * Writes this frame's display-rate positions into caller-owned outX/outY
   * (extrapolated forward from the last detection, velocity-clamped) and
   * returns the opacity multiplier (1 = fully visible, 0 = faded out due to
   * tracking loss). Returns opacity 0 with untouched output if we've never
   * had a detection.
   */
  sample(nowMs: number, outX: Float64Array, outY: Float64Array): number {
    if (!this.hasEverIngested) return 0;

    const rawDt = Math.max(0, nowMs - this.lastIngestMs);
    const dt = Math.min(EXTRAPOLATION_CLAMP_MS, rawDt);
    // Past the clamp, fade the extrapolated offset back toward the last
    // confirmed position instead of holding it frozen (see EXTRAPOLATION_DECAY_MS above).
    const velScale =
      rawDt <= EXTRAPOLATION_CLAMP_MS
        ? 1
        : Math.max(0, 1 - (rawDt - EXTRAPOLATION_CLAMP_MS) / EXTRAPOLATION_DECAY_MS);
    for (let i = 0; i < TRACKED_COUNT; i++) {
      outX[i] = this.curX[i] + this.velX[i] * dt * velScale;
      outY[i] = this.curY[i] + this.velY[i] * dt * velScale;
    }

    const sinceFound = nowMs - this.lastFoundMs;
    if (sinceFound <= LOSS_FADE_START_MS) return 1;
    const fadeT = (sinceFound - LOSS_FADE_START_MS) / LOSS_FADE_DURATION_MS;
    return Math.max(0, 1 - fadeT);
  }

  reset(): void {
    this.filter.reset();
    this.hasEverIngested = false;
    this.currentlyFound = false;
    this.lastFoundMs = -Infinity;
    this.velX.fill(0);
    this.velY.fill(0);
  }
}
