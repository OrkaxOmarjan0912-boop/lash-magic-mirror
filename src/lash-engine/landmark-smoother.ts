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
/** Exported so the controller can use the same >200ms threshold for its faceLost event (spec §4). */
export const LOSS_FADE_START_MS = 200;
const LOSS_FADE_DURATION_MS = 150;
// Gap after which we treat re-acquisition as a fresh lock (reset the filter
// so the very next frame snaps to the true position instead of being damped
// toward a long-stale estimate) -- gives the "instant recovery" behavior
// required by the acceptance tests without sacrificing steady-state smoothing.
const FILTER_RESET_GAP_MS = 250;

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
        this.velX[i] = (this.curX[i] - this.prevSmoothX[i]) / dt;
        this.velY[i] = (this.curY[i] - this.prevSmoothY[i]) / dt;
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

    const dt = Math.min(EXTRAPOLATION_CLAMP_MS, Math.max(0, nowMs - this.lastIngestMs));
    for (let i = 0; i < TRACKED_COUNT; i++) {
      outX[i] = this.curX[i] + this.velX[i] * dt;
      outY[i] = this.curY[i] + this.velY[i] * dt;
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
