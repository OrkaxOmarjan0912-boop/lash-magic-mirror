// Wraps MediaPipe Tasks Vision FaceLandmarker (official @mediapipe/tasks-vision
// npm package — the JS API is bundled, not fetched from a CDN at runtime).
//
// The WASM runtime and the .task model asset are still fetched over the network:
// neither ships inside the npm package (the model alone is several MB), and
// Google's own docs point at the jsdelivr-hosted wasm fileset for exactly this
// reason. Both URLs are overridable via FaceTrackerConfig for self-hosting.
import { FaceLandmarker, FilesetResolver, type NormalizedLandmark } from "@mediapipe/tasks-vision";
import { TRACKED_INDICES, TRACKED_COUNT } from "./landmarks";

export type FaceTrackerConfig = {
  wasmBasePath?: string;
  modelAssetPath?: string;
  delegate?: "GPU" | "CPU";
};

const DEFAULT_WASM_BASE = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
const DEFAULT_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

/** Detection cadence bounds (Hz) from spec §3 / §8's degradation ladder. */
export const DETECTION_HZ_MAX = 30;
export const DETECTION_HZ_MIN = 15;

/**
 * A single detection result, written into caller-owned flat buffers so the
 * render loop never allocates per frame. x/y are in the tracker's own
 * normalized [0,1] space (not yet mirrored or scaled to canvas pixels —
 * that happens in the smoother/geometry stage, which owns the pixel-space
 * buffers).
 */
export class TrackedFrame {
  readonly x = new Float64Array(TRACKED_COUNT);
  readonly y = new Float64Array(TRACKED_COUNT);
  found = false;
  timestampMs = 0;
}

export class FaceTracker {
  private landmarker: FaceLandmarker | null = null;
  private lastDetectMs = 0;
  private detectIntervalMs = 1000 / DETECTION_HZ_MAX;
  private lastCostMs = 0;
  private lowPower = false;

  async init(
    config: FaceTrackerConfig = {},
    runningMode: "VIDEO" | "IMAGE" = "VIDEO",
  ): Promise<void> {
    const fileset = await FilesetResolver.forVisionTasks(config.wasmBasePath ?? DEFAULT_WASM_BASE);
    this.landmarker = await FaceLandmarker.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath: config.modelAssetPath ?? DEFAULT_MODEL_URL,
        delegate: config.delegate ?? "GPU",
      },
      runningMode,
      numFaces: 1,
    });
  }

  get ready(): boolean {
    return this.landmarker != null;
  }

  /** Current adaptive detection cadence, for debug/telemetry display. */
  get detectionHz(): number {
    return 1000 / this.detectIntervalMs;
  }

  get lastDetectionCostMs(): number {
    return this.lastCostMs;
  }

  /** Degradation ladder step 1 (spec §8): force detection down to ~15Hz. */
  setLowPowerMode(on: boolean): void {
    this.lowPower = on;
  }

  /**
   * Runs detection at most once per adaptive interval; returns whether a new
   * detection happened. `out` is always safe to read afterward (unchanged if
   * this call didn't detect). Cadence self-tunes toward the §8 budget:
   * detection cost >7.5ms pushes the interval up (toward 15Hz), fast frames
   * relax it back down toward 30Hz.
   */
  detectForVideo(video: HTMLVideoElement, nowMs: number, out: TrackedFrame): boolean {
    if (!this.landmarker) return false;
    if (nowMs - this.lastDetectMs < this.detectIntervalMs) return false;

    const t0 = nowMs;
    const result = this.landmarker.detectForVideo(video, t0);
    this.lastCostMs = performance.now() - t0;
    this.lastDetectMs = t0;

    // Adapt cadence: budget is 15ms/frame (§8); leave headroom for render.
    const targetMs =
      this.lastCostMs > 15 || this.lowPower ? 1000 / DETECTION_HZ_MIN : 1000 / DETECTION_HZ_MAX;
    this.detectIntervalMs = this.detectIntervalMs * 0.7 + targetMs * 0.3;
    this.detectIntervalMs = Math.min(
      1000 / DETECTION_HZ_MIN,
      Math.max(1000 / DETECTION_HZ_MAX, this.detectIntervalMs),
    );

    return writeResult(result.faceLandmarks[0], out, nowMs);
  }

  detectImage(image: HTMLImageElement, out: TrackedFrame): boolean {
    if (!this.landmarker) return false;
    const result = this.landmarker.detect(image);
    return writeResult(result.faceLandmarks[0], out, performance.now());
  }

  destroy(): void {
    this.landmarker?.close();
    this.landmarker = null;
  }
}

function writeResult(
  face: NormalizedLandmark[] | undefined,
  out: TrackedFrame,
  nowMs: number,
): boolean {
  out.timestampMs = nowMs;
  if (!face) {
    out.found = false;
    return true;
  }
  out.found = true;
  for (let i = 0; i < TRACKED_COUNT; i++) {
    const p = face[TRACKED_INDICES[i]];
    out.x[i] = p.x;
    out.y[i] = p.y;
  }
  return true;
}
