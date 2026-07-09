// Isolated lash rendering module — draws synthetic lash overlays for one eye.
// Real lash artwork (PNG/SVG) can later replace drawLashes without touching
// the anchoring pipeline in LashOverlay.tsx.
import type { LashStyle } from "@/lib/lash-styles";

export type Pt = { x: number; y: number };

// MediaPipe FaceLandmarker landmark indices for upper eyelids (outer -> inner)
// Left eye (subject's left; appears on right of image)
export const LEFT_UPPER = [263, 466, 388, 387, 386, 385, 384, 398, 362];
// Right eye
export const RIGHT_UPPER = [33, 246, 161, 160, 159, 158, 157, 173, 133];

export function drawLashesForEye(
  ctx: CanvasRenderingContext2D,
  points: Pt[],
  style: LashStyle,
  intensity: number, // 0.5 .. 1.5 multiplier
) {
  if (points.length < 3) return;

  // Order outer -> inner
  const outer = points[0];
  const inner = points[points.length - 1];
  const eyeWidth = Math.hypot(inner.x - outer.x, inner.y - outer.y);
  if (eyeWidth < 8) return;

  // Determine if this eye is on left or right side of image to bend flare
  const isLeftSideOfImage = outer.x > inner.x;

  const density = Math.max(12, Math.floor(style.render.density * intensity));
  const baseLength = style.render.baseLength * eyeWidth * intensity;

  ctx.save();
  ctx.strokeStyle = "rgba(15, 12, 10, 0.92)";
  ctx.lineCap = "round";
  // shadowBlur is a major mobile perf killer (per-stroke rasterisation).
  // Skip it — the dark stroke reads clearly against skin on its own.

  for (let i = 0; i < density; i++) {
    const t = i / (density - 1);
    // sample point along the upper lid via linear interpolation across segments
    const p = sampleAlongPolyline(points, t);
    const tangent = tangentAt(points, t);
    // normal points "up" away from eye (opposite of face-down direction)
    const nx = -tangent.y;
    const ny = tangent.x;
    // ensure normal points upward (negative y in screen space)
    const sign = ny < 0 ? 1 : -1;
    const normX = nx * sign;
    const normY = ny * sign;

    // length modulation: gaussian bump around flareCenter
    const center = isLeftSideOfImage
      ? 1 - style.render.flareCenter
      : style.render.flareCenter;
    const distFromPeak = Math.abs(t - center);
    const lengthFactor = Math.exp(-Math.pow(distFromPeak / 0.35, 2)) * 0.75 + 0.35;
    const len = baseLength * lengthFactor;

    // curl: bias tip toward outer corner slightly
    const curl = style.render.curl;
    const outerBias = isLeftSideOfImage ? -1 : 1;
    const tipX = p.x + normX * len + tangent.x * curl * len * 0.25 * outerBias;
    const tipY = p.y + normY * len + tangent.y * curl * len * 0.25 * outerBias;
    const midX = (p.x + tipX) / 2 + normX * len * 0.15;
    const midY = (p.y + tipY) / 2 + normY * len * 0.15;

    // fan (volume): draw multiple strands from same root
    const fans = style.render.fanWidth > 0 ? 3 : 1;
    const spread = style.render.fanWidth;
    for (let f = 0; f < fans; f++) {
      const off = fans === 1 ? 0 : (f / (fans - 1) - 0.5) * spread;
      const fx = tipX + tangent.x * off * len;
      const fy = tipY + tangent.y * off * len;
      const fmx = midX + tangent.x * off * len * 0.5;
      const fmy = midY + tangent.y * off * len * 0.5;
      ctx.lineWidth = Math.max(0.6, len * 0.045);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.quadraticCurveTo(fmx, fmy, fx, fy);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function sampleAlongPolyline(pts: Pt[], t: number): Pt {
  if (t <= 0) return pts[0];
  if (t >= 1) return pts[pts.length - 1];
  // total length
  let total = 0;
  const segLens: number[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const d = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
    segLens.push(d);
    total += d;
  }
  const target = total * t;
  let acc = 0;
  for (let i = 0; i < segLens.length; i++) {
    if (acc + segLens[i] >= target) {
      const local = (target - acc) / segLens[i];
      return {
        x: pts[i].x + (pts[i + 1].x - pts[i].x) * local,
        y: pts[i].y + (pts[i + 1].y - pts[i].y) * local,
      };
    }
    acc += segLens[i];
  }
  return pts[pts.length - 1];
}

function tangentAt(pts: Pt[], t: number): Pt {
  const eps = 0.02;
  const a = sampleAlongPolyline(pts, Math.max(0, t - eps));
  const b = sampleAlongPolyline(pts, Math.min(1, t + eps));
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: dx / len, y: dy / len };
}
