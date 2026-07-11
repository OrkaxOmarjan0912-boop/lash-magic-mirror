// Live camera + MediaPipe FaceLandmarker + procedural lash renderer.
// Detection runs at up to 30Hz; rendering runs every animation frame with
// smoothed + interpolated landmarks (One Euro) so lashes glue to the lids
// even when detection frames are missed.
import { useEffect, useRef, useState } from "react";
import {
  drawLashes,
  LEFT_UPPER_LID,
  LEFT_LOWER_LID,
  RIGHT_UPPER_LID,
  RIGHT_LOWER_LID,
  LEFT_LID_MID,
  RIGHT_LID_MID,
  eyeOpenness,
  type Pt,
} from "./LashRenderer";
import { OneEuroPoints } from "@/lib/one-euro";
import type { LashStyle } from "@/lib/lash-styles";

type Props = {
  style: LashStyle;
  intensity: number;
  showBefore: boolean;
  debug?: boolean;
  staticImage?: HTMLImageElement | null;
  onReady?: (api: { capture: () => string | null }) => void;
  onStatus?: (s: TrackingStatus) => void;
  onFps?: (fps: number) => void;
};

export type TrackingStatus =
  | "loading"
  | "requesting-camera"
  | "denied"
  | "no-face"
  | "low-light"
  | "tracking"
  | "static";

const VISION_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

// Landmarks we actually need to smooth. Smaller set = faster filter step.
const TRACKED_INDICES = Array.from(
  new Set([
    ...LEFT_UPPER_LID,
    ...LEFT_LOWER_LID,
    ...RIGHT_UPPER_LID,
    ...RIGHT_LOWER_LID,
    LEFT_LID_MID.upper,
    LEFT_LID_MID.lower,
    RIGHT_LID_MID.upper,
    RIGHT_LID_MID.lower,
  ]),
);
const MAX_INDEX = Math.max(...TRACKED_INDICES);

export function LashOverlay({
  style,
  intensity,
  showBefore,
  debug,
  staticImage,
  onReady,
  onStatus,
  onFps,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);
  const landmarkerRef = useRef<any>(null);
  const rawLandmarksRef = useRef<Pt[] | null>(null);
  const smoothedRef = useRef<Pt[] | null>(null);
  const filterRef = useRef<OneEuroPoints | null>(null);
  const [status, setStatus] = useState<TrackingStatus>("loading");

  const styleRef = useRef(style);
  const intensityRef = useRef(intensity);
  const showBeforeRef = useRef(showBefore);
  const debugRef = useRef(!!debug);
  styleRef.current = style;
  intensityRef.current = intensity;
  showBeforeRef.current = showBefore;
  debugRef.current = !!debug;

  const setS = (s: TrackingStatus) => {
    setStatus(s);
    onStatus?.(s);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const vision: any = await import(/* @vite-ignore */ VISION_URL);
        const fileset = await vision.FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm",
        );
        const lm = await vision.FaceLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
          runningMode: staticImage ? "IMAGE" : "VIDEO",
          numFaces: 1,
        });
        if (cancelled) return;
        landmarkerRef.current = lm;
        if (staticImage) processStatic();
        else startCamera();
      } catch (e) {
        console.error("MediaPipe load failed", e);
        setS("denied");
      }
    })();
    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      const v = videoRef.current;
      if (v?.srcObject) (v.srcObject as MediaStream).getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staticImage]);

  useEffect(() => {
    onReady?.({
      capture: () => canvasRef.current?.toDataURL("image/jpeg", 0.92) ?? null,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function startCamera() {
    setS("requesting-camera");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      const v = videoRef.current!;
      v.srcObject = stream;
      await v.play();
      setS("tracking");
      loop();
    } catch (e) {
      console.error(e);
      setS("denied");
    }
  }

  const perfRef = useRef({
    lastDetect: 0,
    detectInterval: 33,
    lastFrame: 0,
    fpsEma: 0,
    lowFpsSince: 0,
    intensityAdjust: 1, // reduces lash count when FPS drops
    ctx: null as CanvasRenderingContext2D | null,
    ambientLuma: 0.5,
    ambientSampledAt: 0,
    lastEyeWidth: 0,
  });

  function computeMirroredLandmarks(
    raw: { x: number; y: number }[],
    w: number,
    h: number,
    mirrored: boolean,
  ): Pt[] {
    const out: Pt[] = new Array(MAX_INDEX + 1);
    for (const idx of TRACKED_INDICES) {
      const p = raw[idx];
      out[idx] = { x: mirrored ? w - p.x * w : p.x * w, y: p.y * h };
    }
    return out;
  }

  function updateSmoothed(nowMs: number) {
    const raw = rawLandmarksRef.current;
    if (!raw) return;
    if (!filterRef.current) {
      filterRef.current = new OneEuroPoints(TRACKED_INDICES.length, 1.1, 0.02);
    }
    const flat = TRACKED_INDICES.map((i) => raw[i]);
    const smooth = filterRef.current.filter(flat, nowMs);
    const out: Pt[] = new Array(MAX_INDEX + 1);
    TRACKED_INDICES.forEach((idx, k) => (out[idx] = smooth[k]));
    smoothedRef.current = out;
  }

  function loop() {
    const v = videoRef.current;
    const c = canvasRef.current;
    if (!v || !c || !landmarkerRef.current) {
      rafRef.current = requestAnimationFrame(loop);
      return;
    }
    if (v.readyState >= 2) {
      const perf = perfRef.current;
      const vw = v.videoWidth;
      const vh = v.videoHeight;
      const maxEdge = 720;
      const scale = Math.min(1, maxEdge / Math.max(vw, vh));
      const cw = Math.round(vw * scale);
      const ch = Math.round(vh * scale);
      if (c.width !== cw || c.height !== ch) {
        c.width = cw;
        c.height = ch;
        perf.ctx = c.getContext("2d", {
          alpha: false,
          desynchronized: true,
        } as any) as CanvasRenderingContext2D | null;
      }
      const ctx = perf.ctx ?? c.getContext("2d")!;

      // Video draw (mirrored)
      ctx.setTransform(-1, 0, 0, 1, cw, 0);
      ctx.drawImage(v, 0, 0, cw, ch);
      ctx.setTransform(1, 0, 0, 1, 0, 0);

      const now = performance.now();

      // Detection (throttled, adaptive)
      if (now - perf.lastDetect >= perf.detectInterval) {
        const t0 = now;
        try {
          const result = landmarkerRef.current.detectForVideo(v, t0);
          const face = result?.faceLandmarks?.[0];
          if (face) {
            rawLandmarksRef.current = computeMirroredLandmarks(face, cw, ch, true);
            updateSmoothed(now);
          } else {
            rawLandmarksRef.current = null;
            smoothedRef.current = null;
            filterRef.current?.reset();
          }
        } catch {}
        const cost = performance.now() - t0;
        perf.detectInterval = Math.min(90, Math.max(33, cost * 2.0));
        perf.lastDetect = t0;
      }

      // Ambient luma sampling (~every 500ms) — cheap 8x8 downsample
      if (now - perf.ambientSampledAt > 500) {
        try {
          const sample = ctx.getImageData(cw / 2 - 20, ch / 2 - 20, 40, 40).data;
          let sum = 0;
          for (let i = 0; i < sample.length; i += 4) {
            sum += 0.299 * sample[i] + 0.587 * sample[i + 1] + 0.114 * sample[i + 2];
          }
          perf.ambientLuma = sum / (sample.length / 4) / 255;
        } catch {}
        perf.ambientSampledAt = now;
      }

      const smoothed = smoothedRef.current;
      if (!smoothed) {
        if (status !== "no-face") setS("no-face");
      } else {
        if (status !== "tracking") setS("tracking");
        if (!showBeforeRef.current) {
          // Estimate the larger eye width for yaw scaling of the far eye
          const leftW = eyeOpenness(smoothed, "left").eyeWidth;
          const rightW = eyeOpenness(smoothed, "right").eyeWidth;
          const ref = Math.max(leftW, rightW);
          perf.lastEyeWidth = ref;

          const effectiveIntensity = intensityRef.current * perf.intensityAdjust;

          drawLashes({
            ctx,
            landmarks: smoothed,
            style: styleRef.current,
            intensity: effectiveIntensity,
            side: "left",
            canvasWidth: cw,
            canvasHeight: ch,
            debug: debugRef.current,
            eyeWidthRef: ref,
            ambientLuma: perf.ambientLuma,
          });
          drawLashes({
            ctx,
            landmarks: smoothed,
            style: styleRef.current,
            intensity: effectiveIntensity,
            side: "right",
            canvasWidth: cw,
            canvasHeight: ch,
            debug: debugRef.current,
            eyeWidthRef: ref,
            ambientLuma: perf.ambientLuma,
          });
        }
      }

      // FPS tracking + auto-degrade
      if (perf.lastFrame) {
        const dt = now - perf.lastFrame;
        const fps = 1000 / dt;
        perf.fpsEma = perf.fpsEma ? perf.fpsEma * 0.9 + fps * 0.1 : fps;
        onFps?.(perf.fpsEma);
        if (perf.fpsEma < 20) {
          if (!perf.lowFpsSince) perf.lowFpsSince = now;
          if (now - perf.lowFpsSince > 1200 && perf.intensityAdjust > 0.55) {
            perf.intensityAdjust = Math.max(0.55, perf.intensityAdjust - 0.05);
          }
        } else if (perf.fpsEma > 28) {
          perf.lowFpsSince = 0;
          if (perf.intensityAdjust < 1) perf.intensityAdjust = Math.min(1, perf.intensityAdjust + 0.02);
        }
      }
      perf.lastFrame = now;
    }
    rafRef.current = requestAnimationFrame(loop);
  }

  async function processStatic() {
    const img = staticImage!;
    const c = canvasRef.current!;
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext("2d")!;

    const render = () => {
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0);
      if (showBeforeRef.current) return;
      try {
        const result = landmarkerRef.current.detect(img);
        const face = result?.faceLandmarks?.[0];
        if (!face) {
          setS("no-face");
          return;
        }
        setS("static");
        const marks: Pt[] = new Array(MAX_INDEX + 1);
        for (const idx of TRACKED_INDICES) {
          const p = face[idx];
          marks[idx] = { x: p.x * c.width, y: p.y * c.height };
        }
        const leftW = eyeOpenness(marks, "left").eyeWidth;
        const rightW = eyeOpenness(marks, "right").eyeWidth;
        const ref = Math.max(leftW, rightW);
        for (const side of ["left", "right"] as const) {
          drawLashes({
            ctx,
            landmarks: marks,
            style: styleRef.current,
            intensity: intensityRef.current,
            side,
            canvasWidth: c.width,
            canvasHeight: c.height,
            debug: debugRef.current,
            eyeWidthRef: ref,
          });
        }
      } catch (e) {
        console.error(e);
      }
    };

    render();
    const iv = setInterval(() => {
      if (!canvasRef.current) return clearInterval(iv);
      render();
    }, 200);
  }

  return (
    <div className="relative w-full h-full overflow-hidden bg-black">
      <video ref={videoRef} playsInline muted className="hidden" />
      <canvas ref={canvasRef} className="w-full h-full object-cover" />
      {status === "requesting-camera" && <Overlay text="Requesting camera…" />}
      {status === "loading" && <Overlay text="Loading face tracker…" />}
      {status === "no-face" && <Overlay text="Center your face in the frame" subtle />}
    </div>
  );
}

function Overlay({ text, subtle }: { text: string; subtle?: boolean }) {
  return (
    <div className="absolute inset-0 grid place-items-center pointer-events-none">
      <div
        className={`px-5 py-2 rounded-full font-serif italic text-lg ${
          subtle ? "bg-black/40 text-white/90" : "bg-black/70 text-white"
        }`}
      >
        {text}
      </div>
    </div>
  );
}
