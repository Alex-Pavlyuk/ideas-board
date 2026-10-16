import { NOTE_W, TILT_PAD, noteSize } from './geometry';
import { SpatialGrid } from './grid';
import { STATUS, statusMeta } from '../statuses';
import type { Idea } from '../types';
import type { Viewport } from './viewport';

/** Below this zoom the text is unreadable anyway, so notes render as plain colour blocks. */
const FAR_SCALE = 0.34;
/** And below this, even the tilt and shadow stop being worth their paint cost. */
const TINY_SCALE = 0.17;

/**
 * Mounts only what is on screen.
 *
 * The board is designed to hold thousands of notes, and the thing that would
 * kill it is not data volume but DOM volume: every mounted note is layout,
 * paint and compositing work on each frame. So the renderer keeps a spatial
 * index of all notes, mounts the visible slice, and recycles the elements of
 * notes that scroll out of view through a pool. Pan and zoom themselves touch
 * exactly one element — the world layer's transform.
 */
export class Renderer {
  readonly ideas = new Map<number, Idea>();
  readonly grid = new SpatialGrid();

  private readonly mounted = new Map<number, HTMLElement>();
  private readonly pool: HTMLElement[] = [];
  private readonly dirty = new Set<number>();
  private readonly candidates = new Set<number>();
  private readonly keep = new Set<number>();

  private frame = 0;
  private fullRedraw = true;
  private stackTop = 1;
  private readonly stack = new Map<number, number>();

  /** Set by the controller; notes that fail it are dimmed rather than removed. */
  matches: (idea: Idea) => boolean = () => true;
  /** Kept here so a selected note re-mounts with its outline after scrolling back in. */
  selectedId: number | null = null;
  /** The note currently under the inline editor, hidden so the two do not overlap. */
  editingId: number | null = null;
  onCullChange: ((visibleCount: number) => void) | null = null;

  constructor(
    private readonly world: HTMLElement,
    private readonly viewport: Viewport,
  ) {}

  // --- data ---------------------------------------------------------------

  load(ideas: Idea[]): void {
    this.ideas.clear();
    this.grid.clear();
    this.stack.clear();
    this.stackTop = 1;
    for (const idea of ideas) {
      this.ideas.set(idea.id, idea);
      this.grid.insert(idea);
      this.stack.set(idea.id, this.stackTop++);
    }
    this.unmountAll();
    this.invalidate(true);
  }

  upsert(idea: Idea): void {
    const existing = this.ideas.get(idea.id);
    this.ideas.set(idea.id, idea);
    if (existing) this.grid.move(idea);
    else {
      this.grid.insert(idea);
      this.stack.set(idea.id, this.stackTop++);
    }
    this.dirty.add(idea.id);
    this.invalidate();
  }

  remove(id: number): void {
    this.ideas.delete(id);
    this.grid.remove(id);
    this.stack.delete(id);
    const el = this.mounted.get(id);
    if (el) {
      this.mounted.delete(id);
      this.recycle(el);
    }
    this.invalidate();
  }

  /** Brings a note to the top of the pile — used when it is picked up. */
  raise(id: number): void {
    // A buried note has no top to be brought to; it stays on the bottom.
    if (this.ideas.get(id)?.status === STATUS.Buried) return;
    this.stack.set(id, this.stackTop++);
    const el = this.mounted.get(id);
    if (el) el.style.zIndex = String(this.stack.get(id));
  }

  elementFor(id: number): HTMLElement | undefined {
    return this.mounted.get(id);
  }

  /**
   * Writes a note's transform straight to its element without going through the
   * data model — the hot path while a note is being dragged.
   */
  previewTransform(id: number, x: number, y: number, angle: number): void {
    const el = this.mounted.get(id);
    if (el) el.style.transform = transformFor(x, y, angle);
  }

  markDirty(id: number): void {
    this.dirty.add(id);
    this.invalidate();
  }

  markAllDirty(): void {
    this.invalidate(true);
  }

  // --- rendering ----------------------------------------------------------

  invalidate(full = false): void {
    if (full) this.fullRedraw = true;
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }

  private draw(): void {
    const { tx, ty, scale } = this.viewport;
    this.world.style.transform = `translate3d(${tx}px, ${ty}px, 0) scale(${scale})`;

    const detail = scale < TINY_SCALE ? 'tiny' : scale < FAR_SCALE ? 'far' : 'near';
    if (this.world.dataset.detail !== detail) this.world.dataset.detail = detail;

    // Grid cells are coarse, so they over-report; a padded rect test on each
    // candidate narrows that to the notes genuinely near the viewport. The pad
    // mounts a note just before its corner would appear.
    const rect = this.viewport.visibleRect(TILT_PAD + 48);
    const right = rect.x + rect.w;
    const bottom = rect.y + rect.h;

    this.grid.query(rect, this.candidates);
    const wanted = this.keep;
    wanted.clear();
    for (const id of this.candidates) {
      const idea = this.ideas.get(id);
      if (!idea) continue;
      if (idea.x - TILT_PAD > right || idea.x + NOTE_W + TILT_PAD < rect.x) continue;
      if (idea.y - TILT_PAD > bottom || idea.y + noteSize(idea.text).h + TILT_PAD < rect.y) continue;
      wanted.add(id);
    }

    for (const [id, el] of this.mounted) {
      if (!wanted.has(id)) {
        this.mounted.delete(id);
        this.recycle(el);
      }
    }

    for (const id of wanted) {
      const idea = this.ideas.get(id);
      if (!idea) continue;
      let el = this.mounted.get(id);
      if (!el) {
        el = this.take();
        this.mounted.set(id, el);
        this.paint(el, idea);
        this.world.appendChild(el);
      } else if (this.fullRedraw || this.dirty.has(id)) {
        this.paint(el, idea);
      }
    }

    this.dirty.clear();
    this.fullRedraw = false;
    this.onCullChange?.(this.mounted.size);
  }

  private paint(el: HTMLElement, idea: Idea): void {
    const meta = statusMeta(idea.status);
    el.dataset.id = String(idea.id);
    el.dataset.status = String(idea.status);
    el.style.transform = transformFor(idea.x, idea.y, idea.angle);
    el.style.setProperty('--paper', meta.paper);
    // Buried notes sit under every live one — they are out of play and must
    // never cover an idea that still is.
    el.style.zIndex = idea.status === STATUS.Buried ? '0' : String(this.stack.get(idea.id) ?? 1);
    el.classList.toggle('is-dim', !this.matches(idea));
    el.classList.toggle('is-selected', this.selectedId === idea.id);
    el.classList.toggle('is-editing', this.editingId === idea.id);

    // The card is sized to its own text, so height and type size travel with it.
    const size = noteSize(idea.text);
    const height = `${size.h}px`;
    if (el.style.height !== height) el.style.height = height;

    const body = el.firstElementChild as HTMLElement;
    if (body.textContent !== idea.text) {
      body.textContent = idea.text;
      body.style.fontSize = `${size.fontSize}px`;
    }
  }

  private take(): HTMLElement {
    const pooled = this.pool.pop();
    if (pooled) return pooled;

    // One child, and only one: the note holds the idea and nothing else, so
    // every pixel of the card is text. Who wrote it lives in the menu.
    const el = document.createElement('article');
    el.className = 'note';
    const body = document.createElement('div');
    body.className = 'note-text';
    el.appendChild(body);
    return el;
  }

  private recycle(el: HTMLElement): void {
    el.remove();
    // Every state class must be cleared, or the next note to reuse this element
    // inherits it — an invisible or permanently outlined note out of nowhere.
    el.classList.remove('is-selected', 'is-dragging', 'is-dim', 'is-editing');
    // A modest cap: past this the notes are cheaper to recreate than to hold.
    if (this.pool.length < 240) this.pool.push(el);
  }

  private unmountAll(): void {
    for (const el of this.mounted.values()) this.recycle(el);
    this.mounted.clear();
  }
}

function transformFor(x: number, y: number, angle: number): string {
  return `translate3d(${x}px, ${y}px, 0) rotate(${angle}deg)`;
}
