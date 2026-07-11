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

type GaussParams = { peak: number; sigma: number; floor: number };
function gaussProfile({ peak, sigma, floor }: GaussParams): (t: number) => number {
  return (t: number) => {
    const d = (t - peak) / sigma;
    const g = Math.exp(-d * d);
    return floor + (1 - floor) * g;
  };
}

type RampParams = { start: number; end: number; floor: number };
function rampProfile({ start, end, floor }: RampParams): (t: number) => number {
  return (t: number) => {
    if (t <= start) return floor;
    if (t >= end) return 1;
    const u = (t - start) / (end - start);
    // Smoothstep, so the ramp doesn't kink visibly where it starts.
    const s = u * u * (3 - 2 * u);
    return floor + (1 - floor) * s;
  };
}

type FlareParams = { max: number; power: number };
function flareProfile({ max, power }: FlareParams): (t: number) => number {
  return (t: number) => max * Math.pow(Math.max(0, t), power);
}

export const LASH_STYLES: LashStyle[] = [
  {
    id: "classic",
    name: "Classic",
    lashCount: 46,
    lengthProfile: gaussProfile({ peak: 0.58, sigma: 0.34, floor: 0.58 }),
    curl: 0.5,
    flare: flareProfile({ max: 0.16, power: 1.4 }),
    clustering: 0,
    densityJitter: 0.08,
    rootWidth: 2.6,
    calibration: { yOffset: -0.006, rootInset: 0.4 },
  },
  {
    id: "hybrid",
    name: "Hybrid",
    lashCount: 54,
    lengthProfile: gaussProfile({ peak: 0.58, sigma: 0.34, floor: 0.58 }),
    curl: 0.58,
    flare: flareProfile({ max: 0.22, power: 1.3 }),
    clustering: 0.35,
    densityJitter: 0.1,
    rootWidth: 2.3,
    calibration: { yOffset: -0.007, rootInset: 0.45 },
  },
  {
    id: "volume",
    name: "Volume",
    lashCount: 40,
    lengthProfile: gaussProfile({ peak: 0.58, sigma: 0.36, floor: 0.6 }),
    curl: 0.65,
    flare: flareProfile({ max: 0.26, power: 1.2 }),
    clustering: 0.65,
    densityJitter: 0.12,
    rootWidth: 1.9,
    calibration: { yOffset: -0.009, rootInset: 0.55 },
  },
  {
    id: "mega",
    name: "Mega Volume",
    lashCount: 36,
    lengthProfile: gaussProfile({ peak: 0.58, sigma: 0.38, floor: 0.64 }),
    curl: 0.72,
    flare: flareProfile({ max: 0.32, power: 1.1 }),
    clustering: 0.9,
    densityJitter: 0.14,
    rootWidth: 1.6,
    calibration: { yOffset: -0.011, rootInset: 0.65 },
  },
  {
    id: "cat-eye",
    name: "Cat Eye",
    lashCount: 50,
    // Ramps up over the outer third (t in [~0.66, 1]) per spec §6.2.
    lengthProfile: rampProfile({ start: 0.62, end: 0.96, floor: 0.5 }),
    curl: 0.5,
    flare: flareProfile({ max: 0.5, power: 1.6 }),
    clustering: 0.3,
    densityJitter: 0.1,
    rootWidth: 2.2,
    calibration: { yOffset: -0.006, rootInset: 0.4 },
  },
  {
    id: "doll-eye",
    name: "Doll Eye",
    lashCount: 52,
    // Peaks at t=0.5, the widest part of the eye, per spec §6.2.
    lengthProfile: gaussProfile({ peak: 0.5, sigma: 0.24, floor: 0.55 }),
    curl: 0.78,
    flare: flareProfile({ max: 0.1, power: 1.4 }),
    clustering: 0.4,
    densityJitter: 0.1,
    rootWidth: 2.2,
    calibration: { yOffset: -0.01, rootInset: 0.45 },
  },
];

export function styleById(id: string): LashStyle {
  return LASH_STYLES.find((s) => s.id === id) ?? LASH_STYLES[0];
}
