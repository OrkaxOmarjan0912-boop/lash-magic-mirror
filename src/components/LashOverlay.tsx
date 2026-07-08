// Live camera + MediaPipe FaceLandmarker + lash overlay renderer.
// Fully client-side; nothing is uploaded.
import { useEffect, useRef, useState } from "react";
import { drawLashesForEye, LEFT_UPPER, RIGHT_UPPER, type Pt } from "./LashRenderer";
import type { LashStyle } from "@/lib/lash-styles";

type Props = {
  style: LashStyle;
  intensity: number;
  showBefore: boolean;
  staticImage?: HTMLImageElement | null;
  onReady?: (api: { capture: () => string | null }) => void;
  onStatus?: (s: TrackingStatus) => void;
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

export function LashOverlay({ style, intensity, showBefore, staticImage, onReady, onStatus }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);
  const landmarkerRef = useRef<any>(null);
  const lastLandmarksRef = useRef<any>(null);
  const [status, setStatus] = useState<TrackingStatus>("loading");
  const styleRef = useRef(style);
  const intensityRef = useRef(intensity);
  const showBeforeRef = useRef(showBefore);
  styleRef.current = style;
  intensityRef.current = intensity;
  showBeforeRef.current = showBefore;

  const setS = (s: TrackingStatus) => {
    setStatus(s);
    onStatus?.(s);
  };

  // Init MediaPipe once
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
        if (staticImage) {
          processStatic();
        } else {
          startCamera();
        }
      } catch (e) {
        console.error("MediaPipe load failed", e);
        setS("denied");
      }
    })();
    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      const v = videoRef.current;
      if (v?.srcObject) {
        (v.srcObject as MediaStream).getTracks().forEach((t) => t.stop());
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staticImage]);

  // Expose capture API
  useEffect(() => {
    onReady?.({
      capture: () => {
        const c = canvasRef.current;
        if (!c) return null;
        return c.toDataURL("image/jpeg", 0.92);
      },
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

  let lastDetect = 0;
  function loop() {
    const v = videoRef.current;
    const c = canvasRef.current;
    if (!v || !c || !landmarkerRef.current) {
      rafRef.current = requestAnimationFrame(loop);
      return;
    }
    if (v.readyState >= 2) {
      c.width = v.videoWidth;
      c.height = v.videoHeight;
      const ctx = c.getContext("2d")!;
      // mirror horizontally for selfie
      ctx.save();
      ctx.translate(c.width, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(v, 0, 0, c.width, c.height);
      ctx.restore();

      // throttle detection to ~24fps
      const now = performance.now();
      if (now - lastDetect > 40) {
        try {
          const result = landmarkerRef.current.detectForVideo(v, now);
          lastLandmarksRef.current = result?.faceLandmarks?.[0] ?? null;
        } catch (e) {
          // ignore per-frame errors
        }
        lastDetect = now;
      }

      const landmarks = lastLandmarksRef.current;
      if (!landmarks) {
        if (status !== "no-face") setS("no-face");
      } else {
        if (status !== "tracking") setS("tracking");
        if (!showBeforeRef.current) {
          drawOverlay(ctx, landmarks, c.width, c.height, true);
        }
      }
    }
    rafRef.current = requestAnimationFrame(loop);
  }

  async function processStatic() {
    const img = staticImage!;
    const c = canvasRef.current!;
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    setS("static");
    try {
      const result = landmarkerRef.current.detect(img);
      const landmarks = result?.faceLandmarks?.[0];
      if (landmarks) {
        drawOverlay(ctx, landmarks, c.width, c.height, false);
      } else {
        setS("no-face");
      }
    } catch (e) {
      console.error(e);
    }
    // Redraw when style/intensity changes
    const observer = setInterval(() => {
      if (!canvasRef.current) return clearInterval(observer);
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0);
      if (!showBeforeRef.current) {
        try {
          const result = landmarkerRef.current.detect(img);
          const landmarks = result?.faceLandmarks?.[0];
          if (landmarks) drawOverlay(ctx, landmarks, c.width, c.height, false);
        } catch {}
      }
    }, 200);
  }

  function drawOverlay(
    ctx: CanvasRenderingContext2D,
    landmarks: { x: number; y: number }[],
    w: number,
    h: number,
    mirrored: boolean,
  ) {
    const toPt = (idx: number): Pt => {
      const p = landmarks[idx];
      const x = mirrored ? w - p.x * w : p.x * w;
      return { x, y: p.y * h };
    };
    const left = LEFT_UPPER.map(toPt);
    const right = RIGHT_UPPER.map(toPt);
    drawLashesForEye(ctx, left, styleRef.current, intensityRef.current);
    drawLashesForEye(ctx, right, styleRef.current, intensityRef.current);
  }

  return (
    <div className="relative w-full h-full overflow-hidden bg-black">
      <video ref={videoRef} playsInline muted className="hidden" />
      <canvas ref={canvasRef} className="w-full h-full object-cover" />
      {status === "requesting-camera" && (
        <Overlay text="Requesting camera…" />
      )}
      {status === "loading" && <Overlay text="Loading face tracker…" />}
      {status === "no-face" && (
        <Overlay text="Center your face in the frame" subtle />
      )}
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
