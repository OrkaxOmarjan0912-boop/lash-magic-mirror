import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Camera, Download, Share2, RotateCcw, Sparkles, Send, Upload, X } from "lucide-react";
import { LashOverlay, type TrackingStatus } from "@/components/LashOverlay";
import { StyleCarousel } from "@/components/StyleCarousel";
import { LASH_STYLES, styleById, type LashStyle } from "@/lib/lash-styles";
import { saveLook } from "@/lib/looks-store";
import { BrandHeader } from "@/components/BrandHeader";

export const Route = createFileRoute("/try-on")({
  head: () => ({
    meta: [
      { title: "Try On — Live Lash Preview" },
      { name: "description", content: "Preview eyelash extension styles on your own face using your camera. Nothing is uploaded — all processing happens on-device." },
      { property: "og:title", content: "Try lashes on — live" },
      { property: "og:description", content: "See classic, hybrid, volume, cat eye and doll eye lashes on your face before you book." },
    ],
  }),
  component: TryOnPage,
});

function TryOnPage() {
  const [permissionAsked, setPermissionAsked] = useState(false);
  const [style, setStyle] = useState<LashStyle>(LASH_STYLES[0]);
  const [intensity, setIntensity] = useState(1);
  const [showBefore, setShowBefore] = useState(false);
  const [status, setStatus] = useState<TrackingStatus>("loading");
  const [captured, setCaptured] = useState<string | null>(null);
  const [staticImg, setStaticImg] = useState<HTMLImageElement | null>(null);
  const [debug, setDebug] = useState(false);
  const captureApi = useRef<{ capture: () => string | null } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const tapsRef = useRef<{ n: number; last: number }>({ n: 0, last: 0 });

  function handlePillTap() {
    const now = performance.now();
    const t = tapsRef.current;
    t.n = now - t.last < 500 ? t.n + 1 : 1;
    t.last = now;
    if (t.n >= 3) {
      t.n = 0;
      setDebug((d) => !d);
    }
  }

  useEffect(() => {
    const preset = new URLSearchParams(window.location.search).get("style");
    if (preset) setStyle(styleById(preset));
  }, []);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const img = new Image();
    img.onload = () => setStaticImg(img);
    img.src = URL.createObjectURL(f);
  }

  function snap() {
    const data = captureApi.current?.capture();
    if (data) setCaptured(data);
  }

  function save() {
    if (!captured) return;
    saveLook({ styleId: style.id, styleName: style.name, intensity, dataUrl: captured });
    setCaptured(null);
  }

  async function share() {
    if (!captured) return;
    try {
      const blob = await (await fetch(captured)).blob();
      const file = new File([blob], `lashmirror-${style.id}.jpg`, { type: "image/jpeg" });
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: `My ${style.name} lash preview`, text: `Trying on ${style.name} lashes on LashMirror` });
      } else {
        download();
      }
    } catch {
      download();
    }
  }

  function download() {
    if (!captured) return;
    const a = document.createElement("a");
    a.href = captured;
    a.download = `lashmirror-${style.id}.jpg`;
    a.click();
  }

  if (!permissionAsked && !staticImg) {
    return <PermissionScreen onAllow={() => setPermissionAsked(true)} onUpload={() => fileRef.current?.click()} />;
  }

  return (
    <div className="relative min-h-screen bg-black text-white">
      <input ref={fileRef} type="file" accept="image/*" onChange={handleFile} className="hidden" />

      {/* Camera stage */}
      <div className="fixed inset-0">
        <LashOverlay
          style={style}
          intensity={intensity}
          showBefore={showBefore}
          staticImage={staticImg}
          onReady={(api) => (captureApi.current = api)}
          onStatus={setStatus}
        />
      </div>

      {/* Top bar */}
      <div className="fixed top-0 inset-x-0 z-20 flex items-center justify-between px-5 pt-5">
        <Link to="/" className="grid h-10 w-10 place-items-center rounded-full bg-black/40 backdrop-blur">
          <X className="h-5 w-5" />
        </Link>
        <div className="rounded-full bg-black/40 backdrop-blur px-3 py-1 text-xs tracking-widest uppercase">
          {status === "tracking" && "Live"}
          {status === "static" && "Photo"}
          {status === "no-face" && "Center face"}
          {status === "loading" && "Loading…"}
          {status === "requesting-camera" && "Camera…"}
          {status === "denied" && "No camera"}
        </div>
        <button
          onClick={() => fileRef.current?.click()}
          className="grid h-10 w-10 place-items-center rounded-full bg-black/40 backdrop-blur"
          aria-label="Upload selfie"
        >
          <Upload className="h-5 w-5" />
        </button>
      </div>

      {status === "denied" && (
        <div className="fixed inset-0 grid place-items-center bg-black/70 z-30 px-6">
          <div className="max-w-sm text-center space-y-4">
            <h2 className="font-serif text-2xl">Camera unavailable</h2>
            <p className="text-sm text-white/70">Upload a selfie instead — we'll apply the lash preview to your photo.</p>
            <button onClick={() => fileRef.current?.click()} className="rounded-full bg-white text-black px-6 py-3 font-medium">
              Upload a selfie
            </button>
          </div>
        </div>
      )}

      {/* Bottom controls */}
      <div className="fixed bottom-0 inset-x-0 z-20 pb-6 pt-3 bg-gradient-to-t from-black/80 via-black/50 to-transparent">
        <StyleCarousel value={style.id} onChange={setStyle} />

        <div className="px-6 mt-2">
          <div className="flex items-center gap-3 text-[11px] uppercase tracking-widest text-white/70 mb-1">
            <Sparkles className="h-3 w-3" /> Intensity
          </div>
          <input
            type="range"
            min={0.5}
            max={1.5}
            step={0.05}
            value={intensity}
            onChange={(e) => setIntensity(parseFloat(e.target.value))}
            className="w-full accent-[color:var(--brand)]"
          />
        </div>

        <div className="mt-3 flex items-center justify-around px-6">
          <button
            onMouseDown={() => setShowBefore(true)}
            onMouseUp={() => setShowBefore(false)}
            onTouchStart={() => setShowBefore(true)}
            onTouchEnd={() => setShowBefore(false)}
            className="flex flex-col items-center gap-1"
          >
            <span className="grid h-12 w-12 place-items-center rounded-full bg-white/10 backdrop-blur">
              <RotateCcw className="h-5 w-5" />
            </span>
            <span className="text-[10px] uppercase tracking-widest">Before</span>
          </button>

          <button onClick={snap} className="flex flex-col items-center gap-1">
            <span
              className="grid h-20 w-20 place-items-center rounded-full border-4 border-white/80"
              style={{ background: "var(--brand)" }}
            >
              <Camera className="h-7 w-7" style={{ color: "var(--brand-foreground)" }} />
            </span>
          </button>

          <Link
            to="/booking"
            search={{ style: style.id } as never}
            className="flex flex-col items-center gap-1"
          >
            <span className="grid h-12 w-12 place-items-center rounded-full bg-white/10 backdrop-blur">
              <Send className="h-5 w-5" />
            </span>
            <span className="text-[10px] uppercase tracking-widest">Book</span>
          </Link>
        </div>

        <p className="mt-3 text-center text-[10px] tracking-widest uppercase text-white/40">
          Processed on-device · Never uploaded
        </p>
      </div>

      {/* Capture modal */}
      {captured && (
        <div className="fixed inset-0 z-40 bg-black/90 flex flex-col">
          <div className="flex items-center justify-between p-5">
            <button onClick={() => setCaptured(null)} className="text-sm uppercase tracking-widest">
              Retake
            </button>
            <span className="font-serif text-lg">{style.name}</span>
            <span className="w-14" />
          </div>
          <div className="flex-1 grid place-items-center px-4">
            <img src={captured} alt="Captured look" className="max-h-full max-w-full rounded-2xl object-contain" />
          </div>
          <div className="grid grid-cols-3 gap-2 p-5">
            <button onClick={save} className="rounded-full bg-white text-black py-3 text-sm font-medium">
              Save
            </button>
            <button onClick={share} className="rounded-full bg-white/10 backdrop-blur py-3 text-sm flex items-center justify-center gap-2">
              <Share2 className="h-4 w-4" /> Share
            </button>
            <button onClick={download} className="rounded-full bg-white/10 backdrop-blur py-3 text-sm flex items-center justify-center gap-2">
              <Download className="h-4 w-4" /> Save file
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function PermissionScreen({ onAllow, onUpload }: { onAllow: () => void; onUpload: () => void }) {
  return (
    <div className="min-h-screen flex flex-col">
      <BrandHeader back />
      <div className="flex-1 px-6 pt-8 pb-10 flex flex-col">
        <h1 className="font-serif text-4xl leading-tight">Camera access</h1>
        <p className="mt-3 text-muted-foreground">
          To preview lashes live on your face, LashMirror needs to use your front camera.
        </p>
        <ul className="mt-6 space-y-4 text-sm">
          <li className="flex gap-3">
            <span className="mt-1 h-2 w-2 rounded-full" style={{ background: "var(--brand)" }} />
            <span><strong>Nothing leaves your device.</strong> Face tracking runs locally in your browser.</span>
          </li>
          <li className="flex gap-3">
            <span className="mt-1 h-2 w-2 rounded-full" style={{ background: "var(--brand)" }} />
            <span><strong>No account, no upload.</strong> We never send your video or photos to a server.</span>
          </li>
          <li className="flex gap-3">
            <span className="mt-1 h-2 w-2 rounded-full" style={{ background: "var(--brand)" }} />
            <span><strong>Works best in soft, front light.</strong> Face a window or ring light.</span>
          </li>
        </ul>
        <div className="mt-auto pt-8 space-y-3">
          <button
            onClick={onAllow}
            className="w-full rounded-full py-4 font-medium"
            style={{ background: "var(--brand)", color: "var(--brand-foreground)" }}
          >
            Turn on camera
          </button>
          <button onClick={onUpload} className="w-full rounded-full py-4 font-medium bg-secondary text-secondary-foreground">
            Upload a selfie instead
          </button>
        </div>
      </div>
    </div>
  );
}
