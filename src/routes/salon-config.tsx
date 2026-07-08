import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { BrandHeader } from "@/components/BrandHeader";
import { defaultTheme, loadTheme, saveTheme, applyTheme, type SalonTheme } from "@/lib/theme-config";

export const Route = createFileRoute("/salon-config")({
  head: () => ({
    meta: [
      { title: "Salon White-Label Config — LashMirror" },
      { name: "description", content: "Preview how LashMirror re-skins with your salon's logo, color, and booking link." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: SalonConfig,
});

const PRESETS: { name: string; theme: Partial<SalonTheme> }[] = [
  { name: "LashMirror (default)", theme: defaultTheme },
  {
    name: "Maison Cils — Paris",
    theme: { salonName: "Maison Cils", logoInitial: "M", brandColor: "oklch(0.35 0.03 30)", brandForeground: "oklch(0.98 0.01 60)", mode: "salon", bookingUrl: "https://calendly.com/example", tagline: "L'art du regard" },
  },
  {
    name: "Halo Lash Studio",
    theme: { salonName: "Halo Lash Studio", logoInitial: "H", brandColor: "oklch(0.72 0.15 65)", brandForeground: "oklch(0.2 0.02 60)", mode: "salon", bookingUrl: "https://halolashes.example.com/book", tagline: "Soft, weightless, yours" },
  },
  {
    name: "Noir Lash Bar",
    theme: { salonName: "Noir Lash Bar", logoInitial: "N", brandColor: "oklch(0.55 0.19 320)", brandForeground: "oklch(0.99 0.005 60)", mode: "salon", bookingUrl: "https://noirlash.example.com", tagline: "After-dark drama" },
  },
];

function SalonConfig() {
  const [theme, setTheme] = useState<SalonTheme>(defaultTheme);
  useEffect(() => setTheme(loadTheme()), []);

  function update<K extends keyof SalonTheme>(k: K, v: SalonTheme[K]) {
    const next = { ...theme, [k]: v };
    setTheme(next);
    saveTheme(next);
  }

  function applyPreset(p: Partial<SalonTheme>) {
    const next = { ...defaultTheme, ...p };
    setTheme(next);
    saveTheme(next);
  }

  return (
    <div className="min-h-screen pb-20">
      <BrandHeader />
      <main className="px-5 pt-6 max-w-lg mx-auto">
        <p className="text-[11px] uppercase tracking-[0.25em] text-muted-foreground">White-label</p>
        <h1 className="font-serif text-4xl mt-2">Salon config</h1>
        <p className="mt-3 text-muted-foreground">
          Every color, logo initial, salon name and booking URL is driven by one theme object. Try a preset or edit manually — the whole app re-skins instantly.
        </p>

        <section className="mt-6">
          <h2 className="text-[11px] uppercase tracking-widest text-muted-foreground mb-2">Presets</h2>
          <div className="grid grid-cols-2 gap-2">
            {PRESETS.map((p) => (
              <button
                key={p.name}
                onClick={() => applyPreset(p.theme)}
                className="rounded-2xl hairline p-3 text-left bg-card"
              >
                <div
                  className="h-8 w-8 rounded-full grid place-items-center font-serif italic mb-2"
                  style={{ background: p.theme.brandColor, color: p.theme.brandForeground }}
                >
                  {p.theme.logoInitial}
                </div>
                <div className="font-serif">{p.theme.salonName}</div>
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{p.theme.mode ?? "consumer"}</div>
              </button>
            ))}
          </div>
        </section>

        <section className="mt-8 space-y-4">
          <h2 className="text-[11px] uppercase tracking-widest text-muted-foreground">Custom</h2>
          <Row label="Salon name" value={theme.salonName} onChange={(v) => update("salonName", v)} />
          <Row label="Tagline" value={theme.tagline} onChange={(v) => update("tagline", v)} />
          <Row label="Logo initial" value={theme.logoInitial} onChange={(v) => update("logoInitial", v.slice(0, 2))} />
          <div>
            <label className="text-[11px] uppercase tracking-widest text-muted-foreground">Brand color (oklch)</label>
            <div className="flex gap-2 mt-1">
              <div className="h-10 w-10 rounded-full hairline" style={{ background: theme.brandColor }} />
              <input
                value={theme.brandColor}
                onChange={(e) => update("brandColor", e.target.value)}
                className="flex-1 rounded-full bg-card hairline px-4 text-sm"
              />
            </div>
          </div>
          <Row label="Booking URL (salon mode)" value={theme.bookingUrl ?? ""} onChange={(v) => update("bookingUrl", v)} />
          <div>
            <label className="text-[11px] uppercase tracking-widest text-muted-foreground">Mode</label>
            <div className="mt-1 flex gap-2">
              {(["consumer", "salon"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => update("mode", m)}
                  className={`rounded-full px-4 py-2 text-sm capitalize ${theme.mode === m ? "text-primary-foreground" : "bg-secondary text-secondary-foreground"}`}
                  style={theme.mode === m ? { background: "var(--brand)", color: "var(--brand-foreground)" } : undefined}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
          <button
            onClick={() => {
              saveTheme(defaultTheme);
              setTheme(defaultTheme);
              applyTheme(defaultTheme);
            }}
            className="text-xs uppercase tracking-widest text-muted-foreground underline underline-offset-4"
          >
            Reset to default
          </button>
        </section>

        <section className="mt-10 rounded-2xl hairline p-5 bg-card">
          <div className="text-[11px] uppercase tracking-widest text-muted-foreground">Preview</div>
          <div className="mt-3 flex items-center gap-3">
            <div
              className="grid h-12 w-12 place-items-center rounded-full font-serif italic text-lg"
              style={{ background: "var(--brand)", color: "var(--brand-foreground)" }}
            >
              {theme.logoInitial}
            </div>
            <div>
              <div className="font-serif text-2xl">{theme.salonName}</div>
              <div className="text-xs text-muted-foreground">{theme.tagline}</div>
            </div>
          </div>
          <button
            className="mt-4 w-full rounded-full py-3 font-medium"
            style={{ background: "var(--brand)", color: "var(--brand-foreground)" }}
          >
            Try lashes on live
          </button>
        </section>
      </main>
    </div>
  );
}

function Row({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="text-[11px] uppercase tracking-widest text-muted-foreground">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-full bg-card hairline px-4 py-3 text-sm"
      />
    </div>
  );
}
