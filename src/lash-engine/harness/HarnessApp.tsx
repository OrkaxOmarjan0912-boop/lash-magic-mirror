// The actual test-harness UI (spec deliverable: a bare page that runs the
// engine against the live camera with a toggleable debug overlay, style
// switcher, and intensity slider). Only relative imports within the engine
// package, so this same component can be mounted either as a TanStack route
// (src/routes/lash-lab.tsx) or from the fully standalone Vite entry in
// /standalone-harness (for deployment somewhere reachable without this repo's
// app build pipeline — see standalone-harness/README.md).
import { useRef, useState } from "react";
import { LashTryOn, type LashTryOnHandle } from "../react/LashTryOn";
import { LASH_STYLES } from "../index";

function describeError(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e instanceof Event) {
    const target = e.target as { error?: { message?: string } | MediaError } | null;
    const inner = target?.error;
    if (inner && "message" in inner && inner.message) return `${e.type}: ${inner.message}`;
    return `${e.type} event on ${target?.constructor?.name ?? "unknown target"}`;
  }
  return String(e);
}

export function HarnessApp() {
  const [styleId, setStyleId] = useState(LASH_STYLES[0].id);
  const [intensity, setIntensity] = useState(1);
  const [debug, setDebug] = useState(true);
  const [comparing, setComparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [captureUrl, setCaptureUrl] = useState<string | null>(null);
  const handleRef = useRef<LashTryOnHandle>(null);

  async function doCapture() {
    try {
      const blob = await handleRef.current?.capture();
      if (blob) setCaptureUrl(URL.createObjectURL(blob));
    } catch (e) {
      console.error(e);
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "#000",
        color: "#fff",
        fontFamily: "monospace",
      }}
    >
      <div style={{ position: "absolute", inset: 0 }}>
        <LashTryOn
          ref={handleRef}
          styleId={styleId}
          intensity={intensity}
          comparing={comparing}
          debug={debug}
          onStatus={setStatus}
          onError={(e) => setError(describeError(e))}
        />
      </div>

      {status === "loading" && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "grid",
            placeItems: "center",
            pointerEvents: "none",
          }}
        >
          <span>loading face tracker + camera…</span>
        </div>
      )}

      {error && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "grid",
            placeItems: "center",
            background: "rgba(0,0,0,0.85)",
            padding: 24,
            textAlign: "center",
          }}
        >
          <div>
            <p style={{ color: "#ff6b6b" }}>Error: {error}</p>
            <p style={{ opacity: 0.6, fontSize: 12 }}>
              Camera permission denied, or this device/browser can't run WASM face tracking.
            </p>
          </div>
        </div>
      )}

      <div
        style={{
          position: "absolute",
          top: 0,
          insetInline: 0,
          display: "flex",
          gap: 8,
          padding: 10,
          flexWrap: "wrap",
          background: "rgba(0,0,0,0.5)",
        }}
      >
        {LASH_STYLES.map((s) => (
          <button
            key={s.id}
            onClick={() => setStyleId(s.id)}
            style={{
              padding: "6px 10px",
              fontSize: 12,
              borderRadius: 6,
              border: "1px solid #444",
              background: s.id === styleId ? "#fff" : "transparent",
              color: s.id === styleId ? "#000" : "#fff",
            }}
          >
            {s.name}
          </button>
        ))}
        <label
          style={{
            marginLeft: "auto",
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12,
          }}
        >
          <input type="checkbox" checked={debug} onChange={(e) => setDebug(e.target.checked)} />
          debug
        </label>
      </div>

      <div
        style={{
          position: "absolute",
          bottom: 0,
          insetInline: 0,
          padding: 12,
          background: "rgba(0,0,0,0.5)",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        <label style={{ fontSize: 12, display: "flex", flexDirection: "column", gap: 4 }}>
          intensity {intensity.toFixed(2)}
          <input
            type="range"
            min={0.5}
            max={1.5}
            step={0.05}
            value={intensity}
            onChange={(e) => setIntensity(parseFloat(e.target.value))}
          />
        </label>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onMouseDown={() => setComparing(true)}
            onMouseUp={() => setComparing(false)}
            onTouchStart={() => setComparing(true)}
            onTouchEnd={() => setComparing(false)}
            style={{
              padding: "8px 14px",
              fontSize: 12,
              borderRadius: 6,
              border: "1px solid #444",
              background: "transparent",
              color: "#fff",
            }}
          >
            hold: before
          </button>
          <button
            onClick={doCapture}
            style={{
              padding: "8px 14px",
              fontSize: 12,
              borderRadius: 6,
              border: "1px solid #444",
              background: "transparent",
              color: "#fff",
            }}
          >
            capture
          </button>
        </div>
      </div>

      {captureUrl && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "rgba(0,0,0,0.9)",
            display: "grid",
            placeItems: "center",
          }}
          onClick={() => setCaptureUrl(null)}
        >
          <img
            src={captureUrl}
            alt="capture"
            style={{ maxWidth: "90%", maxHeight: "90%", objectFit: "contain" }}
          />
        </div>
      )}
    </div>
  );
}
