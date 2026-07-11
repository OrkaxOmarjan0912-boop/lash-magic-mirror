// Compositing & capture (spec §7).
//
// The overlay canvas's backing store is always sized to the video's *native*
// resolution (video.videoWidth/Height), never to CSS display pixels. Both the
// <video> and the overlay <canvas> are displayed with identical CSS sizing
// and object-fit, so there is a single, implicit device-pixel-ratio-aware
// mapping between them — no separate DPR bookkeeping is needed because we
// never draw in CSS-pixel space to begin with.
//
// Capture reuses that same native-resolution space: it draws the current
// video frame plus a fresh call into the same LashRenderer onto an offscreen
// canvas of identical size, so the exported image is pixel-identical to what
// was on screen for that frame (never a DOM screenshot).

export function nativeCanvasSize(video: HTMLVideoElement): { width: number; height: number } {
  return { width: video.videoWidth || 1, height: video.videoHeight || 1 };
}

/** Mirrors the front camera for display, so captures match what the user saw (spec §3, §7). */
export function applyMirrorStyle(el: HTMLElement): void {
  el.style.transform = "scaleX(-1)";
}

export type CaptureOptions = {
  video: HTMLVideoElement;
  width: number;
  height: number;
  mirror: boolean;
  /** Replays this frame's lash draw calls onto the capture context. */
  drawLashes: (ctx: CanvasRenderingContext2D) => void;
  format?: "image/jpeg" | "image/png";
  quality?: number;
};

export function captureComposite(opts: CaptureOptions): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = opts.width;
  canvas.height = opts.height;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) return Promise.reject(new Error("captureComposite: 2d context unavailable"));

  ctx.save();
  if (opts.mirror) {
    ctx.translate(opts.width, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(opts.video, 0, 0, opts.width, opts.height);
  opts.drawLashes(ctx);
  ctx.restore();

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("captureComposite: toBlob returned null")),
      opts.format ?? "image/jpeg",
      opts.quality ?? 0.92,
    );
  });
}
