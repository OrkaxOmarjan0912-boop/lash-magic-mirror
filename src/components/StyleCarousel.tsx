import { LASH_STYLES, type LashStyle } from "@/lib/lash-styles";
import { cn } from "@/lib/utils";

export function StyleCarousel({
  value,
  onChange,
}: {
  value: string;
  onChange: (s: LashStyle) => void;
}) {
  return (
    <div className="w-full overflow-x-auto no-scrollbar">
      <div className="flex gap-3 px-4 py-3 min-w-max">
        {LASH_STYLES.map((s) => {
          const active = s.id === value;
          return (
            <button
              key={s.id}
              onClick={() => onChange(s)}
              className={cn(
                "flex flex-col items-start gap-1 rounded-2xl px-4 py-3 min-w-[130px] text-left transition-all",
                active
                  ? "bg-background text-foreground shadow-lg scale-[1.02]"
                  : "bg-white/10 text-white/90 backdrop-blur-md",
              )}
              style={active ? { boxShadow: "0 8px 30px -8px color-mix(in oklab, var(--brand) 40%, transparent)" } : undefined}
            >
              <span className="font-serif text-lg leading-none">{s.name}</span>
              <span className="text-[10px] uppercase tracking-widest opacity-70">
                {s.intensity}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
