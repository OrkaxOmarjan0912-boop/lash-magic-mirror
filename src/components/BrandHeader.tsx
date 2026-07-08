import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { loadTheme, applyTheme, type SalonTheme } from "@/lib/theme-config";

export function BrandHeader({ back }: { back?: boolean }) {
  const [theme, setTheme] = useState<SalonTheme | null>(null);
  useEffect(() => {
    const t = loadTheme();
    applyTheme(t);
    setTheme(t);
  }, []);
  const name = theme?.salonName ?? "LashMirror";
  const initial = theme?.logoInitial ?? "L";
  return (
    <header className="sticky top-0 z-40 flex items-center justify-between px-5 py-4 backdrop-blur-md bg-background/80 border-b border-border/60">
      <Link to="/" className="flex items-center gap-2">
        <span
          className="grid h-8 w-8 place-items-center rounded-full text-sm font-serif italic"
          style={{ background: "var(--brand)", color: "var(--brand-foreground)" }}
        >
          {initial}
        </span>
        <span className="font-serif text-lg tracking-tight">{name}</span>
      </Link>
      {back ? (
        <Link to="/" className="text-xs tracking-widest uppercase text-muted-foreground">
          Close
        </Link>
      ) : (
        <nav className="flex items-center gap-4 text-xs tracking-widest uppercase text-muted-foreground">
          <Link to="/gallery" activeProps={{ className: "text-foreground" }}>Styles</Link>
          <Link to="/my-looks" activeProps={{ className: "text-foreground" }}>Looks</Link>
        </nav>
      )}
    </header>
  );
}
