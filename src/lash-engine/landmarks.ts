// Canonical MediaPipe FaceMesh (478-point) landmark indices used by this engine.
//
// Verified against the official topology (FACEMESH_RIGHT_EYE / FACEMESH_LEFT_EYE
// connection lists), not copied blindly from the spec. The spec's §3 index *sets*
// are correct, but its inner/outer corner labels for the right eye are swapped:
// landmark 133 is the right eye's inner (nasal) corner and 33 is its outer
// (temporal) corner — not the reverse. The left eye labels in the spec (362
// inner, 263 outer) are correct as written. Getting this right matters: flare
// and the Cat Eye length profile are parameterized inner(t=0) -> outer(t=1), so
// a swapped corner would flare toward the nose instead of the temple.

export type Pt = { x: number; y: number };

export type EyeSide = "left" | "right";

// Upper lid arc, ordered inner corner -> outer corner.
export const RIGHT_UPPER_LID: readonly number[] = [133, 173, 157, 158, 159, 160, 161, 246, 33];
export const LEFT_UPPER_LID: readonly number[] = [362, 398, 384, 385, 386, 387, 388, 466, 263];

// Lower lid arc, same corner ordering, used only for openness estimation.
export const RIGHT_LOWER_LID: readonly number[] = [133, 155, 154, 153, 145, 144, 163, 7, 33];
export const LEFT_LOWER_LID: readonly number[] = [362, 382, 381, 380, 374, 373, 390, 249, 263];

// Upper/lower lid midpoints used for the primary openness measurement (spec §3, §5).
export const RIGHT_LID_MID = { upper: 159, lower: 145 } as const;
export const LEFT_LID_MID = { upper: 386, lower: 374 } as const;

export const EYE_CORNERS = {
  right: { inner: 133, outer: 33 },
  left: { inner: 362, outer: 263 },
} as const;

export function upperLid(side: EyeSide): readonly number[] {
  return side === "left" ? LEFT_UPPER_LID : RIGHT_UPPER_LID;
}

export function lowerLid(side: EyeSide): readonly number[] {
  return side === "left" ? LEFT_LOWER_LID : RIGHT_LOWER_LID;
}

export function lidMid(side: EyeSide): { upper: number; lower: number } {
  return side === "left" ? LEFT_LID_MID : RIGHT_LID_MID;
}

// All indices this engine reads from the 478-point output, deduplicated.
// Used to size the tracked-point buffers and to know what to feed the smoother.
export const TRACKED_INDICES: readonly number[] = Array.from(
  new Set<number>([
    ...LEFT_UPPER_LID,
    ...LEFT_LOWER_LID,
    ...RIGHT_UPPER_LID,
    ...RIGHT_LOWER_LID,
    LEFT_LID_MID.upper,
    LEFT_LID_MID.lower,
    RIGHT_LID_MID.upper,
    RIGHT_LID_MID.lower,
  ]),
).sort((a, b) => a - b);

export const TRACKED_COUNT = TRACKED_INDICES.length;

// Maps a raw FaceMesh index -> its slot in the smoothed/tracked buffers.
export const INDEX_TO_SLOT: ReadonlyMap<number, number> = new Map(
  TRACKED_INDICES.map((idx, slot) => [idx, slot]),
);
