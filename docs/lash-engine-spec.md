# LashMirror — Lash Rendering Module: Technical Specification

Version: 1.0

Scope: The real-time AR lash try-on rendering module only. Excludes app shell, booking, gallery, and backend — those remain in the existing Lovable codebase. This module must be a drop-in replacement for the current overlay component.

---

## 1. Goal & quality bar

Render eyelash extension styles on a live selfie video feed such that lashes:

- Follow the user's exact upper eyelid contour per eye
- Stay visually "glued" to the lids during head movement (±25° roll/yaw/pitch)
- Compress naturally during blinks (zero frames of lashes floating over closed eyes)
- Are clearly visible and read as realistic lashes at arm's-length selfie distance, across skin tones and typical indoor lighting
- Render identically in the saved/captured photo as in the live view

This module is the product's core selling point. "Works but looks fake" is a failing grade.

## 2. Architecture overview

```
CameraFeed (getUserMedia, 720p front camera)
   │
   ▼
FaceTracker ──────────── MediaPipe Tasks Vision FaceLandmarker
   │  (raw 478 landmarks @ detection rate, ≤30 Hz)
   ▼
LandmarkSmoother ─────── One Euro filter per tracked point
   │  (smoothed, interpolated landmarks @ display refresh rate)
   ▼
EyeGeometry ──────────── per-eye: lid spline, eye width, openness, roll
   │
   ▼
LashRenderer ─────────── procedural per-lash drawing to overlay canvas
   │  (style params + intensity from UI)
   ▼
Compositor ───────────── video layer + lash canvas; capture-to-image path
```

All modules are plain TypeScript with no framework dependency; a thin React wrapper component exposes the module to the existing app.

## 3. Face tracking

Library: MediaPipe Tasks Vision `FaceLandmarker` (WASM + GPU delegate where available), `runningMode: VIDEO`, `numFaces: 1`.

Detection cadence: every video frame up to 30 Hz; on low-end devices allow decimation to 15–20 Hz (see §8).

Landmarks consumed:

- Right upper lid arc: indices 33 (inner corner), 246, 161, 160, 159, 158, 157, 173, 133 (outer corner)
- Left upper lid arc: indices 362 (inner corner), 398, 384, 385, 386, 387, 388, 466, 263 (outer corner)
- Lower lid midpoints for openness: right 145, left 374

Verify indices against the canonical FaceMesh landmark map at implementation time; treat the arcs above as the intended anatomy (full upper-lid contour, corner to corner), not gospel.

Coordinate handling: normalized landmarks → pixel space of the render canvas, correcting for video/canvas aspect and mirroring (front camera is mirrored for display; captured images must match what the user sees).

## 4. Landmark smoothing

Filter: One Euro filter per landmark coordinate (x, y independently).

Suggested starting params: `minCutoff = 1.2 Hz`, `beta = 0.02`, `dCutoff = 1.0 Hz`. Tune on-device.

Rationale: fixed low-pass creates lag during fast head motion; One Euro adapts — heavy smoothing when still (kills jitter), light smoothing when moving (kills lag).

Interpolation: rendering runs at display refresh (60 Hz typical) while detection runs ≤30 Hz. Between detections, extrapolate/interpolate smoothed positions linearly using last velocity; clamp extrapolation to 50 ms to avoid overshoot artifacts.

Loss of tracking: if no face for >200 ms, fade lash opacity to 0 over 150 ms rather than freezing or snapping.

## 5. Eye geometry (per eye, per frame)

Compute from smoothed landmarks:

- Lid spline: centripetal Catmull-Rom through the upper-lid arc points, sampled to N=32 evenly spaced points (arc-length parameterized). This is the lash root curve.
- Eye width `W`: distance inner-corner → outer-corner, in px. All lash dimensions scale from `W`.
- Roll: angle of the corner-to-corner vector; used to orient flare direction.
- Openness `O`: vertical distance upper-lid-mid → lower-lid-mid, normalized by `W`. Calibrate: typical open ≈ 0.28–0.35, closed < 0.08. Maintain a per-session rolling max to normalize per user: `o = clamp(O / O_maxSession, 0, 1)`.
- Yaw proxy: ratio of left-eye `W` to right-eye `W`; use to foreshorten lash length on the far eye (linear, max 25% reduction).

## 6. Lash rendering

### 6.1 Per-lash model

Each lash is a quadratic Bézier drawn as a tapered stroke:

- Root: on the lid spline at parameter `t ∈ [0.05, 0.95]` (inset from corners)
- Direction: outward normal of the spline at `t`, rotated by the style's flare profile (more outward-canted near the outer corner)
- Length: `L(t) = W × style.lengthProfile(t) × intensity`
- Curl: control point offset perpendicular to lash direction producing an upward curl; curl magnitude = `style.curl × L`
- Taper: stroke width from `style.rootWidth` (≈2.5 px @ 720p, scaled by `W/W_ref`) at root to 0.3 px at tip. Implement taper by drawing the lash as a filled quad-strip/path, not a uniform-width stroke.

### 6.2 Style definition (data-driven)

```ts
interface LashStyle {
  id: string;                       // "classic" | "hybrid" | "volume" | ...
  lashCount: number;                // per eye, at intensity 1.0
  lengthProfile: (t: number) => number; // returns fraction of eye width, e.g. 0.25–0.45
  curl: number;                     // 0 (straight) – 1 (doll curl)
  flare: (t: number) => number;     // radians of outward cant by position
  clustering: number;               // 0 = even spacing, 1 = grouped fans
  densityJitter: number;            // random spacing/length variation seed-stable per session
  rootWidth: number;                // px at reference eye width
  calibration: { yOffset: number; rootInset: number }; // per-style fine-tune, config not code
}
```

Six launch styles (Classic, Hybrid, Volume, Mega Volume, Cat Eye, Doll Eye) expressed purely as parameter sets. Cat Eye: `lengthProfile` ramps up over outer third. Doll Eye: peak at `t = 0.5`.

### 6.3 Visual realism requirements

- Color `#1a1a1a` with per-lash alpha jitter 0.75–0.95 (stable per lash per session — no shimmer)
- 1 px feathered edge (slight blur or alpha ramp on the tapered path) so strokes read as hair
- A soft lash-line shadow: 2–3 px wide, ~20% black, drawn along the root spline beneath the lashes to ground them
- Sub-pixel positioning (no integer snapping)
- Random per-lash length/angle jitter (±8%) from a session-stable seed — uniform lashes look printed

### 6.4 Blink behavior

For openness `o < 0.85`: scale lash curl height by `o` and translate roots with the (moving) upper-lid spline — the spline itself tracks the closing lid, so lashes ride down naturally.

For `o < 0.25`: additionally fold lash direction toward horizontal/downward and reduce opacity to 60%, mimicking lashes resting on the lower lid.

All transitions continuous — no thresholds that visibly pop.

### 6.5 Visibility floor

At default intensity in a 720p feed with the face occupying ≥40% of frame height, each eye's lash silhouette must be clearly discernible at 100% zoom.

If mean luminance of the eye region is low (dark scene), raise lash alpha floor to 0.9 and shadow opacity to 30% instead of letting lashes vanish.

## 7. Compositing & capture

Overlay `<canvas>` positioned exactly over the `<video>` element; both share one device-pixel-ratio-aware coordinate system.

Capture path: draw current video frame + lash layer into an offscreen canvas at native video resolution (not CSS pixels) and export PNG/JPEG. The capture must run the same renderer — never screenshot the DOM.

Before/after: hold-to-compare simply skips the lash draw; no separate pipeline.

## 8. Performance budgets

| Item | Budget |
|---|---|
| Landmark detection | ≤ 15 ms/frame mid-range Android (GPU delegate), else decimate to 15 Hz |
| Geometry + render | ≤ 4 ms/frame @ 60 Hz |
| Heap allocation in render loop | zero (preallocate typed arrays, reuse Path2D where possible) |
| Degradation ladder | 1) drop detection to 15 Hz → 2) reduce lashCount 40% (draw fans) → 3) drop render to 30 Hz |
| FPS floor | never below 24 fps rendered |

## 9. Public interface (contract with the Lovable app)

```ts
interface LashTryOnController {
  attach(video: HTMLVideoElement, overlay: HTMLCanvasElement): Promise<void>;
  setStyle(styleId: string): void;
  setIntensity(v: number): void;        // 0.5–1.5
  setComparing(on: boolean): void;      // before/after hold
  capture(): Promise<Blob>;             // composited image
  setDebug(on: boolean): void;          // draws spline + landmarks
  on(event: 'faceFound' | 'faceLost' | 'lowLight' | 'fpsDrop', cb: () => void): void;
  destroy(): void;
}
```

The existing style carousel, intensity slider, and capture button wire to this interface only. No app code reaches into module internals.

## 10. Debug & calibration

Debug overlay (triple-tap logo or `setDebug(true)`): renders raw vs smoothed landmarks, fitted spline, eye width, openness value, FPS, detection Hz.

Per-style `calibration` offsets adjustable via config JSON without rebuild.

Log (dev only) tracking-loss events and FPS percentiles.

## 11. Acceptance tests

Manual test matrix — must pass on: recent iPhone (Safari), mid-range Android (Chrome), low-end Android (Chrome).

- Anchoring: lashes hug lid contour at rest; debug spline overlaps visible lash line within ~2 px.
- Motion: head roll ±25°, yaw ±25°, slow and fast — no swimming, no lag > 1 frame perceptible.
- Jitter: holding still for 10 s, lash roots move < 1 px.
- Blink: slow blink and rapid blinks — lashes ride the lid down, never float; 240 fps slow-mo screen recording shows no floating frames.
- Distance: works from 25 cm to 60 cm; lashes scale proportionally.
- Lighting/skin tones: clearly visible in dim indoor light and on light, medium, and deep skin tones.
- Styles: all 6 styles visually distinct in a blind side-by-side; Cat Eye and Doll Eye silhouettes unmistakable.
- Capture: saved image pixel-matches live view (same frame).
- Performance: ≥24 fps sustained for 2 min on mid-range Android; no memory growth.
- Failure modes: camera denied → clean fallback message; face lost → graceful fade, instant recovery.

## 12. Out of scope (v1 of this module)

- Lower-lash rendering
- Color/tint variations
- Multi-face support
- 3D head-pose lash occlusion beyond the yaw foreshortening proxy
- ML-based lash segmentation of the user's natural lashes

---

Deliverable: a single TypeScript package (`/src/lash-engine/`) implementing §2–§10, a React wrapper component, the six style parameter sets, and a standalone test harness page that runs the module against the camera with debug mode — so it can be validated in isolation before re-integration into the Lovable app.
