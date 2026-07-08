// White-label theme configuration. A salon can rebrand the entire app
// by editing this single object (or swapping it out at build time).
export type SalonTheme = {
  salonName: string;
  tagline: string;
  logoInitial: string; // used as monogram
  brandColor: string; // oklch or hex applied to --brand
  brandForeground: string;
  bookingUrl?: string; // external booking URL (salon mode)
  contactEmail?: string;
  contactPhone?: string;
  mode: "consumer" | "salon";
};

export const defaultTheme: SalonTheme = {
  salonName: "LashMirror",
  tagline: "Try lashes on. Before you commit.",
  logoInitial: "L",
  brandColor: "oklch(0.68 0.09 20)",
  brandForeground: "oklch(0.99 0.005 60)",
  bookingUrl: undefined,
  contactEmail: "hello@lashmirror.app",
  contactPhone: "",
  mode: "consumer",
};

const STORAGE_KEY = "lashmirror.theme";

export function loadTheme(): SalonTheme {
  if (typeof window === "undefined") return defaultTheme;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultTheme;
    return { ...defaultTheme, ...JSON.parse(raw) };
  } catch {
    return defaultTheme;
  }
}

export function saveTheme(theme: SalonTheme) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(theme));
  applyTheme(theme);
}

export function applyTheme(theme: SalonTheme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.style.setProperty("--brand", theme.brandColor);
  root.style.setProperty("--brand-foreground", theme.brandForeground);
  document.title = `${theme.salonName} — ${theme.tagline}`;
}
