/**
 * Notes share a width but not a height.
 *
 * A fixed footprint used to be simpler, but with the author line gone the card
 * holds nothing except the idea — so it should be exactly as big as that idea
 * needs and no bigger. A three-word thought gets a small square; a full 280
 * characters grows to stay readable. Heights are quantised into a few steps
 * rather than measured per note: it keeps the wall tidy, keeps the spatial
 * index cheap, and avoids a layout read on every mount.
 */
export const NOTE_W = 196;

/** Padding inside the card, and the line box the text is laid out in. */
const PAD_X = 14;
const PAD_Y = 13;
const LINE_HEIGHT = 1.22;

export interface NoteSize {
  h: number;
  fontSize: number;
}

/**
 * Steps run from "a couple of words" to "the 280-character maximum". Each was
 * sized from the wrapped line count at its font size plus roughly a line of
 * slack, because word wrapping never fills a line exactly.
 */
const STEPS: { maxWeight: number; size: NoteSize }[] = [
  { maxWeight: 22, size: { h: 92, fontSize: 21 } },
  { maxWeight: 48, size: { h: 112, fontSize: 18.5 } },
  { maxWeight: 90, size: { h: 140, fontSize: 16.5 } },
  { maxWeight: 150, size: { h: 170, fontSize: 15 } },
  { maxWeight: 215, size: { h: 202, fontSize: 14 } },
  { maxWeight: Infinity, size: { h: 234, fontSize: 13.5 } },
];

export const NOTE_H_MAX = STEPS[STEPS.length - 1]!.size.h;
export const NOTE_H_DEFAULT = STEPS[2]!.size.h;

export function noteSize(text: string): NoteSize {
  // A hard line break costs the rest of its line, so it weighs more than its
  // one character — otherwise "a\nb\nc" would be sized as three characters.
  let newlines = 0;
  for (const ch of text) if (ch === '\n') newlines++;
  const weight = text.length + newlines * 18;

  for (const step of STEPS) if (weight <= step.maxWeight) return step.size;
  return STEPS[STEPS.length - 1]!.size;
}

/** Notes are tilted up to ±20°, so their axis-aligned bounds exceed the card. */
export const MAX_TILT_DEG = 20;

/**
 * How far a tilted corner can stick out past the upright box. Computed from the
 * tallest card and applied to all of them: one conservative constant keeps the
 * grid and the cull padding simple, and over-padding only mounts a note a
 * fraction of a second early.
 */
export const TILT_PAD = Math.ceil(
  Math.hypot(NOTE_W, NOTE_H_MAX) / 2 - Math.min(NOTE_W, NOTE_H_MAX) / 2,
);

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function randomTilt(): number {
  // Biased away from zero: a wall of perfectly straight notes looks like a
  // spreadsheet, a wall of wildly tilted ones looks broken.
  const magnitude = 2 + Math.random() * 6;
  return Math.random() < 0.5 ? -magnitude : magnitude;
}

export { PAD_X, PAD_Y, LINE_HEIGHT };
