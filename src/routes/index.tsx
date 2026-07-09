import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Camera, Sparkles, Send } from "lucide-react";
import { LASH_STYLES } from "@/lib/lash-styles";
import { BrandHeader } from "@/components/BrandHeader";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "LashMirror — Try lashes on before you book" },
      { name: "description", content: "Preview classic, hybrid, volume, cat eye and doll eye lash extensions on your own face with a live AR try-on. Private and on-device." },
      { property: "og:title", content: "LashMirror — Try lashes on before you book" },
      { property: "og:description", content: "Preview classic, hybrid, volume, cat eye and doll eye lash extensions on your own face with a live AR try-on. Private and on-device." },
    ],
  }),
  component: Landing,
});

function Landing() {
  return (
    <div className="min-h-screen">
      <BrandHeader />
      <main className="px-5 pb-24">
        {/* Hero */}
        <section className="pt-8 pb-10">
          <p className="text-[11px] uppercase tracking-[0.25em] text-muted-foreground">
            Live AR · On-device
          </p>
          <h1 className="mt-3 font-serif text-[44px] leading-[1.02] tracking-tight">
            See the lashes<br />before you book.
          </h1>
          <p className="mt-4 text-muted-foreground max-w-md">
            Preview six lash extension styles on your own face with your phone camera. Nothing uploaded, nothing saved without you.
          </p>
          <div className="mt-6 flex flex-col gap-3">
            <Link
              to="/try-on"
              className="inline-flex items-center justify-center gap-2 rounded-full py-4 px-6 font-medium"
              style={{ background: "var(--brand)", color: "var(--brand-foreground)" }}
            >
              <Camera className="h-4 w-4" /> Try lashes on live
            </Link>
            <Link
              to="/gallery"
              className="inline-flex items-center justify-center gap-2 rounded-full py-4 px-6 font-medium bg-secondary text-secondary-foreground"
            >
              Browse the style library
            </Link>
          </div>
        </section>

        {/* Editorial hero card */}
        <section className="rounded-3xl overflow-hidden relative aspect-[4/5] mb-14"
          style={{ background: "linear-gradient(160deg, oklch(0.92 0.03 25), oklch(0.78 0.08 20))" }}>
          <div className="absolute inset-0 p-6 flex flex-col justify-between">
            <span className="text-[10px] uppercase tracking-[0.3em] text-charcoal/70">Featured · Cat Eye</span>
            <div>
              <h3 className="font-serif text-3xl text-charcoal">Lifted. Elongated. Effortless.</h3>
              <p className="mt-2 text-sm text-charcoal/70 max-w-[80%]">
                A hand-mapped cat eye styled to your natural lash line.
              </p>
              <Link to="/try-on" search={{ style: "cat" } as never} className="mt-4 inline-flex items-center gap-1 text-sm underline underline-offset-4 text-charcoal">
                Try this style <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
          </div>
        </section>

        {/* How it works */}
        <section className="mb-14">
          <h2 className="font-serif text-3xl mb-6">How it works</h2>
          <ol className="space-y-5">
            {[
              { i: Camera, t: "Point your camera", d: "We use your front camera in-browser. No app, no signup." },
              { i: Sparkles, t: "Swipe through styles", d: "Tap Classic, Hybrid, Volume, Cat Eye and more — instantly." },
              { i: Send, t: "Send it to your tech", d: "Snap the look and share it with your lash artist before your appointment." },
            ].map(({ i: Icon, t, d }, idx) => (
              <li key={t} className="flex gap-4">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full hairline">
                  <Icon className="h-4 w-4" />
                </div>
                <div>
                  <div className="flex items-baseline gap-2">
                    <span className="font-serif text-lg">{t}</span>
                    <span className="text-[10px] uppercase tracking-widest text-muted-foreground">0{idx + 1}</span>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">{d}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        {/* Style grid */}
        <section>
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="font-serif text-3xl">The library</h2>
            <Link to="/gallery" className="text-xs uppercase tracking-widest text-muted-foreground">All</Link>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {LASH_STYLES.map((s) => (
              <Link
                key={s.id}
                to="/try-on"
                search={{ style: s.id } as never}
                className="rounded-2xl overflow-hidden aspect-[4/5] relative flex flex-col justify-end p-4"
                style={{
                  background: `linear-gradient(180deg, transparent 40%, oklch(0.22 0.01 60 / 0.7)), linear-gradient(135deg, oklch(0.92 0.03 25), oklch(${0.6 + Math.random() * 0.2} 0.06 ${10 + Math.random() * 40}))`,
                }}
              >
                <div className="text-white">
                  <div className="font-serif text-xl leading-tight">{s.name}</div>
                  <div className="text-[10px] uppercase tracking-widest opacity-80 mt-1">{s.intensity}</div>
                </div>
              </Link>
            ))}
          </div>
        </section>

        <footer className="mt-16 pt-8 border-t border-border text-xs text-muted-foreground space-y-2">
          <p>Privacy first. Face tracking runs entirely in your browser using MediaPipe. Your camera feed never leaves your device.</p>
          <div className="flex gap-4">
            <Link to="/salon-config">Salon white-label</Link>
            <Link to="/my-looks">My looks</Link>
            <Link to="/booking">Book</Link>
          </div>
        </footer>
      </main>
    </div>
  );
}
