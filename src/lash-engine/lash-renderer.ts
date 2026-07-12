// Procedural per-lash renderer (spec §6). Draws a lash-line shadow along the
// live lid spline, then one tapered filled polygon per lash — never a
// uniform-width stroke. Blink behavior folds direction/opacity continuously
// from eye openness so lashes ride the lid down and never float.
//
// Per-lash layout (root position, fan grouping, and jitter) is precomputed
// once per (eye side, style) pair and cached; the render loop only reads
// those cached typed arrays and issues canvas path/fill calls with plain
// numbers, so steady-state rendering allocates nothing on the JS heap.
import type { LashStyle } from "./styles";
import type { EyeGeometry } from "./eye-geometry";
import { SPLINE_SAMPLES, estimateAutoYOffset } from "./eye-geometry";

const LASH_COLOR_R = 0x1a;
const LASH_COLOR_G = 0x1a;
const LASH_COLOR_B = 0x1a;

// Reference eye width the style.rootWidth / tip-width constants are calibrated
// against (spec §6.1: "~2.5px @ 720p"), so strokes scale with actual eye size.
const W_REF = 110;
const TIP_WIDTH_REF = 0.6;

const BEZIER_SAMPLES = 6; // resolution of the tapered polygon per lash
const MAX_FAN_PER_CLUSTER = 5;

const LOW_LIGHT_THRESHOLD = 0.35;
// Shipped defaults, locked in from on-device tuning. alphaFloor is the
// *good-light* baseline — see the low-light blend in render() below, which
// still ramps up toward spec §6.5's 0.9 target regardless of this value, so
// a low daylight floor here can't make lashes vanish in a dark room.
const DEFAULT_ALPHA_FLOOR = 0.53;
const LOW_LIGHT_ALPHA_TARGET = 0.9; // spec §6.5

// Live-tunable overrides, wired up from the debug harness (spec §10 —
// "per-style calibration offsets adjustable via config... without rebuild",
// extended here to cover the params on-device testing needed to dial in).
export type DebugOverrides = {
  yOffset?: number; // replaces style.calibration.yOffset (fraction of eye width)
  rootInset?: number; // replaces style.calibration.rootInset
  rootWidthMul?: number; // multiplies style.rootWidth
  alphaFloorOverride?: number; // replaces the computed ambient-based alpha floor
  lashCountMul?: number; // multiplies style.lashCount when building slots
};

type LashSlots = {
  count: number;
  t: Float64Array; // spline parameter [0,1], shared root position within a cluster
  fanAngle: Float64Array; // extra rotation (radians) for this strand within its cluster
  lengthJitter: Float64Array; // multiplier, session-stable per lash
  angleJitter: Float64Array; // radians, session-stable per-lash direction noise
  alphaJitter: Float64Array; // stable per lash, so strokes don't shimmer
};

function hash01(seed: number): number {
  const s = Math.sin(seed) * 43758.5453123;
  return s - Math.floor(s);
}

function buildSlots(
  style: LashStyle,
  sessionSeed: number,
  sideSalt: number,
  lashCountMul: number,
): LashSlots {
  const n = Math.max(4, Math.round(style.lashCount * lashCountMul));
  const fansPerCluster = Math.min(
    MAX_FAN_PER_CLUSTER,
    Math.max(1, 1 + Math.round(style.clustering * 4)),
  );
  const numClusters = Math.max(1, Math.ceil(n / fansPerCluster));
  const total = numClusters * fansPerCluster;

  const slots: LashSlots = {
    count: total,
    t: new Float64Array(total),
    fanAngle: new Float64Array(total),
    lengthJitter: new Float64Array(total),
    angleJitter: new Float64Array(total),
    alphaJitter: new Float64Array(total),
  };

  const pad = 0.06; // keep clusters off the very corners, echoing the spline's own inset
  const clusterSpacing = numClusters > 1 ? (1 - 2 * pad) / (numClusters - 1) : 0;
  const maxFanSpreadRad = 0.1 + 0.3 * style.clustering;

  let i = 0;
  for (let c = 0; c < numClusters; c++) {
    const baseSeed = sessionSeed + sideSalt + c * 17.31;
    const tJitter =
      style.densityJitter * (clusterSpacing || 1) * 0.5 * (hash01(baseSeed * 3.1) * 2 - 1);
    const clusterT = Math.min(1, Math.max(0, pad + c * clusterSpacing + tJitter));

    for (let f = 0; f < fansPerCluster; f++) {
      const fanFrac = fansPerCluster === 1 ? 0 : f / (fansPerCluster - 1) - 0.5;
      slots.t[i] = clusterT;
      slots.fanAngle[i] = fanFrac * maxFanSpreadRad;
      // Wider spread than the spec's literal +/-8% (on-device feedback: the
      // set read as a single rigid stamped shape at 8%; this is deliberately
      // more organic-looking).
      slots.lengthJitter[i] = 1 + 0.22 * (hash01(baseSeed * 7.7 + f * 1.91) * 2 - 1);
      slots.angleJitter[i] = 0.16 * (hash01(baseSeed * 11.3 + f * 2.63) * 2 - 1);
      slots.alphaJitter[i] = 0.88 + 0.12 * hash01(baseSeed * 5.13 + f * 3.37);
      i++;
    }
  }

  return slots;
}

/** Evaluates the live lid spline (and its tangent) at an arbitrary t in [0,1]. */
function sampleSpline(
  geometry: EyeGeometry,
  t: number,
  out: { x: number; y: number; tanX: number; tanY: number },
): void {
  const u = Math.min(1, Math.max(0, t)) * (SPLINE_SAMPLES - 1);
  const i0 = Math.floor(u);
  const i1 = Math.min(SPLINE_SAMPLES - 1, i0 + 1);
  const f = u - i0;
  out.x = geometry.splineX[i0] + (geometry.splineX[i1] - geometry.splineX[i0]) * f;
  out.y = geometry.splineY[i0] + (geometry.splineY[i1] - geometry.splineY[i0]) * f;
  out.tanX = geometry.tangentX[i0] + (geometry.tangentX[i1] - geometry.tangentX[i0]) * f;
  out.tanY = geometry.tangentY[i0] + (geometry.tangentY[i1] - geometry.tangentY[i0]) * f;
}

export type RenderParams = {
  ctx: CanvasRenderingContext2D;
  geometry: EyeGeometry;
  style: LashStyle;
  intensity: number;
  otherEyeWidth: number;
  yawScale: number; // from yawForeshorten(), already computed by caller
  ambientLuma: number; // 0..1
  /** Fraction of precomputed lash slots to actually draw (perf degradation ladder step 2). */
  quality: number;
  /** Overall opacity multiplier from tracking-loss fade (spec §4). */
  fadeOpacity: number;
  debug: boolean;
  debugOverrides?: DebugOverrides;
};

export class LashRenderer {
  private cache = new Map<string, LashSlots>();
  private sessionSeed: number;

  // Scratch reused across every lash draw call — no per-lash allocation.
  private leftX = new Float64Array(BEZIER_SAMPLES);
  private leftY = new Float64Array(BEZIER_SAMPLES);
  private rightX = new Float64Array(BEZIER_SAMPLES);
  private rightY = new Float64Array(BEZIER_SAMPLES);
  private sampleScratch = { x: 0, y: 0, tanX: 0, tanY: 0 };

  constructor(sessionSeed = Math.random() * 1000) {
    this.sessionSeed = sessionSeed;
  }

  private slotsFor(side: "left" | "right", style: LashStyle, lashCountMul: number): LashSlots {
    const key = `${side}:${style.id}:${style.lashCount}:${style.clustering}:${style.densityJitter}:${lashCountMul}`;
    let slots = this.cache.get(key);
    if (!slots) {
      slots = buildSlots(style, this.sessionSeed, side === "left" ? 0 : 1000, lashCountMul);
      this.cache.set(key, slots);
    }
    return slots;
  }

  render(p: RenderParams): void {
    const { ctx, geometry, style, intensity } = p;
    if (!geometry.valid) return;

    const overrides = p.debugOverrides;
    const resScale = geometry.eyeWidth / W_REF;
    const openness = geometry.openness;

    const darkFactor =
      p.ambientLuma < LOW_LIGHT_THRESHOLD
        ? Math.min(1, (LOW_LIGHT_THRESHOLD - p.ambientLuma) / LOW_LIGHT_THRESHOLD)
        : 0;
    // Blends from the good-light baseline (override, or the shipped default)
    // up to spec §6.5's 0.9 low-light target as the scene darkens — the
    // low-light guarantee holds regardless of how low the daylight baseline
    // is tuned, rather than being replaced outright by an override.
    const baseAlphaFloor = overrides?.alphaFloorOverride ?? DEFAULT_ALPHA_FLOOR;
    const alphaFloor = baseAlphaFloor + (LOW_LIGHT_ALPHA_TARGET - baseAlphaFloor) * darkFactor;
    const shadowAlphaBase = 0.35 + 0.12 * darkFactor; // -> up to ~0.47 in low light

    // Blink envelope (spec §6.4), continuous everywhere:
    //  - curl scales directly with openness
    //  - below o=0.25, direction folds toward horizontal/downward and opacity
    //    eases toward a 60% floor, both ramped smoothly to avoid any pop.
    const curlMul = Math.min(1, Math.max(0, openness));
    const closeFold = Math.min(1, Math.max(0, 1 - openness / 0.25));
    const blinkOpacityMul = 1 - 0.4 * closeFold;

    this.drawShadow(ctx, geometry, shadowAlphaBase * blinkOpacityMul * p.fadeOpacity, resScale);

    const quality = Math.min(1, Math.max(0, p.quality));
    const slots = this.slotsFor(geometry.side, style, overrides?.lashCountMul ?? 1);
    const drawCount = Math.max(1, Math.round(slots.count * quality));
    // When degraded, drop a stride of lashes rather than always chopping off
    // one end of the lid, so the reduction reads as thinner, not lopsided.
    const stride = slots.count / drawCount;
    // Skip the feathered-edge halo pass under FPS degradation (perf ladder);
    // full quality always draws it for the softer, hair-like edge.
    const feather = quality >= 1;

    ctx.fillStyle = `rgb(${LASH_COLOR_R}, ${LASH_COLOR_G}, ${LASH_COLOR_B})`;

    for (let k = 0; k < drawCount; k++) {
      const i = Math.min(slots.count - 1, Math.round(k * stride));
      this.drawLash(ctx, geometry, style, slots, i, {
        intensity,
        yawScale: p.yawScale,
        resScale,
        curlMul,
        closeFold,
        alphaFloor,
        blinkOpacityMul,
        fadeOpacity: p.fadeOpacity,
        feather,
        overrides,
      });
    }

    if (p.debug) this.drawDebug(ctx, geometry);
  }

  private drawShadow(
    ctx: CanvasRenderingContext2D,
    geometry: EyeGeometry,
    alpha: number,
    resScale: number,
  ): void {
    if (alpha <= 0.002) return;
    ctx.save();
    ctx.strokeStyle = `rgba(20, 16, 16, ${alpha})`;
    ctx.lineWidth = Math.max(1.2, 2 * resScale);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    for (let i = 0; i < SPLINE_SAMPLES; i++) {
      const x = geometry.splineX[i];
      const y = geometry.splineY[i];
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  private drawLash(
    ctx: CanvasRenderingContext2D,
    geometry: EyeGeometry,
    style: LashStyle,
    slots: LashSlots,
    i: number,
    opts: {
      intensity: number;
      yawScale: number;
      resScale: number;
      curlMul: number;
      closeFold: number;
      alphaFloor: number;
      blinkOpacityMul: number;
      fadeOpacity: number;
      feather: boolean;
      overrides?: DebugOverrides;
    },
  ): void {
    const t = slots.t[i];
    const s = this.sampleScratch;
    sampleSpline(geometry, t, s);

    const rootInsetBase = opts.overrides?.rootInset ?? style.calibration.rootInset;
    // yOffset: an explicit debug override always wins; otherwise auto-calibrate
    // per face from geometry already being measured (see estimateAutoYOffset),
    // plus this style's own fine-tune delta on top (spec §6.2 calibration).
    const yOffsetBase =
      opts.overrides?.yOffset ?? estimateAutoYOffset(geometry) + style.calibration.yOffset;
    const rootInset = rootInsetBase * opts.resScale;
    const yOffset = yOffsetBase * geometry.eyeWidth;

    // Base outward direction: blend the spline's local normal with the eye's
    // own up-axis so lashes stay anatomically "up" even on sharply curved
    // parts of the lid, matching how real lash lines read.
    let normX = -s.tanY;
    let normY = s.tanX;
    if (normX * geometry.upX + normY * geometry.upY < 0) {
      normX = -normX;
      normY = -normY;
    }
    let dirX = normX * 0.6 + geometry.upX * 0.4;
    let dirY = normY * 0.6 + geometry.upY * 0.4;
    const dirMag = Math.hypot(dirX, dirY) || 1;
    dirX /= dirMag;
    dirY /= dirMag;

    // Blink fold: blend toward a mostly-tangent, slightly-downward direction
    // as the eye closes, so lashes settle against the lower lid instead of
    // floating outward.
    if (opts.closeFold > 0) {
      let foldX = s.tanX * 0.7 - geometry.upX * 0.3;
      let foldY = s.tanY * 0.7 - geometry.upY * 0.3;
      const foldMag = Math.hypot(foldX, foldY) || 1;
      foldX /= foldMag;
      foldY /= foldMag;
      dirX = dirX + (foldX - dirX) * opts.closeFold;
      dirY = dirY + (foldY - dirY) * opts.closeFold;
      const m = Math.hypot(dirX, dirY) || 1;
      dirX /= m;
      dirY /= m;
    }

    // Flare: rotate the direction toward the eye's inner->outer axis by
    // style.flare(t) radians, so lashes cant toward the temple. The rotation
    // sign is derived from the cross product so it's correct regardless of
    // which eye (and which way "outer" points in pixel space) this is.
    const flareRad = style.flare(t);
    const cross = dirX * geometry.axisY - dirY * geometry.axisX;
    const flareSigned = flareRad * (cross >= 0 ? 1 : -1);
    // Plus a tiny stable per-lash wobble and this strand's fan spread.
    const totalRot = flareSigned + slots.angleJitter[i] + slots.fanAngle[i];
    const cosA = Math.cos(totalRot);
    const sinA = Math.sin(totalRot);
    const rotX = dirX * cosA - dirY * sinA;
    const rotY = dirX * sinA + dirY * cosA;

    const rootX = s.x - normX * rootInset;
    const rootY = s.y - normY * rootInset + yOffset;

    const length =
      geometry.eyeWidth *
      style.lengthProfile(t) *
      opts.intensity *
      opts.yawScale *
      slots.lengthJitter[i];
    if (length < 1.5) return;

    const curlAmt = style.curl * opts.curlMul;
    const tipX = rootX + rotX * length;
    const tipY = rootY + rotY * length;
    // Control point bulges toward "up" for the curl hook.
    const ctrlX = rootX + rotX * length * 0.55 + geometry.upX * curlAmt * length * 0.4;
    const ctrlY = rootY + rotY * length * 0.55 + geometry.upY * curlAmt * length * 0.4;

    const rootWidthMul = opts.overrides?.rootWidthMul ?? 1;
    const rootHalfWidth = (style.rootWidth * rootWidthMul * opts.resScale) / 2;
    const tipHalfWidth = (TIP_WIDTH_REF * rootWidthMul * opts.resScale) / 2;

    const alpha =
      Math.max(opts.alphaFloor, slots.alphaJitter[i]) * opts.blinkOpacityMul * opts.fadeOpacity;

    this.fillTaperedLash(
      ctx,
      rootX,
      rootY,
      ctrlX,
      ctrlY,
      tipX,
      tipY,
      rootHalfWidth,
      tipHalfWidth,
      alpha,
      opts.feather,
    );
  }

  private fillTaperedLash(
    ctx: CanvasRenderingContext2D,
    rootX: number,
    rootY: number,
    ctrlX: number,
    ctrlY: number,
    tipX: number,
    tipY: number,
    rootHalfWidth: number,
    tipHalfWidth: number,
    alpha: number,
    feather: boolean,
  ): void {
    // Feathered edge (spec §6.3): a wider, low-alpha halo pass underneath the
    // crisp core so the tapered polygon's silhouette reads as soft/hair-like
    // instead of a hard-edged printed shape. Skipped under FPS degradation.
    if (feather) {
      this.fillTaperedPolygon(
        ctx,
        rootX,
        rootY,
        ctrlX,
        ctrlY,
        tipX,
        tipY,
        rootHalfWidth + 0.9,
        tipHalfWidth + 0.5,
        alpha * 0.32,
      );
    }
    this.fillTaperedPolygon(
      ctx,
      rootX,
      rootY,
      ctrlX,
      ctrlY,
      tipX,
      tipY,
      rootHalfWidth,
      tipHalfWidth,
      alpha,
    );
  }

  private fillTaperedPolygon(
    ctx: CanvasRenderingContext2D,
    rootX: number,
    rootY: number,
    ctrlX: number,
    ctrlY: number,
    tipX: number,
    tipY: number,
    rootHalfWidth: number,
    tipHalfWidth: number,
    alpha: number,
  ): void {
    const K = BEZIER_SAMPLES;
    for (let k = 0; k < K; k++) {
      const t = k / (K - 1);
      const mt = 1 - t;
      const bx = mt * mt * rootX + 2 * mt * t * ctrlX + t * t * tipX;
      const by = mt * mt * rootY + 2 * mt * t * ctrlY + t * t * tipY;
      let dx = 2 * mt * (ctrlX - rootX) + 2 * t * (tipX - ctrlX);
      let dy = 2 * mt * (ctrlY - rootY) + 2 * t * (tipY - ctrlY);
      const dm = Math.hypot(dx, dy) || 1;
      dx /= dm;
      dy /= dm;
      const nx = -dy;
      const ny = dx;
      const hw = rootHalfWidth + (tipHalfWidth - rootHalfWidth) * t;
      this.leftX[k] = bx + nx * hw;
      this.leftY[k] = by + ny * hw;
      this.rightX[k] = bx - nx * hw;
      this.rightY[k] = by - ny * hw;
    }

    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.moveTo(this.leftX[0], this.leftY[0]);
    for (let k = 1; k < K; k++) ctx.lineTo(this.leftX[k], this.leftY[k]);
    for (let k = K - 1; k >= 0; k--) ctx.lineTo(this.rightX[k], this.rightY[k]);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  private drawDebug(ctx: CanvasRenderingContext2D, geometry: EyeGeometry): void {
    ctx.save();
    ctx.strokeStyle = "#00e5ff";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let i = 0; i < SPLINE_SAMPLES; i++) {
      const x = geometry.splineX[i];
      const y = geometry.splineY[i];
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    ctx.fillStyle = "#ffd166";
    ctx.beginPath();
    ctx.arc(geometry.innerX, geometry.innerY, 3, 0, Math.PI * 2);
    ctx.arc(geometry.outerX, geometry.outerY, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}
