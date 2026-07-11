// Orchestrates the full pipeline (spec §2) behind the public
// LashTryOnController interface (spec §9). This is the only file the React
// wrapper / test harness talk to — nothing here reaches back into app code.
import { FaceTracker, TrackedFrame, type FaceTrackerConfig } from "./face-tracker";
import { LandmarkSmoother, LOSS_FADE_START_MS } from "./landmark-smoother";
import { EyeGeometry, yawForeshorten } from "./eye-geometry";
import { LashRenderer, type RenderParams } from "./lash-renderer";
import { LASH_STYLES, styleById, type LashStyle } from "./styles";
import { TRACKED_COUNT } from "./landmarks";
import { nativeCanvasSize, applyMirrorStyle, captureComposite } from "./compositor";

export type LashEvent = "faceFound" | "faceLost" | "lowLight" | "fpsDrop";

export interface LashTryOnController {
  attach(video: HTMLVideoElement, overlay: HTMLCanvasElement): Promise<void>;
  setStyle(styleId: string): void;
  setIntensity(v: number): void;
  setComparing(on: boolean): void;
  capture(): Promise<Blob>;
  setDebug(on: boolean): void;
  on(event: LashEvent, cb: () => void): void;
  off(event: LashEvent, cb: () => void): void;
  destroy(): void;
}

export type ControllerConfig = {
  tracker?: FaceTrackerConfig;
  initialStyleId?: string;
};

const FPS_FLOOR = 24;
const FPS_RECOVER = 30;
const DEGRADE_SUSTAIN_MS = 1000;
const RECOVER_SUSTAIN_MS = 2000;
const LOW_LIGHT_THRESHOLD = 0.35;

const AMBIENT_SAMPLE_SIZE = 12;
const AMBIENT_SAMPLE_INTERVAL_MS = 500;

class LashTryOnControllerImpl implements LashTryOnController {
  private video: HTMLVideoElement | null = null;
  private overlay: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private stream: MediaStream | null = null;

  private tracker = new FaceTracker();
  private smoother = new LandmarkSmoother();
  private eyeLeft = new EyeGeometry("left");
  private eyeRight = new EyeGeometry("right");
  private renderer = new LashRenderer();

  private frame = new TrackedFrame();
  private dispX = new Float64Array(TRACKED_COUNT);
  private dispY = new Float64Array(TRACKED_COUNT);

  private style: LashStyle = LASH_STYLES[0];
  private intensity = 1;
  private comparing = false;
  private debug = false;
  private running = false;
  private rafId: number | null = null;

  // FPS / degradation ladder state.
  private fpsEma = 0;
  private lastFrameMs = 0;
  private degradeLevel = 0; // 0=full, 1=detection@15Hz, 2=+lashCount-40%, 3=+render@30Hz
  private badSince = 0;
  private goodSince = 0;
  private renderSkip = false;

  // Ambient light.
  private ambientCanvas: HTMLCanvasElement | null = null;
  private ambientCtx: CanvasRenderingContext2D | null = null;
  private ambientLuma = 0.6;
  private lastAmbientSampleMs = 0;
  private wasLowLight = false;

  private lostEventEmitted = true; // starts "lost" until the first detection

  private listeners: Record<LashEvent, Set<() => void>> = {
    faceFound: new Set(),
    faceLost: new Set(),
    lowLight: new Set(),
    fpsDrop: new Set(),
  };

  // Last computed per-eye render params (minus ctx), so capture() can replay
  // this exact frame onto a different canvas without recomputing geometry.
  private lastLeftParams: Omit<RenderParams, "ctx"> | null = null;
  private lastRightParams: Omit<RenderParams, "ctx"> | null = null;

  constructor(private config: ControllerConfig = {}) {
    if (config.initialStyleId) this.style = styleById(config.initialStyleId);
  }

  async attach(video: HTMLVideoElement, overlay: HTMLCanvasElement): Promise<void> {
    this.video = video;
    this.overlay = overlay;
    this.ctx = overlay.getContext("2d", { alpha: true });
    if (!this.ctx) throw new Error("LashTryOnController: 2d context unavailable on overlay canvas");

    // Independent, so load the (large) WASM+model bundle and prompt for
    // camera permission concurrently rather than paying both latencies in
    // series. allSettled (not all) so that if one side fails we can still
    // release whatever the other side acquired, instead of leaking an open
    // camera stream or a loaded WASM instance.
    const [trackerResult, streamResult] = await Promise.allSettled([
      this.tracker.init(this.config.tracker, "VIDEO"),
      navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      }),
    ]);
    if (trackerResult.status === "rejected") {
      this.tracker.destroy();
      if (streamResult.status === "fulfilled")
        streamResult.value.getTracks().forEach((t) => t.stop());
      throw trackerResult.reason;
    }
    if (streamResult.status === "rejected") {
      this.tracker.destroy();
      throw streamResult.reason;
    }
    const stream = streamResult.value;
    this.stream = stream;
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    await video.play();

    applyMirrorStyle(video);
    applyMirrorStyle(overlay);

    this.ambientCanvas = document.createElement("canvas");
    this.ambientCanvas.width = AMBIENT_SAMPLE_SIZE;
    this.ambientCanvas.height = AMBIENT_SAMPLE_SIZE;
    this.ambientCtx = this.ambientCanvas.getContext("2d", { willReadFrequently: true });

    this.running = true;
    this.rafId = requestAnimationFrame(this.loop);
  }

  setStyle(styleId: string): void {
    this.style = styleById(styleId);
  }

  setIntensity(v: number): void {
    this.intensity = Math.min(1.5, Math.max(0.5, v));
  }

  setComparing(on: boolean): void {
    this.comparing = on;
  }

  setDebug(on: boolean): void {
    this.debug = on;
  }

  on(event: LashEvent, cb: () => void): void {
    this.listeners[event].add(cb);
  }

  off(event: LashEvent, cb: () => void): void {
    this.listeners[event].delete(cb);
  }

  private emit(event: LashEvent): void {
    this.listeners[event].forEach((cb) => cb());
  }

  async capture(): Promise<Blob> {
    const video = this.video;
    if (!video) throw new Error("LashTryOnController: capture() called before attach()");
    const { width, height } = nativeCanvasSize(video);

    return captureComposite({
      video,
      width,
      height,
      mirror: true,
      drawLashes: (ctx) => {
        if (this.comparing) return;
        if (this.lastLeftParams) this.renderer.render({ ctx, ...this.lastLeftParams });
        if (this.lastRightParams) this.renderer.render({ ctx, ...this.lastRightParams });
      },
    });
  }

  destroy(): void {
    this.running = false;
    if (this.rafId != null) cancelAnimationFrame(this.rafId);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.tracker.destroy();
    (Object.keys(this.listeners) as LashEvent[]).forEach((k) => this.listeners[k].clear());
  }

  private loop = (nowMs: number): void => {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this.loop);

    const video = this.video;
    const overlay = this.overlay;
    const ctx = this.ctx;
    if (!video || !overlay || !ctx || video.readyState < 2) return;

    // Degradation ladder step 3: render at ~30Hz by skipping alternate frames.
    if (this.degradeLevel >= 3) {
      this.renderSkip = !this.renderSkip;
      if (this.renderSkip) return;
    }

    this.resizeCanvasIfNeeded(video, overlay);
    this.sampleAmbientLight(video, nowMs);

    if (this.tracker.detectForVideo(video, nowMs, this.frame)) {
      this.smoother.ingest(this.frame, overlay.width, overlay.height, false);
      if (this.frame.found && this.lostEventEmitted) {
        this.lostEventEmitted = false;
        this.emit("faceFound");
      }
    }

    const opacity = this.smoother.sample(nowMs, this.dispX, this.dispY);
    // Mirrors spec §4's own ">200ms" loss threshold, rather than firing on
    // every single missed detection (which would flicker on transient misses).
    if (!this.lostEventEmitted && this.smoother.msSinceFound(nowMs) > LOSS_FADE_START_MS) {
      this.lostEventEmitted = true;
      this.emit("faceLost");
    }

    ctx.clearRect(0, 0, overlay.width, overlay.height);

    if (opacity > 0) {
      this.eyeLeft.update(this.dispX, this.dispY, nowMs);
      this.eyeRight.update(this.dispX, this.dispY, nowMs);

      if (!this.comparing && this.eyeLeft.valid && this.eyeRight.valid) {
        const quality = this.degradeLevel >= 2 ? 0.6 : 1;

        const leftParams = {
          geometry: this.eyeLeft,
          style: this.style,
          intensity: this.intensity,
          otherEyeWidth: this.eyeRight.eyeWidth,
          yawScale: yawForeshorten(this.eyeLeft.eyeWidth, this.eyeRight.eyeWidth),
          ambientLuma: this.ambientLuma,
          quality,
          fadeOpacity: opacity,
          debug: this.debug,
        };
        const rightParams = {
          geometry: this.eyeRight,
          style: this.style,
          intensity: this.intensity,
          otherEyeWidth: this.eyeLeft.eyeWidth,
          yawScale: yawForeshorten(this.eyeRight.eyeWidth, this.eyeLeft.eyeWidth),
          ambientLuma: this.ambientLuma,
          quality,
          fadeOpacity: opacity,
          debug: this.debug,
        };

        this.renderer.render({ ctx, ...leftParams });
        this.renderer.render({ ctx, ...rightParams });
        this.lastLeftParams = leftParams;
        this.lastRightParams = rightParams;
      }
    }

    if (this.debug) this.drawDebugHud(ctx, overlay);

    this.trackFps(nowMs);
  };

  private resizeCanvasIfNeeded(video: HTMLVideoElement, overlay: HTMLCanvasElement): void {
    const { width, height } = nativeCanvasSize(video);
    if (overlay.width !== width || overlay.height !== height) {
      overlay.width = width;
      overlay.height = height;
    }
  }

  private sampleAmbientLight(video: HTMLVideoElement, nowMs: number): void {
    if (!this.ambientCtx || nowMs - this.lastAmbientSampleMs < AMBIENT_SAMPLE_INTERVAL_MS) return;
    this.lastAmbientSampleMs = nowMs;
    try {
      this.ambientCtx.drawImage(video, 0, 0, AMBIENT_SAMPLE_SIZE, AMBIENT_SAMPLE_SIZE);
      const data = this.ambientCtx.getImageData(
        0,
        0,
        AMBIENT_SAMPLE_SIZE,
        AMBIENT_SAMPLE_SIZE,
      ).data;
      let sum = 0;
      const px = AMBIENT_SAMPLE_SIZE * AMBIENT_SAMPLE_SIZE;
      for (let i = 0; i < data.length; i += 4) {
        sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      }
      this.ambientLuma = sum / px / 255;
    } catch {
      // Cross-origin or not-yet-ready video frame; keep the last estimate.
    }

    const isLow = this.ambientLuma < LOW_LIGHT_THRESHOLD;
    if (isLow && !this.wasLowLight) this.emit("lowLight");
    this.wasLowLight = isLow;
  }

  private trackFps(nowMs: number): void {
    if (!this.lastFrameMs) {
      this.lastFrameMs = nowMs;
      return;
    }
    const dt = nowMs - this.lastFrameMs;
    this.lastFrameMs = nowMs;
    if (dt <= 0) return;
    const fps = 1000 / dt;
    this.fpsEma = this.fpsEma ? this.fpsEma * 0.9 + fps * 0.1 : fps;

    if (this.fpsEma < FPS_FLOOR) {
      this.goodSince = 0;
      if (!this.badSince) this.badSince = nowMs;
      if (nowMs - this.badSince > DEGRADE_SUSTAIN_MS && this.degradeLevel < 3) {
        this.degradeLevel++;
        this.tracker.setLowPowerMode(this.degradeLevel >= 1);
        this.badSince = nowMs;
        this.emit("fpsDrop");
      }
    } else if (this.fpsEma > FPS_RECOVER) {
      this.badSince = 0;
      if (!this.goodSince) this.goodSince = nowMs;
      if (nowMs - this.goodSince > RECOVER_SUSTAIN_MS && this.degradeLevel > 0) {
        this.degradeLevel--;
        this.tracker.setLowPowerMode(this.degradeLevel >= 1);
        this.goodSince = nowMs;
      }
    } else {
      this.badSince = 0;
      this.goodSince = 0;
    }
  }

  private drawDebugHud(ctx: CanvasRenderingContext2D, overlay: HTMLCanvasElement): void {
    ctx.save();
    // Debug text should read correctly even though the canvas is CSS-mirrored.
    ctx.setTransform(-1, 0, 0, 1, overlay.width, 0);
    ctx.font = "12px monospace";
    ctx.fillStyle = "#00e5ff";
    ctx.textBaseline = "top";
    const lines = [
      `fps ${this.fpsEma.toFixed(1)}  detect ${this.tracker.detectionHz.toFixed(1)}Hz  degrade L${this.degradeLevel}`,
      `openness L ${this.eyeLeft.openness.toFixed(2)} R ${this.eyeRight.openness.toFixed(2)}`,
      `eyeWidth L ${this.eyeLeft.eyeWidth.toFixed(0)}px R ${this.eyeRight.eyeWidth.toFixed(0)}px`,
      `ambient ${this.ambientLuma.toFixed(2)}  found ${this.smoother.isFound}`,
    ];
    lines.forEach((line, i) => ctx.fillText(line, 10, 10 + i * 16));
    ctx.restore();
  }
}

export function createLashTryOnController(config?: ControllerConfig): LashTryOnController {
  return new LashTryOnControllerImpl(config);
}
