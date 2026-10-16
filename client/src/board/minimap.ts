import { boundsOf } from './grid';
import { NOTE_W, noteSize } from './geometry';
import { statusMeta } from '../statuses';
import type { Renderer } from './renderer';
import type { Viewport } from './viewport';

const W = 168;
const H = 116;
const PAD = 6;

/**
 * Overview of the whole board with the current viewport drawn on it. Canvas
 * rather than DOM: at a thousand notes this is a thousand 2-3px rectangles,
 * which the 2D context fills in well under a millisecond, and it costs no
 * layout at all.
 */
export class Minimap {
  readonly canvas = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D;
  private frame = 0;
  private worldToMap = { scale: 1, dx: 0, dy: 0 };

  constructor(
    private readonly renderer: Renderer,
    private readonly viewport: Viewport,
    private readonly onNavigate: (worldX: number, worldY: number) => void,
  ) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = W * dpr;
    this.canvas.height = H * dpr;
    this.canvas.style.width = `${W}px`;
    this.canvas.style.height = `${H}px`;
    this.canvas.className = 'minimap-canvas';

    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas unavailable');
    this.ctx = ctx;
    this.ctx.scale(dpr, dpr);

    let dragging = false;
    const jump = (e: PointerEvent) => {
      const r = this.canvas.getBoundingClientRect();
      const { scale, dx, dy } = this.worldToMap;
      this.onNavigate((e.clientX - r.left - dx) / scale, (e.clientY - r.top - dy) / scale);
    };
    this.canvas.addEventListener('pointerdown', (e) => {
      dragging = true;
      this.canvas.setPointerCapture(e.pointerId);
      jump(e);
    });
    this.canvas.addEventListener('pointermove', (e) => { if (dragging) jump(e); });
    this.canvas.addEventListener('pointerup', (e) => {
      dragging = false;
      this.canvas.releasePointerCapture(e.pointerId);
    });
  }

  invalidate(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }

  private draw(): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, W, H);

    const ideas = this.renderer.ideas;
    if (ideas.size === 0) return;

    // Include the viewport in the fitted bounds, so the indicator never leaves
    // the map when the user pans away from the notes.
    const notes = boundsOf(ideas.values());
    const view = this.viewport.visibleRect();
    const minX = Math.min(notes.x, view.x);
    const minY = Math.min(notes.y, view.y);
    const maxX = Math.max(notes.x + notes.w, view.x + view.w);
    const maxY = Math.max(notes.y + notes.h, view.y + view.h);

    const scale = Math.min((W - PAD * 2) / (maxX - minX), (H - PAD * 2) / (maxY - minY));
    const dx = PAD - minX * scale + (W - PAD * 2 - (maxX - minX) * scale) / 2;
    const dy = PAD - minY * scale + (H - PAD * 2 - (maxY - minY) * scale) / 2;
    this.worldToMap = { scale, dx, dy };

    const w = Math.max(2, NOTE_W * scale);
    for (const idea of ideas.values()) {
      ctx.fillStyle = statusMeta(idea.status).accent;
      ctx.globalAlpha = idea.status === 5 ? 0.16 : 0.85;
      ctx.fillRect(idea.x * scale + dx, idea.y * scale + dy,
                   w, Math.max(2, noteSize(idea.text).h * scale));
    }

    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 1;
    ctx.strokeRect(
      view.x * scale + dx, view.y * scale + dy,
      view.w * scale, view.h * scale,
    );
  }
}
