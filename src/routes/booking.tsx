import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { BrandHeader } from "@/components/BrandHeader";
import { LASH_STYLES, styleById } from "@/lib/lash-styles";
import { loadTheme, type SalonTheme } from "@/lib/theme-config";
import { z } from "zod";

const search = z.object({ style: z.string().optional() });

export const Route = createFileRoute("/booking")({
  validateSearch: (s) => search.parse(s),
  head: () => ({
    meta: [
      { title: "Book an Appointment — LashMirror" },
      { name: "description", content: "Send a booking request with your chosen lash style, preferred date, and contact details." },
    ],
  }),
  component: Booking,
});

function Booking() {
  const { style: styleId } = Route.useSearch();
  const [style, setStyle] = useState(() => styleById(styleId ?? "classic"));
  const [theme, setTheme] = useState<SalonTheme | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", email: "", date: "", notes: "" });

  useEffect(() => setTheme(loadTheme()), []);
  useEffect(() => setStyle(styleById(styleId ?? "classic")), [styleId]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (theme?.mode === "salon" && theme.bookingUrl) {
      window.open(theme.bookingUrl, "_blank");
      return;
    }
    setSubmitted(true);
  }

  if (submitted) {
    return (
      <div className="min-h-screen">
        <BrandHeader />
        <main className="px-6 pt-16 text-center max-w-md mx-auto">
          <h1 className="font-serif text-4xl">Request sent</h1>
          <p className="mt-4 text-muted-foreground">
            We passed your {style.name} request to {theme?.salonName ?? "the studio"}. You'll hear back within 24 hours.
          </p>
          <Link
            to="/"
            className="mt-8 inline-block rounded-full px-6 py-3 font-medium"
            style={{ background: "var(--brand)", color: "var(--brand-foreground)" }}
          >
            Back to home
          </Link>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-20">
      <BrandHeader />
      <main className="px-5 pt-6 max-w-lg mx-auto">
        <p className="text-[11px] uppercase tracking-[0.25em] text-muted-foreground">Booking request</p>
        <h1 className="font-serif text-4xl mt-2">Reserve your set</h1>

        <div className="mt-6 rounded-2xl bg-card hairline p-4">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Style</div>
          <div className="flex items-baseline justify-between mt-1">
            <div className="font-serif text-2xl">{style.name}</div>
            <div className="font-serif text-lg">{style.price}</div>
          </div>
          <select
            value={style.id}
            onChange={(e) => setStyle(styleById(e.target.value))}
            className="mt-3 w-full rounded-full bg-secondary text-secondary-foreground px-4 py-2 text-sm"
          >
            {LASH_STYLES.map((s) => (
              <option key={s.id} value={s.id}>{s.name} — {s.price}</option>
            ))}
          </select>
        </div>

        <form onSubmit={submit} className="mt-6 space-y-4">
          <Field label="Your name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} required />
          <Field label="Phone" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} type="tel" required />
          <Field label="Email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} type="email" />
          <Field label="Preferred date & time" value={form.date} onChange={(v) => setForm({ ...form, date: v })} type="datetime-local" required />
          <div>
            <label className="text-[11px] uppercase tracking-widest text-muted-foreground">Notes for your tech</label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={3}
              placeholder="First-time client, sensitive eyes, upcoming event…"
              className="mt-1 w-full rounded-2xl bg-card hairline px-4 py-3 text-sm"
            />
          </div>
          <button
            type="submit"
            className="w-full rounded-full py-4 font-medium"
            style={{ background: "var(--brand)", color: "var(--brand-foreground)" }}
          >
            {theme?.mode === "salon" && theme.bookingUrl ? "Continue to booking" : "Send request"}
          </button>
          <p className="text-xs text-center text-muted-foreground">
            By sending, you agree to be contacted about your appointment.
          </p>
        </form>
      </main>
    </div>
  );
}

function Field({
  label, value, onChange, type = "text", required,
}: { label: string; value: string; onChange: (v: string) => void; type?: string; required?: boolean }) {
  return (
    <div>
      <label className="text-[11px] uppercase tracking-widest text-muted-foreground">{label}</label>
      <input
        type={type}
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-full bg-card hairline px-4 py-3 text-sm"
      />
    </div>
  );
}
