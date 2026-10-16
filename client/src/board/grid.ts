import { NOTE_W, TILT_PAD, noteSize, type Rect } from './geometry';
import type { Idea } from '../types';

const CELL = 512;

/**
 * Uniform-grid spatial index over the notes.
 *
 * This is what keeps the board cheap when it fills up: culling to the viewport
 * has to answer "which notes are on screen" on every pan frame, and scanning
 * the full list would make that O(all notes) forever. Buckets make it
 * proportional to what is actually visible.
 */
export class SpatialGrid {
  private readonly cells = new Map<number, Set<number>>();
  private readonly placement = new Map<number, number[]>();

  private static key(cx: number, cy: number): number {
    // Two 16-bit signed cell coordinates packed into one number: a numeric key
    // hashes faster than a `${cx},${cy}` string and allocates nothing.
    return ((cx & 0xffff) << 16) | (cy & 0xffff);
  }

  private static cellsFor(x: number, y: number, h: number): number[] {
    const x0 = Math.floor((x - TILT_PAD) / CELL);
    const y0 = Math.floor((y - TILT_PAD) / CELL);
    const x1 = Math.floor((x + NOTE_W + TILT_PAD) / CELL);
    const y1 = Math.floor((y + h + TILT_PAD) / CELL);

    const keys: number[] = [];
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) keys.push(SpatialGrid.key(cx, cy));
    }
    return keys;
  }

  insert(idea: Idea): void {
    const keys = SpatialGrid.cellsFor(idea.x, idea.y, noteSize(idea.text).h);
    this.placement.set(idea.id, keys);
    for (const key of keys) {
      let bucket = this.cells.get(key);
      if (!bucket) this.cells.set(key, (bucket = new Set()));
      bucket.add(idea.id);
    }
  }

  remove(id: number): void {
    const keys = this.placement.get(id);
    if (!keys) return;
    for (const key of keys) {
      const bucket = this.cells.get(key);
      if (!bucket) continue;
      bucket.delete(id);
      if (bucket.size === 0) this.cells.delete(key);
    }
    this.placement.delete(id);
  }

  move(idea: Idea): void {
    // Re-bucketing is only needed when the note crossed a cell boundary, which
    // during a drag is rare — but the check is cheaper than the work.
    const next = SpatialGrid.cellsFor(idea.x, idea.y, noteSize(idea.text).h);
    const prev = this.placement.get(idea.id);
    if (prev && prev.length === next.length && prev.every((k, i) => k === next[i])) return;
    this.remove(idea.id);
    this.insert(idea);
  }

  clear(): void {
    this.cells.clear();
    this.placement.clear();
  }

  /** Ids whose bounding box may intersect `rect`. May over-report; never under-reports. */
  query(rect: Rect, out: Set<number>): Set<number> {
    out.clear();
    const x0 = Math.floor(rect.x / CELL);
    const y0 = Math.floor(rect.y / CELL);
    const x1 = Math.floor((rect.x + rect.w) / CELL);
    const y1 = Math.floor((rect.y + rect.h) / CELL);

    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const bucket = this.cells.get(SpatialGrid.key(cx, cy));
        if (!bucket) continue;
        for (const id of bucket) out.add(id);
      }
    }
    return out;
  }
}

/** Bounding box of every note, used by "fit all" and the minimap. */
export function boundsOf(ideas: Iterable<Idea>): Rect {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const i of ideas) {
    if (i.x < minX) minX = i.x;
    if (i.y < minY) minY = i.y;
    if (i.x + NOTE_W > maxX) maxX = i.x + NOTE_W;
    const bottom = i.y + noteSize(i.text).h;
    if (bottom > maxY) maxY = bottom;
  }
  if (minX === Infinity) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: minX - TILT_PAD, y: minY - TILT_PAD, w: maxX - minX + TILT_PAD * 2, h: maxY - minY + TILT_PAD * 2 };
}
