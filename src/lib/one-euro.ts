// One Euro Filter — velocity-adaptive low-pass for jittery signals.
// https://gery.casiez.net/1euro/
// One instance per scalar channel.

export class OneEuro {
  private xPrev: number | null = null;
  private dxPrev = 0;
  private tPrev = 0;
  constructor(
    private minCutoff = 1.0,
    private beta = 0.02,
    private dCutoff = 1.0,
  ) {}

  reset() {
    this.xPrev = null;
    this.dxPrev = 0;
  }

  filter(x: number, tMs: number): number {
    if (this.xPrev == null) {
      this.xPrev = x;
      this.tPrev = tMs;
      return x;
    }
    const dt = Math.max(1, tMs - this.tPrev) / 1000;
    const dx = (x - this.xPrev) / dt;
    const aD = alpha(this.dCutoff, dt);
    const dxHat = aD * dx + (1 - aD) * this.dxPrev;
    const cutoff = this.minCutoff + this.beta * Math.abs(dxHat);
    const a = alpha(cutoff, dt);
    const xHat = a * x + (1 - a) * this.xPrev;
    this.xPrev = xHat;
    this.dxPrev = dxHat;
    this.tPrev = tMs;
    return xHat;
  }
}

function alpha(cutoff: number, dt: number) {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}

// Vector helper — smooth a stream of Pt arrays of fixed length.
export class OneEuroPoints {
  private xs: OneEuro[] = [];
  private ys: OneEuro[] = [];
  constructor(
    private size: number,
    minCutoff = 1.2,
    beta = 0.015,
  ) {
    for (let i = 0; i < size; i++) {
      this.xs.push(new OneEuro(minCutoff, beta));
      this.ys.push(new OneEuro(minCutoff, beta));
    }
  }
  reset() {
    this.xs.forEach((f) => f.reset());
    this.ys.forEach((f) => f.reset());
  }
  filter(pts: { x: number; y: number }[], tMs: number) {
    const out: { x: number; y: number }[] = new Array(this.size);
    for (let i = 0; i < this.size; i++) {
      out[i] = {
        x: this.xs[i].filter(pts[i].x, tMs),
        y: this.ys[i].filter(pts[i].y, tMs),
      };
    }
    return out;
  }
}
