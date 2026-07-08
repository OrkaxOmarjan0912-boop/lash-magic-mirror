import { createFileRoute, Link } from "@tanstack/react-router";
import { BrandHeader } from "@/components/BrandHeader";
import { useLooks, deleteLook } from "@/lib/looks-store";
import { Camera, Trash2, Send } from "lucide-react";

export const Route = createFileRoute("/my-looks")({
  head: () => ({
    meta: [
      { title: "My Looks — LashMirror" },
      { name: "description", content: "Your saved lash try-on captures, stored locally on your device." },
    ],
  }),
  component: MyLooks,
});

function MyLooks() {
  const looks = useLooks();
  return (
    <div className="min-h-screen pb-16">
      <BrandHeader />
      <main className="px-5 pt-6">
        <p className="text-[11px] uppercase tracking-[0.25em] text-muted-foreground">Saved</p>
        <h1 className="font-serif text-4xl mt-2">My looks</h1>
        <p className="mt-3 text-muted-foreground">
          Captures are stored on your device only. Share them with your tech when you're ready.
        </p>

        {looks.length === 0 ? (
          <div className="mt-16 text-center">
            <p className="font-serif text-2xl">No captures yet</p>
            <p className="mt-2 text-sm text-muted-foreground">Snap your first look to save it here.</p>
            <Link
              to="/try-on"
              className="mt-6 inline-flex items-center gap-2 rounded-full px-6 py-3 font-medium"
              style={{ background: "var(--brand)", color: "var(--brand-foreground)" }}
            >
              <Camera className="h-4 w-4" /> Open the mirror
            </Link>
          </div>
        ) : (
          <div className="mt-6 grid grid-cols-2 gap-3">
            {looks.map((l) => (
              <div key={l.id} className="rounded-2xl overflow-hidden bg-card hairline">
                <img src={l.dataUrl} alt={l.styleName} className="w-full aspect-[3/4] object-cover" />
                <div className="p-3">
                  <div className="font-serif text-lg">{l.styleName}</div>
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                    {new Date(l.createdAt).toLocaleDateString()}
                  </div>
                  <div className="mt-2 flex gap-2">
                    <Link
                      to="/booking"
                      search={{ style: l.styleId } as never}
                      className="flex-1 rounded-full py-2 text-xs text-center"
                      style={{ background: "var(--brand)", color: "var(--brand-foreground)" }}
                    >
                      <Send className="inline h-3 w-3 mr-1" /> Send
                    </Link>
                    <button
                      onClick={() => deleteLook(l.id)}
                      aria-label="Delete"
                      className="rounded-full px-3 bg-secondary text-secondary-foreground"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
