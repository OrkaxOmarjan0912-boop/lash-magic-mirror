export type LashIntensity = "Natural" | "Glam" | "Dramatic";

// Length profile shape along the lid (t: 0=inner corner, 1=outer corner)
export type LengthProfile =
  | { kind: "gauss"; peak: number; sigma: number; floor: number }
  | { kind: "ramp"; start: number; end: number; floor: number }; // linearly ramps from floor at t=start to 1 at t=end

export type LashRender = {
  count: number;            // lashes per eye at intensity=1
  lengthRatio: number;      // longest lash length as fraction of eye width at intensity=1
  profile: LengthProfile;
  curl: number;             // 0..1 upward hook amount
  flare: number;            // 0..1 outward lean toward outer corner
  thickness: number;        // multiplier on root width (px @ 720p)
  fan: number;              // strands per position: 1 (classic) up to 4 (mega)
  fanSpread: number;        // radial spread of fan tips (fraction of lash length)
  rootInset: number;        // pixels to nudge root inward along normal (into lid)
  verticalOffset: number;   // vertical calibration (fraction of eye width, negative = up)
};

export type LashStyle = {
  id: string;
  name: string;
  description: string;
  intensity: LashIntensity;
  eyeShape: string;
  price: string;
  aftercare: string;
  render: LashRender;
};

export const LASH_STYLES: LashStyle[] = [
  {
    id: "classic",
    name: "Classic",
    description: "One extension per natural lash — everyday, effortless.",
    intensity: "Natural",
    eyeShape: "All eye shapes",
    price: "$95",
    aftercare: "Avoid oil-based cleansers. Refills every 2–3 weeks.",
    render: {
      count: 46,
      lengthRatio: 0.28,
      profile: { kind: "gauss", peak: 0.6, sigma: 0.32, floor: 0.55 },
      curl: 0.55,
      flare: 0.15,
      thickness: 1.0,
      fan: 1,
      fanSpread: 0,
      rootInset: 0.5,
      verticalOffset: -0.005,
    },
  },
  {
    id: "hybrid",
    name: "Hybrid",
    description: "A mix of classic and volume — textured, lived-in fullness.",
    intensity: "Natural",
    eyeShape: "Almond, round",
    price: "$130",
    aftercare: "Brush daily with a spoolie. Refills every 2–3 weeks.",
    render: {
      count: 52,
      lengthRatio: 0.32,
      profile: { kind: "gauss", peak: 0.6, sigma: 0.32, floor: 0.55 },
      curl: 0.6,
      flare: 0.2,
      thickness: 1.1,
      fan: 2,
      fanSpread: 0.06,
      rootInset: 0.5,
      verticalOffset: -0.005,
    },
  },
  {
    id: "volume",
    name: "Volume",
    description: "Handmade fans for soft, fluffy glam.",
    intensity: "Glam",
    eyeShape: "Almond, monolid",
    price: "$165",
    aftercare: "No cotton pads. Sleep on your back if possible.",
    render: {
      count: 56,
      lengthRatio: 0.36,
      profile: { kind: "gauss", peak: 0.6, sigma: 0.34, floor: 0.6 },
      curl: 0.65,
      flare: 0.22,
      thickness: 1.15,
      fan: 3,
      fanSpread: 0.11,
      rootInset: 0.6,
      verticalOffset: -0.008,
    },
  },
  {
    id: "mega",
    name: "Mega Volume",
    description: "Maximum density. Full drama, red-carpet ready.",
    intensity: "Dramatic",
    eyeShape: "Round, downturned",
    price: "$195",
    aftercare: "Weekly cleanser. Refills every 2 weeks to hold density.",
    render: {
      count: 64,
      lengthRatio: 0.42,
      profile: { kind: "gauss", peak: 0.6, sigma: 0.36, floor: 0.62 },
      curl: 0.7,
      flare: 0.28,
      thickness: 1.25,
      fan: 4,
      fanSpread: 0.16,
      rootInset: 0.7,
      verticalOffset: -0.01,
    },
  },
  {
    id: "cat-eye",
    name: "Cat Eye",
    description: "Elongated outer corners for a lifted, feline shape.",
    intensity: "Glam",
    eyeShape: "Almond, upturned",
    price: "$150",
    aftercare: "Avoid rubbing outer corners. Refills every 3 weeks.",
    render: {
      count: 54,
      lengthRatio: 0.44,
      profile: { kind: "ramp", start: 0.25, end: 0.9, floor: 0.5 },
      curl: 0.55,
      flare: 0.45,
      thickness: 1.15,
      fan: 2,
      fanSpread: 0.08,
      rootInset: 0.5,
      verticalOffset: -0.006,
    },
  },
  {
    id: "doll-eye",
    name: "Doll Eye",
    description: "Longest in the center for a wide-awake, doll-like look.",
    intensity: "Glam",
    eyeShape: "Almond, hooded",
    price: "$150",
    aftercare: "Sleep mask recommended. Refills every 3 weeks.",
    render: {
      count: 58,
      lengthRatio: 0.4,
      profile: { kind: "gauss", peak: 0.5, sigma: 0.22, floor: 0.55 },
      curl: 0.7,
      flare: 0.12,
      thickness: 1.15,
      fan: 3,
      fanSpread: 0.1,
      rootInset: 0.55,
      verticalOffset: -0.008,
    },
  },
];

export function styleById(id: string): LashStyle {
  return LASH_STYLES.find((s) => s.id === id) ?? LASH_STYLES[0];
}
