export type LashIntensity = "Natural" | "Glam" | "Dramatic";

export type LashStyle = {
  id: string;
  name: string;
  description: string;
  intensity: LashIntensity;
  eyeShape: string;
  price: string;
  aftercare: string;
  // Rendering parameters used by the overlay renderer to draw synthetic lashes.
  // baseLength: fraction of eye width for the longest lash
  // density: lashes per eye
  // flareCenter: 0..1 position along the eye where the longest lash sits
  // curl: curvature strength
  // fanWidth: fan spread per lash (0 = single strand, >0 = volume fan)
  render: {
    baseLength: number;
    density: number;
    flareCenter: number;
    curl: number;
    fanWidth: number;
  };
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
    render: { baseLength: 0.16, density: 40, flareCenter: 0.55, curl: 0.35, fanWidth: 0 },
  },
  {
    id: "hybrid",
    name: "Hybrid",
    description: "A mix of classic and volume — textured, lived-in fullness.",
    intensity: "Natural",
    eyeShape: "Almond, round",
    price: "$130",
    aftercare: "Brush daily with a spoolie. Refills every 2–3 weeks.",
    render: { baseLength: 0.19, density: 55, flareCenter: 0.55, curl: 0.4, fanWidth: 0.08 },
  },
  {
    id: "volume",
    name: "Volume",
    description: "Handmade fans for soft, fluffy glam.",
    intensity: "Glam",
    eyeShape: "Almond, monolid",
    price: "$165",
    aftercare: "No cotton pads. Sleep on your back if possible.",
    render: { baseLength: 0.22, density: 70, flareCenter: 0.55, curl: 0.5, fanWidth: 0.18 },
  },
  {
    id: "mega",
    name: "Mega Volume",
    description: "Maximum density. Full drama, red-carpet ready.",
    intensity: "Dramatic",
    eyeShape: "Round, downturned",
    price: "$195",
    aftercare: "Weekly cleanser. Refills every 2 weeks to hold density.",
    render: { baseLength: 0.26, density: 90, flareCenter: 0.55, curl: 0.55, fanWidth: 0.28 },
  },
  {
    id: "cat",
    name: "Cat Eye",
    description: "Elongated outer corners for a lifted, feline shape.",
    intensity: "Glam",
    eyeShape: "Almond, upturned",
    price: "$150",
    aftercare: "Avoid rubbing outer corners. Refills every 3 weeks.",
    render: { baseLength: 0.28, density: 60, flareCenter: 0.82, curl: 0.45, fanWidth: 0.12 },
  },
  {
    id: "doll",
    name: "Doll Eye",
    description: "Longest in the center for a wide-awake, doll-like look.",
    intensity: "Glam",
    eyeShape: "Almond, hooded",
    price: "$150",
    aftercare: "Sleep mask recommended. Refills every 3 weeks.",
    render: { baseLength: 0.26, density: 65, flareCenter: 0.5, curl: 0.5, fanWidth: 0.14 },
  },
];

export function styleById(id: string): LashStyle {
  return LASH_STYLES.find((s) => s.id === id) ?? LASH_STYLES[0];
}
