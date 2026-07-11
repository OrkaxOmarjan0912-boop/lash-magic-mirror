// Per-eye geometry derived from smoothed landmarks (spec §5): a centripetal
// Catmull-Rom lid spline resampled to N=32 arc-length-even points (the lash
// root curve), eye width, roll, openness (session-calibrated), and the yaw
// foreshortening proxy.
//
// All output lives in fixed-size typed arrays owned by the EyeGeometry
// instance; update() overwrites them in place and never allocates.
import { upperLid, EYE_CORNERS, lidMid, INDEX_TO_SLOT, type EyeSide } from "./landmarks";

export const SPLINE_SAMPLES = 32;

const SEGMENTS_PER_LID = upperLid("right").length - 1; // 8
const DENSE_PER_SEGMENT = 8;
const DENSE_COUNT = SEGMENTS_PER_LID * DENSE_PER_SEGMENT + 1; // 65

// Openness calibration (spec §5): typical open ~0.28-0.35, closed <0.08.
const OPENNESS_FLOOR = 0.06;
const OPENNESS_ROLLING_MAX_FLOOR = 0.22; // don't normalize against an implausibly small max
const OPENNESS_MAX_DECAY_PER_MS = 1 - 1e-6; // very slow leak, lets the ceiling drift down over long sessions

const YAW_FORESHORTEN_FLOOR = 0.75; // spec §5: max 25% length reduction on the far eye

export class EyeGeometry {
  readonly side: EyeSide;

  // Public per-frame outputs.
  readonly splineX = new Float64Array(SPLINE_SAMPLES);
  readonly splineY = new Float64Array(SPLINE_SAMPLES);
  readonly tangentX = new Float64Array(SPLINE_SAMPLES);
  readonly tangentY = new Float64Array(SPLINE_SAMPLES);
  eyeWidth = 0;
  roll = 0; // radians, corner-to-corner
  openness = 0; // 0..1, session-normalized
  rawOpennessRatio = 0; // gap/eyeWidth, pre-normalization
  innerX = 0;
  innerY = 0;
  outerX = 0;
  outerY = 0;
  // Unit vector pointing from inner -> outer corner.
  axisX = 1;
  axisY = 0;
  // Unit "up" vector (perpendicular to the eye axis, pointing away from the cheek).
  upX = 0;
  upY = -1;
  valid = false;

  private upperSlots: number[];
  private midUpperSlot: number;
  private midLowerSlot: number;
  private innerSlot: number;
  private outerSlot: number;

  // Scratch: dense curve samples + phantom-extended control points.
  private denseX = new Float64Array(DENSE_COUNT);
  private denseY = new Float64Array(DENSE_COUNT);
  private segLen = new Float64Array(DENSE_COUNT - 1);
  private ctrlX = new Float64Array(SEGMENTS_PER_LID + 3); // phantom start/end + N points
  private ctrlY = new Float64Array(SEGMENTS_PER_LID + 3);

  private opennessRollingMax = OPENNESS_ROLLING_MAX_FLOOR;
  private lastUpdateMs = 0;

  constructor(side: EyeSide) {
    this.side = side;
    const idx = upperLid(side);
    this.upperSlots = idx.map((i) => {
      const slot = INDEX_TO_SLOT.get(i);
      if (slot == null) throw new Error(`landmark ${i} not tracked`);
      return slot;
    });
    const mid = lidMid(side);
    this.midUpperSlot = mustSlot(mid.upper);
    this.midLowerSlot = mustSlot(mid.lower);
    const corners = EYE_CORNERS[side];
    this.innerSlot = mustSlot(corners.inner);
    this.outerSlot = mustSlot(corners.outer);
  }

  update(px: Float64Array, py: Float64Array, nowMs: number): void {
    const n = this.upperSlots.length;
    for (let i = 0; i < n; i++) {
      const s = this.upperSlots[i];
      this.ctrlX[i + 1] = px[s];
      this.ctrlY[i + 1] = py[s];
    }
    // Phantom endpoints via linear reflection, so boundary segments have a
    // well-defined (non-zero-length) virtual neighbor for the centripetal fit.
    this.ctrlX[0] = 2 * this.ctrlX[1] - this.ctrlX[2];
    this.ctrlY[0] = 2 * this.ctrlY[1] - this.ctrlY[2];
    this.ctrlX[n + 1] = 2 * this.ctrlX[n] - this.ctrlX[n - 1];
    this.ctrlY[n + 1] = 2 * this.ctrlY[n] - this.ctrlY[n - 1];

    this.innerX = px[this.innerSlot];
    this.innerY = py[this.innerSlot];
    this.outerX = px[this.outerSlot];
    this.outerY = py[this.outerSlot];

    const dx = this.outerX - this.innerX;
    const dy = this.outerY - this.innerY;
    const eyeLen = Math.hypot(dx, dy) || 1;
    this.eyeWidth = eyeLen;
    this.roll = Math.atan2(dy, dx);
    this.axisX = dx / eyeLen;
    this.axisY = dy / eyeLen;

    // Up = axis rotated -90deg, oriented to point away from the cheek (screen-up,
    // i.e. negative y) regardless of head roll sign.
    let upX = -this.axisY;
    let upY = this.axisX;
    if (upY > 0) {
      upX = -upX;
      upY = -upY;
    }
    this.upX = upX;
    this.upY = upY;

    if (eyeLen < 6) {
      this.valid = false;
      return;
    }

    this.buildDenseCurve(n);
    this.resampleArcLength();

    // Openness: max of the mid-gap and the widest upper/lower gap across the
    // lid (mirrors spec §5; the max guards against the midpoint landmark
    // being a noisy single sample).
    const midU_x = px[this.midUpperSlot];
    const midU_y = py[this.midUpperSlot];
    const midL_x = px[this.midLowerSlot];
    const midL_y = py[this.midLowerSlot];
    const gap = Math.hypot(midU_x - midL_x, midU_y - midL_y);
    const ratio = gap / eyeLen;
    this.rawOpennessRatio = ratio;

    const dt = this.lastUpdateMs ? Math.max(0, nowMs - this.lastUpdateMs) : 0;
    this.lastUpdateMs = nowMs;
    const decayed = this.opennessRollingMax * Math.pow(OPENNESS_MAX_DECAY_PER_MS, dt);
    this.opennessRollingMax = Math.max(OPENNESS_ROLLING_MAX_FLOOR, Math.max(ratio, decayed));

    const normalized = (ratio - OPENNESS_FLOOR) / (this.opennessRollingMax - OPENNESS_FLOOR);
    this.openness = Math.min(1, Math.max(0, normalized));
    this.valid = true;
  }

  private buildDenseCurve(n: number): void {
    const cx = this.ctrlX;
    const cy = this.ctrlY;
    let w = 0;
    for (let seg = 0; seg < SEGMENTS_PER_LID; seg++) {
      // Control indices in the phantom-padded array: p0..p3 = seg, seg+1, seg+2, seg+3
      const x0 = cx[seg],
        y0 = cy[seg];
      const x1 = cx[seg + 1],
        y1 = cy[seg + 1];
      const x2 = cx[seg + 2],
        y2 = cy[seg + 2];
      const x3 = cx[seg + 3],
        y3 = cy[seg + 3];

      const t0 = 0;
      const t1 = t0 + centripetalKnot(x0, y0, x1, y1);
      const t2 = t1 + centripetalKnot(x1, y1, x2, y2);
      const t3 = t2 + centripetalKnot(x2, y2, x3, y3);

      const steps = seg === SEGMENTS_PER_LID - 1 ? DENSE_PER_SEGMENT + 1 : DENSE_PER_SEGMENT;
      for (let s = 0; s < steps; s++) {
        const u = s / DENSE_PER_SEGMENT;
        const t = t1 + u * (t2 - t1);
        const [px, py] = catmullRomEval(x0, y0, x1, y1, x2, y2, x3, y3, t0, t1, t2, t3, t);
        this.denseX[w] = px;
        this.denseY[w] = py;
        w++;
      }
    }
  }

  private resampleArcLength(): void {
    let total = 0;
    for (let i = 1; i < DENSE_COUNT; i++) {
      const d = Math.hypot(
        this.denseX[i] - this.denseX[i - 1],
        this.denseY[i] - this.denseY[i - 1],
      );
      this.segLen[i - 1] = d;
      total += d;
    }
    if (total < 1e-6) total = 1e-6;

    // Inset 5% from each corner (spec §6.1: root t in [0.05, 0.95]) so lash
    // roots don't spike into the canthus.
    const pad = 0.05;
    let acc = 0;
    let segIdx = 0;
    for (let k = 0; k < SPLINE_SAMPLES; k++) {
      const t = pad + (k / (SPLINE_SAMPLES - 1)) * (1 - 2 * pad);
      const target = total * t;
      while (segIdx < DENSE_COUNT - 2 && acc + this.segLen[segIdx] < target) {
        acc += this.segLen[segIdx];
        segIdx++;
      }
      const segLength = this.segLen[segIdx] || 1e-6;
      const local = Math.min(1, Math.max(0, (target - acc) / segLength));
      const ax = this.denseX[segIdx],
        ay = this.denseY[segIdx];
      const bx = this.denseX[segIdx + 1],
        by = this.denseY[segIdx + 1];
      this.splineX[k] = ax + (bx - ax) * local;
      this.splineY[k] = ay + (by - ay) * local;
      const tdx = bx - ax;
      const tdy = by - ay;
      const tm = Math.hypot(tdx, tdy) || 1;
      this.tangentX[k] = tdx / tm;
      this.tangentY[k] = tdy / tm;
    }
  }
}

function mustSlot(index: number): number {
  const slot = INDEX_TO_SLOT.get(index);
  if (slot == null) throw new Error(`landmark ${index} not tracked`);
  return slot;
}

// |P1-P0|^alpha with alpha=0.5 (centripetal), floored to avoid zero-length knots.
function centripetalKnot(x0: number, y0: number, x1: number, y1: number): number {
  const d = Math.hypot(x1 - x0, y1 - y0);
  return Math.sqrt(Math.max(d, 1e-4));
}

// Barry & Goldman's pyramidal evaluation of one centripetal Catmull-Rom segment.
function catmullRomEval(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number,
  t0: number,
  t1: number,
  t2: number,
  t3: number,
  t: number,
): [number, number] {
  const a1x = ((t1 - t) / (t1 - t0)) * x0 + ((t - t0) / (t1 - t0)) * x1;
  const a1y = ((t1 - t) / (t1 - t0)) * y0 + ((t - t0) / (t1 - t0)) * y1;
  const a2x = ((t2 - t) / (t2 - t1)) * x1 + ((t - t1) / (t2 - t1)) * x2;
  const a2y = ((t2 - t) / (t2 - t1)) * y1 + ((t - t1) / (t2 - t1)) * y2;
  const a3x = ((t3 - t) / (t3 - t2)) * x2 + ((t - t2) / (t3 - t2)) * x3;
  const a3y = ((t3 - t) / (t3 - t2)) * y2 + ((t - t2) / (t3 - t2)) * y3;

  const b1x = ((t2 - t) / (t2 - t0)) * a1x + ((t - t0) / (t2 - t0)) * a2x;
  const b1y = ((t2 - t) / (t2 - t0)) * a1y + ((t - t0) / (t2 - t0)) * a2y;
  const b2x = ((t3 - t) / (t3 - t1)) * a2x + ((t - t1) / (t3 - t1)) * a3x;
  const b2y = ((t3 - t) / (t3 - t1)) * a2y + ((t - t1) / (t3 - t1)) * a3y;

  const cx = ((t2 - t) / (t2 - t1)) * b1x + ((t - t1) / (t2 - t1)) * b2x;
  const cy = ((t2 - t) / (t2 - t1)) * b1y + ((t - t1) / (t2 - t1)) * b2y;
  return [cx, cy];
}

/**
 * Additional length foreshortening for the far eye under yaw, per spec §5:
 * linear in the eye-width ratio, capped at a 25% reduction.
 */
export function yawForeshorten(eyeWidth: number, otherEyeWidth: number): number {
  if (otherEyeWidth <= eyeWidth) return 1;
  return Math.max(YAW_FORESHORTEN_FLOOR, eyeWidth / otherEyeWidth);
}
