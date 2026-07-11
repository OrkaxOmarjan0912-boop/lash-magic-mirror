// Procedural lash rendering.
//
// Pipeline:
//   1. Read upper + lower eyelid landmarks (MediaPipe FaceMesh indices below).
//   2. Fit a Catmull-Rom spline through the upper lid — this is the lash line.
//   3. Sample N roots along the spline; at each root compute the local tangent
//      and outward normal (rotated by the eye's roll from corner-to-corner).
//   4. Compute lash length from the style's length profile, scaled by eye width.
//   5. Draw each lash as a tapered quadratic bezier (multi-pass, decreasing
//      width) with slight color / opacity jitter so strokes read as hair.
//   6. Blink handling: openness ratio compresses length, reduces opacity, and
//      folds the curl direction toward the tangent so lashes never float over
//      a closed lid.

import type { LashStyle, LengthProfile } from "@/lib/lash-styles";

export type Pt = { x: number; y: number };

// FaceMesh landmark indices — verified from MediaPipe FACEMESH_LIPS/EYES map.
// Ordered inner corner -> outer corner for consistent parametrisation.
export const RIGHT_UPPER_LID = [133, 173, 157, 158, 159, 160, 161, 246, 33];
export const RIGHT_LOWER_LID = [133, 155, 154, 153, 145, 144, 163, 7, 33];
export const LEFT_UPPER_LID = [362, 398, 384, 385, 386, 387, 388, 466, 263];
export const LEFT_LOWER_LID = [362, 382, 381, 380, 374, 373, 390, 249, 263];

// Landmarks used for eye openness (upper-mid / lower-mid vertical distance).
export const RIGHT_LID_MID = { upper: 159, lower: 145 };
export const LEFT_LID_MID = { upper: 386, lower: 374 };

export type EyeSide = "left" | "right";

export type RenderContext = {
  ctx: CanvasRenderingContext2D;
  landmarks: Pt[]; // absolute pixel coords already mirrored + scaled
  style: LashStyle;
  intensity: number;
  side: EyeSide;
  canvasWidth: number;
  canvasHeight: number;
  debug?: boolean;
  eyeWidthRef?: number; // reference eye width to detect yaw foreshortening
  ambientLuma?: number; // 0..1; when low we bump opacity
};

// ---------------- spline ----------------
// Uniform Catmull-Rom, samples includes both endpoints.
function catmullRom(pts: Pt[], samplesPerSegment: number): Pt[] {
  if (pts.length < 2) return pts.slice();
  const out: Pt[] = [];
  const n = pts.length;
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const steps = i === n - 2 ? samplesPerSegment + 1 : samplesPerSegment;
    for (let s = 0; s < steps; s++) {
      const t = s / samplesPerSegment;
      const t2 = t * t;
      const t3 = t2 * t;
      const x =
        0.5 *
        (2 * p1.x +
          (-p0.x + p2.x) * t +
          (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
          (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
      const y =
        0.5 *
        (2 * p1.y +
          (-p0.y + p2.y) * t +
          (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
          (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);
      out.push({ x, y });
    }
  }
  return out;
}

function polylineLength(pts: Pt[]) {
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  }
  return total;
}

// Sample N evenly-spaced points (by arc length) along the spline.
// Returns roots + local tangents (unit vectors).
function arcResample(spline: Pt[], count: number): { p: Pt; tan: Pt }[] {
  const out: { p: Pt; tan: Pt }[] = [];
  const segLen: number[] = [];
  let total = 0;
  for (let i = 1; i < spline.length; i++) {
    const d = Math.hypot(spline[i].x - spline[i - 1].x, spline[i].y - spline[i - 1].y);
    segLen.push(d);
    total += d;
  }
  if (total === 0) return out;
  // Skip the very inner/outer 4% so lashes don't spike into the corners.
  const pad = 0.05;
  for (let k = 0; k < count; k++) {
    const t = pad + (k / (count - 1)) * (1 - 2 * pad);
    const target = total * t;
    let acc = 0;
    for (let i = 0; i < segLen.length; i++) {
      if (acc + segLen[i] >= target || i === segLen.length - 1) {
        const local = segLen[i] === 0 ? 0 : (target - acc) / segLen[i];
        const a = spline[i];
        const b = spline[i + 1];
        const p = { x: a.x + (b.x - a.x) * local, y: a.y + (b.y - a.y) * local };
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const m = Math.hypot(dx, dy) || 1;
        out.push({ p, tan: { x: dx / m, y: dy / m } });
        break;
      }
      acc += segLen[i];
    }
  }
  return out;
}

function evalProfile(profile: LengthProfile, t: number): number {
  if (profile.kind === "gauss") {
    const d = (t - profile.peak) / profile.sigma;
    const g = Math.exp(-d * d);
    return profile.floor + (1 - profile.floor) * g;
  }
  if (t <= profile.start) return profile.floor;
  if (t >= profile.end) return 1;
  const u = (t - profile.start) / (profile.end - profile.start);
  return profile.floor + (1 - profile.floor) * u;
}

// Deterministic hash-based noise in [-1, 1] so lashes don't shimmer.
function jitter(seed: number): number {
  const s = Math.sin(seed * 12.9898) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
}

// -------- eye openness --------
export function eyeOpenness(
  landmarks: Pt[],
  side: EyeSide,
): { openness: number; eyeWidth: number; corners: [Pt, Pt] } {
  const upperIdx = side === "left" ? LEFT_UPPER_LID : RIGHT_UPPER_LID;
  const lowerIdx = side === "left" ? LEFT_LOWER_LID : RIGHT_LOWER_LID;
  const inner = landmarks[upperIdx[0]];
  const outer = landmarks[upperIdx[upperIdx.length - 1]];
  const eyeWidth = Math.hypot(outer.x - inner.x, outer.y - inner.y);
  const midU = side === "left" ? landmarks[LEFT_LID_MID.upper] : landmarks[RIGHT_LID_MID.upper];
  const midL = side === "left" ? landmarks[LEFT_LID_MID.lower] : landmarks[RIGHT_LID_MID.lower];
  // Cross-check with the whole polygon: use max vertical extent between upper/lower
  let maxGap = 0;
  for (let i = 1; i < upperIdx.length - 1; i++) {
    const u = landmarks[upperIdx[i]];
    const l = landmarks[lowerIdx[i]];
    const g = Math.hypot(u.x - l.x, u.y - l.y);
    if (g > maxGap) maxGap = g;
  }
  const gap = Math.max(Math.hypot(midU.x - midL.x, midU.y - midL.y), maxGap);
  // ~0.33 open, ~0.05 closed in practice.
  const openness = Math.max(0, Math.min(1, (gap / (eyeWidth || 1) - 0.05) / 0.28));
  return { openness, eyeWidth, corners: [inner, outer] };
}

// -------- main draw --------
export function drawLashes(rc: RenderContext) {
  const { ctx, landmarks, style, intensity, side } = rc;
  const upperIdx = side === "left" ? LEFT_UPPER_LID : RIGHT_UPPER_LID;

  const upperPts: Pt[] = upperIdx.map((i) => ({ x: landmarks[i].x, y: landmarks[i].y }));
  if (upperPts.length < 4) return;

  const { openness, eyeWidth, corners } = eyeOpenness(landmarks, side);
  if (eyeWidth < 10) return;

  const spline = catmullRom(upperPts, 6);
  if (polylineLength(spline) < 8) return;

  const r = style.render;

  // Yaw foreshortening: shrink far-eye length by comparing to reference.
  let yawScale = 1;
  if (rc.eyeWidthRef && rc.eyeWidthRef > eyeWidth) {
    yawScale = Math.max(0.55, eyeWidth / rc.eyeWidthRef);
  }

  const count = Math.max(14, Math.round(r.count * intensity));
  const baseLen = r.lengthRatio * eyeWidth * intensity * yawScale;

  // Eye roll from corner-to-corner. inner=corners[0], outer=corners[1]
  const inner = corners[0];
  const outer = corners[1];
  const eyeDX = outer.x - inner.x;
  const eyeDY = outer.y - inner.y;
  const eyeLen = Math.hypot(eyeDX, eyeDY) || 1;
  // Upward normal in eye-local coords: perpendicular to corner axis, pointing
  // away from the mouth. Use vertical component sign to disambiguate.
  const perpX = -eyeDY / eyeLen;
  const perpY = eyeDX / eyeLen;
  const upSign = perpY < 0 ? 1 : -1; // want negative y (screen-up)
  const eyeUp = { x: perpX * upSign, y: perpY * upSign };

  // "outer" direction along corner axis (used for flare bias)
  const outerDir = { x: eyeDX / eyeLen, y: eyeDY / eyeLen };

  const roots = arcResample(spline, count);

  // Blink dynamics
  const blinkFactor = Math.pow(Math.max(0, Math.min(1, openness / 0.6)), 0.9);
  const lengthMul = 0.35 + 0.65 * blinkFactor; // shortens as lid closes
  const opacityMul = 0.25 + 0.75 * blinkFactor;
  const curlMul = 0.15 + 0.85 * blinkFactor; // curl flattens on close

  // Vertical calibration (nudges the whole lash bank up/down)
  const vOffset = r.verticalOffset * eyeWidth;

  // Visibility boost — bump opacity in dim scenes.
  const ambientBoost = rc.ambientLuma != null && rc.ambientLuma < 0.35
    ? 1 + (0.35 - rc.ambientLuma) * 1.2
    : 1;

  // Draw a subtle lash-line shadow first (grounds the lashes)
  ctx.save();
  ctx.strokeStyle = `rgba(20, 12, 12, ${0.28 * opacityMul})`;
  ctx.lineWidth = Math.max(1.5, eyeWidth * 0.018);
  ctx.lineCap = "round";
  ctx.beginPath();
  for (let i = 0; i < spline.length; i++) {
    const p = spline[i];
    if (i === 0) ctx.moveTo(p.x, p.y + vOffset);
    else ctx.lineTo(p.x, p.y + vOffset);
  }
  ctx.stroke();
  ctx.restore();

  // Scale stroke width with canvas resolution (baseline 720p short edge)
  const resScale = Math.max(1, Math.min(rc.canvasWidth, rc.canvasHeight) / 720);
  const rootWidth0 = Math.max(1.4, r.thickness * 1.9 * resScale);

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  for (let i = 0; i < roots.length; i++) {
    const t = i / (roots.length - 1);
    const { p, tan } = roots[i];

    // Local outward normal — use eye-axis-based up so lashes tilt with head.
    // Blend spline normal with eye-up to keep anatomical direction on curved lids.
    const splineN = { x: -tan.y, y: tan.x };
    const dot = splineN.x * eyeUp.x + splineN.y * eyeUp.y;
    const nSign = dot < 0 ? -1 : 1;
    const nx = splineN.x * nSign * 0.6 + eyeUp.x * 0.4;
    const ny = splineN.y * nSign * 0.6 + eyeUp.y * 0.4;
    const nMag = Math.hypot(nx, ny) || 1;
    const normX = nx / nMag;
    const normY = ny / nMag;

    // Root position, nudged slightly into the lid.
    const rx = p.x - normX * r.rootInset * resScale + 0;
    const ry = p.y - normY * r.rootInset * resScale + vOffset;

    // arcResample walks inner->outer for both eyes (indices are ordered
    // that way), so profile.peak=0.9 means "near outer corner" on both.
    const profileT = t;
    const lenFactor = evalProfile(r.profile, profileT);
    const jit = 1 + 0.12 * jitter(i * 3.17 + (side === "left" ? 0.5 : 0));
    const len = baseLen * lenFactor * lengthMul * jit;
    if (len < 2) continue;

    // Curl + flare: tip = root + normal*len + tangent*flareOffset + upward curl hook
    const flareBias = (profileT - 0.5) * 2; // -1 inner .. +1 outer
    const flareOff = r.flare * flareBias * len * 0.35;
    const curlAmt = r.curl * curlMul;

    // Tip: mostly along normal, biased toward outer corner
    const tipBaseX = rx + normX * len + outerDir.x * flareOff;
    const tipBaseY = ry + normY * len + outerDir.y * flareOff;
    // Curl hook: pull tip slightly further along up direction
    const tipX = tipBaseX + eyeUp.x * curlAmt * len * 0.28;
    const tipY = tipBaseY + eyeUp.y * curlAmt * len * 0.28;

    // Control point: bulge outward (up) for curl
    const midX = (rx + tipX) / 2 + eyeUp.x * curlAmt * len * 0.22;
    const midY = (ry + tipY) / 2 + eyeUp.y * curlAmt * len * 0.22;

    // Fan: multiple strands radiating from same root
    const fans = Math.max(1, r.fan);
    for (let f = 0; f < fans; f++) {
      const fOff = fans === 1 ? 0 : (f / (fans - 1) - 0.5);
      const spread = r.fanSpread;
      const ftipX = tipX + tan.x * fOff * len * spread;
      const ftipY = tipY + tan.y * fOff * len * spread;
      const fmidX = midX + tan.x * fOff * len * spread * 0.55;
      const fmidY = midY + tan.y * fOff * len * spread * 0.55;

      const opacity =
        (0.75 + 0.2 * (jitter(i * 7.13 + f * 2.7) * 0.5 + 0.5)) *
        opacityMul *
        Math.min(1.05, ambientBoost);

      // Tapered stroke: draw the same quadratic 3 times with decreasing width
      // and slight endpoint pull-in — cheap fake of a hair-like taper.
      const passes = 3;
      for (let pass = 0; pass < passes; pass++) {
        const shrink = pass / passes; // 0, .33, .66
        const w = rootWidth0 * (1 - shrink * 0.55) * (1 + (r.thickness - 1) * 0.2);
        // pull the tip toward mid on each subsequent pass to fake taper
        const px = ftipX * (1 - shrink * 0.35) + fmidX * (shrink * 0.35);
        const py = ftipY * (1 - shrink * 0.35) + fmidY * (shrink * 0.35);
        ctx.strokeStyle = `rgba(18, 14, 16, ${opacity * (1 - shrink * 0.15)})`;
        ctx.lineWidth = w;
        ctx.beginPath();
        ctx.moveTo(rx, ry);
        ctx.quadraticCurveTo(fmidX, fmidY, px, py);
        ctx.stroke();
      }
    }
  }
  ctx.restore();

  if (rc.debug) {
    // Draw spline in cyan and landmarks in magenta
    ctx.save();
    ctx.strokeStyle = "#00e5ff";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    spline.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.stroke();
    ctx.fillStyle = "#ff2ea6";
    for (const idx of upperIdx) {
      const p = landmarks[idx];
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "#ffd166";
    ctx.beginPath();
    ctx.arc(inner.x, inner.y, 3, 0, Math.PI * 2);
    ctx.arc(outer.x, outer.y, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}
