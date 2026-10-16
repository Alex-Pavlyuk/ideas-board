import type { Rect } from './geometry';

export const MIN_SCALE = 0.08;
export const MAX_SCALE = 2.4;

/**
 * The camera. World → screen is `screen = world * scale + t`, applied once as a
 * single CSS transform on the world layer, so panning and zooming cost one
 * style write regardless of how many notes are mounted.
 */
export class Viewport {
  tx = 0;
  ty = 0;
  scale = 1;

  constructor(private readonly size: () => { w: number; h: number }) {}

  toWorld(screenX: number, screenY: number): { x: number; y: number } {
    return { x: (screenX - this.tx) / this.scale, y: (screenY - this.ty) / this.scale };
  }

  toScreen(worldX: number, worldY: number): { x: number; y: number } {
    return { x: worldX * this.scale + this.tx, y: worldY * this.scale + this.ty };
  }

  panBy(dx: number, dy: number): void {
    this.tx += dx;
    this.ty += dy;
  }

  /** Zooms so the world point under (screenX, screenY) stays put. */
  zoomAt(screenX: number, screenY: number, factor: number): void {
    const next = clamp(this.scale * factor, MIN_SCALE, MAX_SCALE);
    if (next === this.scale) return;
    const world = this.toWorld(screenX, screenY);
    this.scale = next;
    this.tx = screenX - world.x * next;
    this.ty = screenY - world.y * next;
  }

  zoomToCentre(factor: number): void {
    const { w, h } = this.size();
    this.zoomAt(w / 2, h / 2, factor);
  }

  /** The slice of the world currently on screen, padded by `pad` world units. */
  visibleRect(pad = 0): Rect {
    const { w, h } = this.size();
    const topLeft = this.toWorld(0, 0);
    return {
      x: topLeft.x - pad,
      y: topLeft.y - pad,
      w: w / this.scale + pad * 2,
      h: h / this.scale + pad * 2,
    };
  }

  centreOn(worldX: number, worldY: number): void {
    const { w, h } = this.size();
    this.tx = w / 2 - worldX * this.scale;
    this.ty = h / 2 - worldY * this.scale;
  }

  /** Frames `bounds`, leaving `margin` screen px around it. */
  fit(bounds: Rect, margin = 90): boolean {
    const { w, h } = this.size();
    // Called before layout (or while the tab is hidden) the canvas reports no
    // size, and fitting to that pins the zoom at its minimum. Say so instead.
    if (w < 2 || h < 2) return false;
    if (bounds.w <= 0 || bounds.h <= 0) {
      this.scale = 1;
      this.centreOn(bounds.x, bounds.y);
      return true;
    }
    const scale = clamp(
      Math.min((w - margin * 2) / bounds.w, (h - margin * 2) / bounds.h),
      MIN_SCALE,
      // Zooming past 1:1 to fill the screen with three notes looks like a bug.
      1,
    );
    this.scale = scale;
    this.centreOn(bounds.x + bounds.w / 2, bounds.y + bounds.h / 2);
    return true;
  }
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
