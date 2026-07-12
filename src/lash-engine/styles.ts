// Six launch styles, expressed as data (spec §6.2). `lengthProfile` and
// `flare` are typed as functions per the spec interface, but every style
// below builds them from a small named parameter object via the factories
// at the bottom of the file — no bespoke per-style code, just numbers.
export type LashStyle = {
  id: string;
  name: string;
  /** Lashes per eye at intensity 1.0. */
  lashCount: number;
  /** Fraction of eye width, by lid position t (0 = inner corner, 1 = outer corner). */
  lengthProfile: (t: number) => number;
  /** 0 (straight) - 1 (doll curl). */
  curl: number;
  /** Outward cant in radians, by lid position t. */
  flare: (t: number) => number;
  /** 0 = even spacing (classic single strands), 1 = grouped fans (volume). */
  clustering: number;
  /** Random spacing/length variation amount, seed-stable per session. */
  densityJitter: number;
  /** Stroke width in px at the reference eye width (W_ref, ~720p). */
  rootWidth: number;
  /** Per-style fine-tune offsets, config not code. */
  calibration: { yOffset: number; rootInset: number };
};

// `max` is the *absolute* peak length as a fraction of eye width (spec §6.2
// suggests ~0.25-0.45 for a natural-to-glam range; Mega Volume runs longer).
// `floor` is relative to max — e.g. floor=0.5 means the shortest lashes in
// the bank are half the peak length. A previous version of this file treated
// `floor` as the absolute minimum with the gaussian peaking at a fraction of
// 1.0 (i.e. up to 100% of eye width) — that was the bug that made lashes
// reach up into the eyebrows on-device; this version peaks at `max` instead.
type GaussParams = { peak: number; sigma: number; floor: number; max: number };
function gaussProfile({ peak, sigma, floor, max }: GaussParams): (t: number) => number {
  return (t: number) => {
    const d = (t - peak) / sigma;
    const g = Math.exp(-d * d);
    return max * (floor + (1 - floor) * g);
  };
}

type RampParams = { start: number; end: number; min: number; max: number };
function rampProfile({ start, end, min, max }: RampParams): (t: number) => number {
  return (t: number) => {
    if (t <= start) return min;
    if (t >= end) return max;
    const u = (t - start) / (end - start);
    // Smoothstep, so the ramp doesn't kink visibly where it starts.
    const s = u * u * (3 - 2 * u);
    return min + (max - min) * s;
  };
}

type FlareParams = { max: number; power: number };
function flareProfile({ max, power }: FlareParams): (t: number) => number {
  return (t: number) => max * Math.pow(Math.max(0, t), power);
}

// Parameter spread between styles is deliberately exaggerated (per on-device
// feedback: the first pass was ~3x too subtle to read as distinct styles at
// a glance) — lashCount, length, clustering, and rootWidth all vary sharply.
//
// lashCount and rootWidth below have the shipped tuning multipliers
// (lashCountMultiplier 0.95, rootWidthMultiplier 0.65) baked directly in, so
// they're the real defaults with zero debug overrides active. calibration
// is now a shared baseline across all six styles rather than varying per
// style (rootInset 2.0; yOffset 0 — see estimateAutoYOffset() in
// eye-geometry.ts, which supplies the actual per-face anchor and treats this
// field as a per-style delta on top of it, currently unused).
const ROOT_INSET_DEFAULT = 2.0;

export const LASH_STYLES: LashStyle[] = [
  {
    id: "classic",
    name: "Classic",
    lashCount: 38,
    lengthProfile: gaussProfile({ peak: 0.58, sigma: 0.34, floor: 0.55, max: 0.3 }),
    curl: 0.4,
    flare: flareProfile({ max: 0.12, power: 1.4 }),
    clustering: 0,
    densityJitter: 0.1,
    rootWidth: 2.08,
    calibration: { yOffset: 0, rootInset: ROOT_INSET_DEFAULT },
  },
  {
    id: "hybrid",
    name: "Hybrid",
    lashCount: 52,
    lengthProfile: gaussProfile({ peak: 0.58, sigma: 0.34, floor: 0.5, max: 0.36 }),
    curl: 0.5,
    flare: flareProfile({ max: 0.18, power: 1.3 }),
    clustering: 0.3,
    densityJitter: 0.12,
    rootWidth: 1.82,
    calibration: { yOffset: 0, rootInset: ROOT_INSET_DEFAULT },
  },
  {
    id: "volume",
    name: "Volume",
    lashCount: 67,
    lengthProfile: gaussProfile({ peak: 0.58, sigma: 0.36, floor: 0.5, max: 0.42 }),
    curl: 0.6,
    flare: flareProfile({ max: 0.22, power: 1.2 }),
    clustering: 0.6,
    densityJitter: 0.14,
    rootWidth: 1.43,
    calibration: { yOffset: 0, rootInset: ROOT_INSET_DEFAULT },
  },
  {
    id: "mega",
    name: "Mega Volume",
    lashCount: 86,
    lengthProfile: gaussProfile({ peak: 0.58, sigma: 0.38, floor: 0.55, max: 0.52 }),
    curl: 0.75,
    flare: flareProfile({ max: 0.28, power: 1.1 }),
    clustering: 0.95,
    densityJitter: 0.16,
    rootWidth: 1.17,
    calibration: { yOffset: 0, rootInset: ROOT_INSET_DEFAULT },
  },
  {
    id: "cat-eye",
    name: "Cat Eye",
    lashCount: 52,
    // Sharp ramp confined to the outer ~30% (t in [0.68, 0.97]) per spec §6.2 —
    // short and even everywhere else so the outer "flick" reads unmistakably.
    lengthProfile: rampProfile({ start: 0.68, end: 0.97, min: 0.2, max: 0.55 }),
    curl: 0.45,
    flare: flareProfile({ max: 0.6, power: 2.2 }),
    clustering: 0.35,
    densityJitter: 0.1,
    rootWidth: 1.69,
    calibration: { yOffset: 0, rootInset: ROOT_INSET_DEFAULT },
  },
  {
    id: "doll-eye",
    name: "Doll Eye",
    lashCount: 57,
    // Narrow, tall peak centered at t=0.5 (the widest part of the eye) per
    // spec §6.2 — noticeably rounder/shorter at the corners than Classic.
    lengthProfile: gaussProfile({ peak: 0.5, sigma: 0.18, floor: 0.4, max: 0.4 }),
    curl: 0.85,
    flare: flareProfile({ max: 0.08, power: 1.4 }),
    clustering: 0.4,
    densityJitter: 0.1,
    rootWidth: 1.69,
    calibration: { yOffset: 0, rootInset: ROOT_INSET_DEFAULT },
  },
];

export function styleById(id: string): LashStyle {
  return LASH_STYLES.find((s) => s.id === id) ?? LASH_STYLES[0];
}
