// The actual test-harness UI (spec deliverable: a bare page that runs the
// engine against the live camera with a toggleable debug overlay, style
// switcher, and intensity slider). Only relative imports within the engine
// package, so this same component can be mounted either as a TanStack route
// (src/routes/lash-lab.tsx) or from the fully standalone Vite entry in
// /standalone-harness (for deployment somewhere reachable without this repo's
// app build pipeline).
//
// The debug panel also exposes live tuning sliders (calibration offsets,
// smoothing params, density/width/alpha) wired straight into the engine's
// debug-only LashDebugController surface, plus a polled telemetry readout —
// so on-device feedback can come back as exact numbers instead of descriptions.
import { useEffect, useRef, useState } from "react";
import { LashTryOn, type LashTryOnHandle } from "../react/LashTryOn";
import { LASH_STYLES, type LashTelemetry } from "../index";

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

type Tuning = {
  yOffset: number;
  rootInset: number;
  minCutoff: number;
  beta: number;
  lashCountMul: number;
  rootWidthMul: number;
  alphaFloor: number;
};

// Shipped defaults, locked in from on-device tuning (2026-07). yOffset here
// is only the *manual-override* value shown when autoYOffset is switched
// off below — the real shipped default is per-face auto-calibration (see
// estimateAutoYOffset in eye-geometry.ts), which this same 0.053 seeds as
// its fallback. lashCountMul/rootWidthMul reset to 1 (no additional
// multiplier) because their tuned values (0.95 / 0.65) are now baked
// directly into each style's lashCount/rootWidth in styles.ts.
const DEFAULT_TUNING: Tuning = {
  yOffset: 0.053,
  rootInset: 2.0,
  minCutoff: 0.2,
  beta: 1.2,
  lashCountMul: 1,
  rootWidthMul: 1,
  alphaFloor: 0.53,
};

// rootInset and minCutoff were at (or effectively at) their slider bounds
// when 2.0 / 0.2 were tuned — ranges widened here so retesting isn't capped
// against an arbitrary UI limit.
const SLIDER_SPECS: {
  key: keyof Tuning;
  label: string;
  min: number;
  max: number;
  step: number;
}[] = [
  {
    key: "rootInset",
    label: "rootInset (into the lid) — was maxed at 2, range widened",
    min: -1,
    max: 8,
    step: 0.02,
  },
  {
    key: "minCutoff",
    label: "minCutoff (One Euro, Hz) — was mined at 0.2, range widened",
    min: 0.02,
    max: 6,
    step: 0.02,
  },
  { key: "beta", label: "beta (One Euro, speed coeff)", min: 0, max: 2, step: 0.01 },
  {
    key: "lashCountMul",
    label: "lash count multiplier (on top of shipped default)",
    min: 0.3,
    max: 2.5,
    step: 0.05,
  },
  {
    key: "rootWidthMul",
    label: "root width multiplier (on top of shipped default)",
    min: 0.3,
    max: 3,
    step: 0.05,
  },
  {
    key: "alphaFloor",
    label: "alpha floor (good-light baseline; low light still ramps to 0.9)",
    min: 0.2,
    max: 1,
    step: 0.01,
  },
];

export function HarnessApp() {
  const [styleId, setStyleId] = useState(LASH_STYLES[0].id);
  const [intensity, setIntensity] = useState(1);
  const [debug, setDebug] = useState(true);
  const [comparing, setComparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [captureUrl, setCaptureUrl] = useState<string | null>(null);
  const [tuning, setTuning] = useState<Tuning>(DEFAULT_TUNING);
  const [autoYOffset, setAutoYOffset] = useState(true);
  const [telemetry, setTelemetry] = useState<LashTelemetry | null>(null);
  const handleRef = useRef<LashTryOnHandle>(null);

  // Push tuning changes straight into the engine's debug surface. yOffset is
  // only sent as an override when auto-calibration is switched off — leaving
  // it out of the object lets the engine's per-face estimate run instead, so
  // "auto" mode is actually exercised here, not just the manual override.
  useEffect(() => {
    const controller = handleRef.current?.controller;
    if (!controller) return;
    controller.setDebugOverrides({
      ...(autoYOffset ? {} : { yOffset: tuning.yOffset }),
      rootInset: tuning.rootInset,
      rootWidthMul: tuning.rootWidthMul,
      alphaFloorOverride: tuning.alphaFloor,
      lashCountMul: tuning.lashCountMul,
    });
    controller.setSmoothingParams({ minCutoff: tuning.minCutoff, beta: tuning.beta });
  }, [tuning, autoYOffset, status]);

  // Poll telemetry for the readout (fps / detection Hz / degrade level / per-eye stats).
  useEffect(() => {
    const id = setInterval(() => {
      const controller = handleRef.current?.controller;
      if (controller) setTelemetry(controller.getTelemetry());
    }, 300);
    return () => clearInterval(id);
  }, []);

  async function doCapture() {
    try {
      const blob = await handleRef.current?.capture();
      if (blob) setCaptureUrl(URL.createObjectURL(blob));
    } catch (e) {
      console.error(e);
    }
  }

  function setTuningValue(key: keyof Tuning, value: number) {
    setTuning((prev) => ({ ...prev, [key]: value }));
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
          background: "rgba(0,0,0,0.6)",
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

      {debug && (
        <div
          style={{
            position: "absolute",
            top: 46,
            insetInline: 0,
            maxHeight: "48vh",
            overflowY: "auto",
            background: "rgba(0,0,0,0.72)",
            padding: 10,
            fontSize: 11,
            lineHeight: 1.5,
          }}
        >
          <div style={{ color: "#00e5ff", marginBottom: 8, whiteSpace: "pre-wrap" }}>
            {telemetry
              ? `fps ${telemetry.fps.toFixed(1)}  detect ${telemetry.detectionHz.toFixed(1)}Hz  degrade L${telemetry.degradeLevel}  found ${telemetry.found}\n` +
                `openness L ${telemetry.openness.left.toFixed(2)} R ${telemetry.openness.right.toFixed(2)}  ` +
                `eyeWidth L ${telemetry.eyeWidth.left.toFixed(0)}px R ${telemetry.eyeWidth.right.toFixed(0)}px  ambient ${telemetry.ambientLuma.toFixed(2)}`
              : "waiting for telemetry…"}
          </div>

          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              marginBottom: 6,
              color: "#ffd166",
            }}
          >
            <input
              type="checkbox"
              checked={autoYOffset}
              onChange={(e) => setAutoYOffset(e.target.checked)}
            />
            auto-calibrate yOffset per face (shipped default — uncheck to override manually)
          </label>
          <label
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 2,
              marginBottom: 6,
              opacity: autoYOffset ? 0.4 : 1,
            }}
          >
            <span>
              yOffset manual override (lid anchoring, - = up): {tuning.yOffset.toFixed(3)}
            </span>
            <input
              type="range"
              min={-0.08}
              max={0.08}
              step={0.001}
              value={tuning.yOffset}
              disabled={autoYOffset}
              onChange={(e) => setTuningValue("yOffset", parseFloat(e.target.value))}
            />
          </label>

          {SLIDER_SPECS.map((spec) => (
            <label
              key={spec.key}
              style={{ display: "flex", flexDirection: "column", gap: 2, marginBottom: 6 }}
            >
              <span>
                {spec.label}: {tuning[spec.key].toFixed(3)}
              </span>
              <input
                type="range"
                min={spec.min}
                max={spec.max}
                step={spec.step}
                value={tuning[spec.key]}
                onChange={(e) => setTuningValue(spec.key, parseFloat(e.target.value))}
              />
            </label>
          ))}
          <button
            onClick={() => {
              setTuning(DEFAULT_TUNING);
              setAutoYOffset(true);
            }}
            style={{
              padding: "6px 10px",
              fontSize: 11,
              borderRadius: 6,
              border: "1px solid #444",
              background: "transparent",
              color: "#fff",
            }}
          >
            reset tuning to defaults
          </button>
        </div>
      )}

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
