// One Euro filter — velocity-adaptive low-pass for jittery landmark streams.
// https://gery.casiez.net/1euro/
//
// This is the vectorized, allocation-free form: one instance smooths N (x, y)
// points at once, backed by flat Float64Arrays sized once at construction.
// filter() writes into caller-provided output arrays and never allocates.

function alpha(cutoff: number, dt: number): number {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}

export type OneEuroParams = {
  minCutoff: number;
  beta: number;
  dCutoff: number;
};

// On-device testing found the spec's suggested starting point (minCutoff
// 1.2, beta 0.02) read as noticeably laggy on both fast and slow head
// motion — beta in particular was too low to let the filter open up during
// genuine movement. These are still just a starting point; the harness
// exposes both live so they can be tuned per-device.
export const DEFAULT_ONE_EURO_PARAMS: OneEuroParams = {
  minCutoff: 2.2,
  beta: 0.35,
  dCutoff: 1.0,
};

export class OneEuroBuffer {
  readonly size: number;
  private minCutoff: number;
  private beta: number;
  private dCutoff: number;

  private xPrev: Float64Array;
  private yPrev: Float64Array;
  private dxPrev: Float64Array;
  private dyPrev: Float64Array;
  private tPrev: Float64Array;
  private initialized: Uint8Array;

  constructor(size: number, params: OneEuroParams = DEFAULT_ONE_EURO_PARAMS) {
    this.size = size;
    this.minCutoff = params.minCutoff;
    this.beta = params.beta;
    this.dCutoff = params.dCutoff;
    this.xPrev = new Float64Array(size);
    this.yPrev = new Float64Array(size);
    this.dxPrev = new Float64Array(size);
    this.dyPrev = new Float64Array(size);
    this.tPrev = new Float64Array(size);
    this.initialized = new Uint8Array(size);
  }

  setParams(params: Partial<OneEuroParams>): void {
    if (params.minCutoff != null) this.minCutoff = params.minCutoff;
    if (params.beta != null) this.beta = params.beta;
    if (params.dCutoff != null) this.dCutoff = params.dCutoff;
  }

  reset(): void {
    this.initialized.fill(0);
    this.dxPrev.fill(0);
    this.dyPrev.fill(0);
  }

  /**
   * Filters one frame of N (x, y) samples in place.
   * rawX/rawY: input coordinates, length === size.
   * outX/outY: written with smoothed coordinates, length === size.
   * Safe to alias outX===rawX / outY===rawY.
   */
  filter(
    rawX: Float64Array,
    rawY: Float64Array,
    outX: Float64Array,
    outY: Float64Array,
    tMs: number,
  ): void {
    const { size, minCutoff, beta, dCutoff } = this;
    for (let i = 0; i < size; i++) {
      const x = rawX[i];
      const y = rawY[i];

      if (!this.initialized[i]) {
        this.initialized[i] = 1;
        this.xPrev[i] = x;
        this.yPrev[i] = y;
        this.dxPrev[i] = 0;
        this.dyPrev[i] = 0;
        this.tPrev[i] = tMs;
        outX[i] = x;
        outY[i] = y;
        continue;
      }

      const dt = Math.max(0.001, (tMs - this.tPrev[i]) / 1000);
      const dx = (x - this.xPrev[i]) / dt;
      const dy = (y - this.yPrev[i]) / dt;

      const aD = alpha(dCutoff, dt);
      const dxHat = aD * dx + (1 - aD) * this.dxPrev[i];
      const dyHat = aD * dy + (1 - aD) * this.dyPrev[i];

      // x and y are filtered independently (per spec §4), each with its own
      // velocity-derived cutoff — not a coupled 2D speed term.
      const cutoffX = minCutoff + beta * Math.abs(dxHat);
      const cutoffY = minCutoff + beta * Math.abs(dyHat);
      const aX = alpha(cutoffX, dt);
      const aY = alpha(cutoffY, dt);

      const xHat = aX * x + (1 - aX) * this.xPrev[i];
      const yHat = aY * y + (1 - aY) * this.yPrev[i];

      outX[i] = xHat;
      outY[i] = yHat;

      this.xPrev[i] = xHat;
      this.yPrev[i] = yHat;
      this.dxPrev[i] = dxHat;
      this.dyPrev[i] = dyHat;
      this.tPrev[i] = tMs;
    }
  }
}
