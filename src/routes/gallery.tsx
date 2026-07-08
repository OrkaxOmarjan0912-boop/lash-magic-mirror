import { createFileRoute, Link } from "@tanstack/react-router";
import { LASH_STYLES } from "@/lib/lash-styles";
import { BrandHeader } from "@/components/BrandHeader";
import { Camera } from "lucide-react";

export const Route = createFileRoute("/gallery")({
  head: () => ({
    meta: [
      { title: "Style Library — LashMirror" },
      { name: "description", content: "Explore six lash extension styles with descriptions, recommended eye shapes, pricing and aftercare notes." },
      { property: "og:title", content: "Lash style library" },
      { property: "og:description", content: "Classic, Hybrid, Volume, Mega Volume, Cat Eye, Doll Eye — with pricing and aftercare." },
    ],
  }),
  component: Gallery,
});

function Gallery() {
  return (
    <div className="min-h-screen pb-16">
      <BrandHeader />
      <main className="px-5 pt-6">
        <p className="text-[11px] uppercase tracking-[0.25em] text-muted-foreground">The library</p>
        <h1 className="font-serif text-4xl mt-2">Six ways to wear lashes</h1>
        <p className="mt-3 text-muted-foreground max-w-md">Every set is hand-mapped to your natural lash line. Tap any style to try it live.</p>

        <div className="mt-8 space-y-8">
          {LASH_STYLES.map((s, idx) => (
            <article key={s.id} className="border-b border-border pb-8 last:border-0">
              <div
                className="rounded-2xl aspect-[3/2] mb-4"
                style={{
                  background: `linear-gradient(${idx * 47}deg, oklch(0.92 0.03 25), oklch(${0.55 + (idx % 3) * 0.1} 0.09 ${15 + idx * 12}))`,
                }}
              />
              <div className="flex items-baseline justify-between">
                <h2 className="font-serif text-3xl">{s.name}</h2>
                <span className="font-serif text-xl">{s.price}</span>
              </div>
              <div className="mt-1 flex gap-3 text-[10px] uppercase tracking-widest text-muted-foreground">
                <span>{s.intensity}</span>
                <span>·</span>
                <span>{s.eyeShape}</span>
              </div>
              <p className="mt-3 text-sm text-muted-foreground">{s.description}</p>
              <p className="mt-2 text-xs text-muted-foreground italic">Aftercare: {s.aftercare}</p>
              <div className="mt-4 flex gap-2">
                <Link
                  to="/try-on"
                  search={{ style: s.id } as never}
                  className="inline-flex items-center gap-2 rounded-full px-5 py-3 text-sm font-medium"
                  style={{ background: "var(--brand)", color: "var(--brand-foreground)" }}
                >
                  <Camera className="h-4 w-4" /> Try on
                </Link>
                <Link
                  to="/booking"
                  search={{ style: s.id } as never}
                  className="rounded-full px-5 py-3 text-sm font-medium bg-secondary text-secondary-foreground"
                >
                  Book
                </Link>
              </div>
            </article>
          ))}
        </div>
      </main>
    </div>
  );
}
