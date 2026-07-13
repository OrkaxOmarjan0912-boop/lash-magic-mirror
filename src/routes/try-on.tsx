// Main try-on experience. Renders the sealed AR engine from
// src/lash-engine/ via its React wrapper — this file only touches the
// public LashTryOn / LashTryOnController surface and never reaches into
// the engine internals.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Camera, Download, Share2, RotateCcw, Sparkles, Send, Upload, X } from "lucide-react";
import { StyleCarousel } from "@/components/StyleCarousel";
import { LASH_STYLES, styleById, type LashStyle } from "@/lib/lash-styles";
import { saveLook } from "@/lib/looks-store";
import { BrandHeader } from "@/components/BrandHeader";
import { LashTryOn, type LashTryOnHandle, type LashTryOnStatus } from "@/lash-engine/react/LashTryOn";

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

type Hint = null | "faceLost" | "lowLight";

function TryOnPage() {
  const [permissionAsked, setPermissionAsked] = useState(false);
  const [style, setStyle] = useState<LashStyle>(LASH_STYLES[0]);
  const [intensity, setIntensity] = useState(1);
  const [comparing, setComparing] = useState(false);
  const [status, setStatus] = useState<LashTryOnStatus>("loading");
  const [engineError, setEngineError] = useState(false);
  const [hint, setHint] = useState<Hint>(null);
  const [captured, setCaptured] = useState<string | null>(null);
  const [staticImg, setStaticImg] = useState<string | null>(null);

  const handleRef = useRef<LashTryOnHandle>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const lowLightSeen = useRef(false);

  useEffect(() => {
    const preset = new URLSearchParams(window.location.search).get("style");
    if (preset) setStyle(styleById(preset));
  }, []);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setStaticImg(URL.createObjectURL(f));
  }

  async function snap() {
    try {
      const blob = await handleRef.current?.capture();
      if (blob) setCaptured(await blobToDataUrl(blob));
    } catch (err) {
      console.error("capture failed", err);
    }
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

  // Selfie-upload fallback view — plain photo preview when the engine
  // can't run (permission denied / model failed to load) or the user
  // explicitly chose to upload.
  if (staticImg) {
    return (
      <div className="relative min-h-screen bg-black text-white">
        <input ref={fileRef} type="file" accept="image/*" onChange={handleFile} className="hidden" />
        <img src={staticImg} alt="Your selfie" className="fixed inset-0 h-full w-full object-cover" />
        <div className="fixed top-0 inset-x-0 z-20 flex items-center justify-between px-5 pt-5">
          <Link to="/" className="grid h-10 w-10 place-items-center rounded-full bg-black/40 backdrop-blur">
            <X className="h-5 w-5" />
          </Link>
          <span className="rounded-full bg-black/40 backdrop-blur px-3 py-1 text-xs tracking-widest uppercase">Photo</span>
          <button
            onClick={() => { setStaticImg(null); setPermissionAsked(true); }}
            className="grid h-10 w-10 place-items-center rounded-full bg-black/40 backdrop-blur"
            aria-label="Use camera"
          >
            <Camera className="h-5 w-5" />
          </button>
        </div>
        <div className="fixed bottom-0 inset-x-0 z-20 pb-8 pt-6 px-6 bg-gradient-to-t from-black/90 to-transparent text-center">
          <p className="text-sm text-white/80">Live preview needs a working camera. You can still browse styles and book a consultation.</p>
          <Link
            to="/booking"
            search={{ style: style.id } as never}
            className="mt-4 inline-flex rounded-full px-6 py-3 font-medium"
            style={{ background: "var(--brand)", color: "var(--brand-foreground)" }}
          >
            Book a consultation
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen bg-black text-white">
      <input ref={fileRef} type="file" accept="image/*" onChange={handleFile} className="hidden" />

      {/* Engine camera stage */}
      <div className="fixed inset-0">
        <LashTryOn
          ref={handleRef}
          styleId={style.id}
          intensity={intensity}
          comparing={comparing}
          className="h-full w-full"
          onStatus={setStatus}
          onError={(err) => {
            console.error("lash engine error", err);
            setEngineError(true);
          }}
          onFaceFound={() => setHint((h) => (h === "faceLost" ? null : h))}
          onFaceLost={() => setHint("faceLost")}
          onLowLight={() => {
            if (lowLightSeen.current) return;
            lowLightSeen.current = true;
            setHint("lowLight");
            setTimeout(() => setHint((h) => (h === "lowLight" ? null : h)), 4000);
          }}
          onFpsDrop={() => console.info("lash engine: fps drop, engine will self-adjust")}
        />
      </div>

      {/* Top bar */}
      <div className="fixed top-0 inset-x-0 z-20 flex items-center justify-between px-5 pt-5">
        <Link to="/" className="grid h-10 w-10 place-items-center rounded-full bg-black/40 backdrop-blur">
          <X className="h-5 w-5" />
        </Link>
        <span className="rounded-full bg-black/40 backdrop-blur px-3 py-1 text-xs tracking-widest uppercase">
          {status === "ready" && "Live"}
          {status === "loading" && "Loading…"}
          {status === "error" && "Unavailable"}
        </span>
        <button
          onClick={() => fileRef.current?.click()}
          className="grid h-10 w-10 place-items-center rounded-full bg-black/40 backdrop-blur"
          aria-label="Upload selfie"
        >
          <Upload className="h-5 w-5" />
        </button>
      </div>

      {/* Friendly guidance hints */}
      {hint && status === "ready" && (
        <div className="pointer-events-none fixed inset-x-0 top-24 z-20 flex justify-center px-6">
          <div className="rounded-full bg-black/60 backdrop-blur px-4 py-2 text-sm">
            {hint === "faceLost" && "Center your face in the frame"}
            {hint === "lowLight" && "Move to better lighting for the best preview"}
          </div>
        </div>
      )}

      {/* Engine failure fallback */}
      {(status === "error" || engineError) && (
        <div className="fixed inset-0 grid place-items-center bg-black/80 z-30 px-6">
          <div className="max-w-sm text-center space-y-4">
            <h2 className="font-serif text-2xl">We can't start the live preview</h2>
            <p className="text-sm text-white/70">
              Your camera may be blocked, or this device can't run the AR tracker. Upload a selfie instead — nothing is sent to a server either way.
            </p>
            <button
              onClick={() => fileRef.current?.click()}
              className="rounded-full bg-white text-black px-6 py-3 font-medium"
            >
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
            onMouseDown={() => setComparing(true)}
            onMouseUp={() => setComparing(false)}
            onMouseLeave={() => setComparing(false)}
            onTouchStart={() => setComparing(true)}
            onTouchEnd={() => setComparing(false)}
            className="flex flex-col items-center gap-1"
          >
            <span className="grid h-12 w-12 place-items-center rounded-full bg-white/10 backdrop-blur">
              <RotateCcw className="h-5 w-5" />
            </span>
            <span className="text-[10px] uppercase tracking-widest">Before</span>
          </button>

          <button onClick={snap} className="flex flex-col items-center gap-1" disabled={status !== "ready"}>
            <span
              className="grid h-20 w-20 place-items-center rounded-full border-4 border-white/80"
              style={{ background: "var(--brand)", opacity: status === "ready" ? 1 : 0.5 }}
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

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
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
            <span><strong>Everything happens on your phone.</strong> Your camera is never uploaded.</span>
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
