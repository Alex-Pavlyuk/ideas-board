import { api, ApiError, ORIGIN_ID } from '../api';
import { ideasWord, onLangChange, t } from '../i18n';
import { STATUS, STATUSES } from '../statuses';
import type { BoardSnapshot, Idea, StreamFrame } from '../types';
import { buildChrome, type Chrome } from './chrome';
import { Composer } from './composer';
import { MAX_TILT_DEG, NOTE_H_DEFAULT, NOTE_W, noteSize, randomTilt } from './geometry';
import { boundsOf } from './grid';
import { StatusMenu } from './menu';
import { Minimap } from './minimap';
import { Renderer } from './renderer';
import { clamp, MAX_SCALE, MIN_SCALE, Viewport } from './viewport';

const CAMERA_KEY = 'ib.camera';
const HEARTBEAT_MS = 60_000;
/** Below this pointer travel a press counts as a click, not a drag. */
const CLICK_SLOP = 4;

type Gesture =
  | { mode: 'none' }
  // `inertNote` is a buried note pressed under this pan: it cannot be dragged,
  // so the board pans through it, but a press that goes nowhere is still a
  // click on that note.
  | { mode: 'pan'; lastX: number; lastY: number; moved: number; inertNote: number | null }
  | { mode: 'drag'; id: number; grabX: number; grabY: number; startX: number; startY: number; moved: number }
  | { mode: 'rotate'; id: number; startAngle: number; grabAngle: number }
  | { mode: 'pinch'; lastDistance: number; lastCentreX: number; lastCentreY: number };

export class BoardApp {
  private readonly chrome: Chrome;
  private readonly viewport: Viewport;
  private readonly renderer: Renderer;
  private readonly minimap: Minimap;
  private readonly menu: StatusMenu;
  private readonly composer: Composer;

  private readonly me: BoardSnapshot['me'];
  private readonly activeStatuses = new Set<number>(STATUSES.map((s) => s.id));
  private query = '';
  private selectedId: number | null = null;

  private gesture: Gesture = { mode: 'none' };
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private stream: EventSource | null = null;
  private saveCameraTimer = 0;

  constructor(mount: HTMLElement, snapshot: BoardSnapshot) {
    this.me = snapshot.me;
    this.chrome = buildChrome(snapshot.me);
    mount.replaceChildren(this.chrome.root);

    this.viewport = new Viewport(() => ({
      w: this.chrome.canvas.clientWidth,
      h: this.chrome.canvas.clientHeight,
    }));
    this.renderer = new Renderer(this.chrome.world, this.viewport);
    this.renderer.matches = (idea) => this.matches(idea);
    this.menu = new StatusMenu(() => this.select(null));
    this.composer = new Composer(this.chrome.world, () => this.updateCounter());
    this.minimap = new Minimap(this.renderer, this.viewport, (x, y) => {
      this.viewport.centreOn(x, y);
      this.redraw();
    });
    this.chrome.hud.insertBefore(this.minimap.canvas, this.chrome.hud.firstChild);

    this.renderer.load(snapshot.ideas);
    this.restoreCamera(snapshot.ideas);
    this.redraw();
    this.updateCounter();

    this.wireChrome();
    this.wireCanvas();
    this.wireKeyboard();
    this.connectStream();
    this.startHeartbeat();

    onLangChange(() => {
      this.updateCounter();
      this.renderer.markAllDirty();
    });
    window.addEventListener('resize', () => this.redraw());
  }

  // ---------------------------------------------------------------- chrome

  private wireChrome(): void {
    this.chrome.newButton.addEventListener('click', () => this.startNewIdea());

    this.chrome.search.addEventListener('input', () => {
      this.query = this.chrome.search.value.trim().toLowerCase();
      this.applyFilter();
    });

    this.chrome.allChip.addEventListener('click', () => {
      const allOn = this.activeStatuses.size === STATUSES.length;
      this.activeStatuses.clear();
      if (!allOn) for (const s of STATUSES) this.activeStatuses.add(s.id);
      this.syncChips();
      this.applyFilter();
    });

    for (const [status, chip] of this.chrome.filterChips) {
      chip.addEventListener('click', (e) => {
        // A plain click toggles; alt-click isolates a single status, which is
        // the thing you actually want when the board is busy.
        if (e.altKey) {
          this.activeStatuses.clear();
          this.activeStatuses.add(status);
        } else if (this.activeStatuses.has(status)) {
          this.activeStatuses.delete(status);
        } else {
          this.activeStatuses.add(status);
        }
        this.syncChips();
        this.applyFilter();
      });
    }

    this.chrome.zoomIn.addEventListener('click', () => { this.viewport.zoomToCentre(1.25); this.redraw(); });
    this.chrome.zoomOut.addEventListener('click', () => { this.viewport.zoomToCentre(0.8); this.redraw(); });
    this.chrome.fit.addEventListener('click', () => this.fitAll());

    this.chrome.root.querySelector('#logout')?.addEventListener('click', async () => {
      try { await api.logout(); } catch { /* leaving anyway */ }
      location.reload();
    });
  }

  private syncChips(): void {
    for (const [status, chip] of this.chrome.filterChips) {
      chip.classList.toggle('is-on', this.activeStatuses.has(status));
    }
    this.chrome.allChip.classList.toggle('is-on', this.activeStatuses.size === STATUSES.length);
  }

  private applyFilter(): void {
    this.renderer.markAllDirty();
    this.updateCounter();
  }

  private matches(idea: Idea): boolean {
    if (!this.activeStatuses.has(idea.status)) return false;
    if (this.query === '') return true;
    return idea.text.toLowerCase().includes(this.query)
        || idea.author.toLowerCase().includes(this.query);
  }

  private updateCounter(): void {
    const total = this.renderer.ideas.size;
    let shown = 0;
    for (const idea of this.renderer.ideas.values()) if (this.matches(idea)) shown++;

    this.chrome.counter.textContent = shown === total
      ? `${total} ${ideasWord(total)}`
      : `${shown} / ${total} ${ideasWord(total)}`;

    // The empty state sits above the canvas, so it must get out of the way of
    // the very note the user is typing into.
    this.chrome.emptyState.hidden = total !== 0 || this.composer.isOpen;
    this.chrome.counter.classList.toggle('is-empty', total > 0 && shown === 0);
  }

  // ---------------------------------------------------------------- canvas

  private wireCanvas(): void {
    const canvas = this.chrome.canvas;

    canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    canvas.addEventListener('pointermove', (e) => this.onPointerMove(e));
    canvas.addEventListener('pointerup', (e) => this.onPointerUp(e));
    canvas.addEventListener('pointercancel', (e) => this.onPointerUp(e));
    canvas.addEventListener('dblclick', (e) => this.onDoubleClick(e));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    // passive:false because both branches preventDefault — otherwise Ctrl+wheel
    // zooms the whole page and two-finger scroll navigates back.
    canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
  }

  private noteAt(target: EventTarget | null): Idea | null {
    const el = (target as HTMLElement | null)?.closest?.('.note:not(.note-composer)') as HTMLElement | null;
    if (!el?.dataset.id) return null;
    return this.renderer.ideas.get(Number(el.dataset.id)) ?? null;
  }

  /** Pointer position in the note's own unrotated coordinate space. */
  private localPoint(idea: Idea, clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.chrome.canvas.getBoundingClientRect();
    const world = this.viewport.toWorld(clientX - rect.left, clientY - rect.top);
    const h = noteSize(idea.text).h;
    const cx = idea.x + NOTE_W / 2;
    const cy = idea.y + h / 2;
    const a = (-idea.angle * Math.PI) / 180;
    const dx = world.x - cx;
    const dy = world.y - cy;
    return {
      x: dx * Math.cos(a) - dy * Math.sin(a) + NOTE_W / 2,
      y: dx * Math.sin(a) + dy * Math.cos(a) + h / 2,
    };
  }

  private worldPoint(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.chrome.canvas.getBoundingClientRect();
    return this.viewport.toWorld(clientX - rect.left, clientY - rect.top);
  }

  private onPointerDown(e: PointerEvent): void {
    if (this.composer.isOpen) { this.composer.commit(); return; }
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      if (a && b) {
        this.gesture = {
          mode: 'pinch',
          lastDistance: Math.hypot(a.x - b.x, a.y - b.y),
          lastCentreX: (a.x + b.x) / 2,
          lastCentreY: (a.y + b.y) / 2,
        };
      }
      return;
    }
    if (this.pointers.size > 2) return;

    this.chrome.helpPanel.hidden = true;
    this.chrome.canvas.setPointerCapture(e.pointerId);

    const idea = e.button === 0 ? this.noteAt(e.target) : null;
    // A buried idea is laid to rest where it is: no dragging, no tilting. The
    // click still has to work, or nothing could ever be brought back.
    if (idea && idea.status !== STATUS.Buried) {
      const local = this.localPoint(idea, e.clientX, e.clientY);
      const onHandle = local.x > NOTE_W - 34 && local.y > noteSize(idea.text).h - 34;
      this.renderer.raise(idea.id);
      this.renderer.elementFor(idea.id)?.classList.add('is-dragging');

      if (onHandle) {
        const centre = this.centreScreen(idea);
        this.gesture = {
          mode: 'rotate',
          id: idea.id,
          startAngle: idea.angle,
          grabAngle: Math.atan2(e.clientY - centre.y, e.clientX - centre.x) * 180 / Math.PI,
        };
      } else {
        const world = this.worldPoint(e.clientX, e.clientY);
        this.gesture = {
          mode: 'drag', id: idea.id,
          grabX: world.x, grabY: world.y,
          startX: idea.x, startY: idea.y,
          moved: 0,
        };
      }
      return;
    }

    this.gesture = {
      mode: 'pan', lastX: e.clientX, lastY: e.clientY, moved: 0,
      inertNote: idea?.id ?? null,
    };
    this.chrome.canvas.classList.add('is-panning');
  }

  private centreScreen(idea: Idea): { x: number; y: number } {
    const rect = this.chrome.canvas.getBoundingClientRect();
    const p = this.viewport.toScreen(idea.x + NOTE_W / 2, idea.y + noteSize(idea.text).h / 2);
    return { x: p.x + rect.left, y: p.y + rect.top };
  }

  private onPointerMove(e: PointerEvent): void {
    const tracked = this.pointers.get(e.pointerId);
    if (tracked) { tracked.x = e.clientX; tracked.y = e.clientY; }

    const g = this.gesture;
    switch (g.mode) {
      case 'pan': {
        g.moved += Math.abs(e.clientX - g.lastX) + Math.abs(e.clientY - g.lastY);
        this.viewport.panBy(e.clientX - g.lastX, e.clientY - g.lastY);
        g.lastX = e.clientX;
        g.lastY = e.clientY;
        this.redraw();
        break;
      }
      case 'drag': {
        const world = this.worldPoint(e.clientX, e.clientY);
        const idea = this.renderer.ideas.get(g.id);
        if (!idea) return;
        const x = g.startX + (world.x - g.grabX);
        const y = g.startY + (world.y - g.grabY);
        g.moved += Math.abs(world.x - g.grabX) + Math.abs(world.y - g.grabY);
        // Straight to the element: the model and the index catch up on drop.
        this.renderer.previewTransform(g.id, x, y, idea.angle);
        break;
      }
      case 'rotate': {
        const idea = this.renderer.ideas.get(g.id);
        if (!idea) return;
        const centre = this.centreScreen(idea);
        const now = Math.atan2(e.clientY - centre.y, e.clientX - centre.x) * 180 / Math.PI;
        const angle = clamp(g.startAngle + (now - g.grabAngle), -MAX_TILT_DEG, MAX_TILT_DEG);
        this.renderer.previewTransform(g.id, idea.x, idea.y, angle);
        break;
      }
      case 'pinch': {
        if (this.pointers.size < 2) return;
        const [a, b] = [...this.pointers.values()];
        if (!a || !b) return;
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        const cx = (a.x + b.x) / 2;
        const cy = (a.y + b.y) / 2;
        const rect = this.chrome.canvas.getBoundingClientRect();
        this.viewport.panBy(cx - g.lastCentreX, cy - g.lastCentreY);
        if (g.lastDistance > 0) {
          this.viewport.zoomAt(cx - rect.left, cy - rect.top, distance / g.lastDistance);
        }
        g.lastDistance = distance;
        g.lastCentreX = cx;
        g.lastCentreY = cy;
        this.redraw();
        break;
      }
      default:
        break;
    }
  }

  private onPointerUp(e: PointerEvent): void {
    this.pointers.delete(e.pointerId);
    const g = this.gesture;
    this.gesture = { mode: 'none' };
    this.chrome.canvas.classList.remove('is-panning');
    if (this.chrome.canvas.hasPointerCapture(e.pointerId)) {
      this.chrome.canvas.releasePointerCapture(e.pointerId);
    }

    if (g.mode === 'pan') {
      if (g.moved < CLICK_SLOP) {
        const inert = g.inertNote === null ? undefined : this.renderer.ideas.get(g.inertNote);
        if (inert) this.openMenu(inert, e.clientX, e.clientY);
        else { this.menu.close(); this.select(null); }
      }
      this.saveCamera();
      return;
    }

    if (g.mode === 'drag') {
      const idea = this.renderer.ideas.get(g.id);
      this.renderer.elementFor(g.id)?.classList.remove('is-dragging');
      if (!idea) return;

      if (g.moved < CLICK_SLOP / this.viewport.scale) {
        // A press that went nowhere is a click: show what can be done to it.
        this.renderer.previewTransform(idea.id, idea.x, idea.y, idea.angle);
        this.openMenu(idea, e.clientX, e.clientY);
        return;
      }

      const world = this.worldPoint(e.clientX, e.clientY);
      const moved: Idea = { ...idea, x: g.startX + (world.x - g.grabX), y: g.startY + (world.y - g.grabY) };
      this.renderer.upsert(moved);
      this.minimap.invalidate();
      void this.persistPosition(moved);
      return;
    }

    if (g.mode === 'rotate') {
      const idea = this.renderer.ideas.get(g.id);
      this.renderer.elementFor(g.id)?.classList.remove('is-dragging');
      if (!idea) return;
      const centre = this.centreScreen(idea);
      const now = Math.atan2(e.clientY - centre.y, e.clientX - centre.x) * 180 / Math.PI;
      const angle = clamp(g.startAngle + (now - g.grabAngle), -MAX_TILT_DEG, MAX_TILT_DEG);
      const turned: Idea = { ...idea, angle };
      this.renderer.upsert(turned);
      void this.persistPosition(turned);
    }
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const rect = this.chrome.canvas.getBoundingClientRect();

    if (e.ctrlKey || e.metaKey) {
      // Trackpad pinch arrives as ctrl+wheel; the exponent keeps zoom steps
      // even across the mouse-wheel/trackpad delta difference.
      this.viewport.zoomAt(e.clientX - rect.left, e.clientY - rect.top, Math.exp(-e.deltaY * 0.01));
    } else {
      this.viewport.panBy(-e.deltaX, -e.deltaY);
    }
    this.redraw();
    this.saveCamera();
  }

  private onDoubleClick(e: MouseEvent): void {
    const idea = this.noteAt(e.target);
    if (idea) {
      if (idea.authorId === this.me.id || this.me.isAdmin) this.startEdit(idea);
      return;
    }
    const world = this.worldPoint(e.clientX, e.clientY);
    this.startNewIdea(world.x - NOTE_W / 2, world.y - NOTE_H_DEFAULT / 2);
  }

  private wireKeyboard(): void {
    document.addEventListener('keydown', (e) => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;

      if (e.key === 'Escape') {
        if (this.composer.isOpen) this.composer.cancel();
        else if (this.menu.isOpen) this.menu.close();
        else if (!this.chrome.helpPanel.hidden) this.chrome.helpPanel.hidden = true;
        else if (typing) (e.target as HTMLElement).blur();
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === 'n' || e.key === 'N') { e.preventDefault(); this.startNewIdea(); }
      else if (e.key === 'f' || e.key === 'F') { e.preventDefault(); this.fitAll(); }
      else if (e.key === '/') { e.preventDefault(); this.chrome.search.focus(); }
      else if (e.key === '?') { this.chrome.helpPanel.hidden = !this.chrome.helpPanel.hidden; }
    });
  }

  // ----------------------------------------------------------------- notes

  private startNewIdea(worldX?: number, worldY?: number): void {
    this.menu.close();
    let x = worldX;
    let y = worldY;
    if (x === undefined || y === undefined) {
      const view = this.viewport.visibleRect();
      x = view.x + view.w / 2 - NOTE_W / 2;
      y = view.y + view.h / 2 - NOTE_H_DEFAULT / 2;
    }
    const spot = this.freeSpotNear(x, y);
    const angle = randomTilt();

    this.composer.open(spot.x, spot.y, angle, '', 0, (text) => {
      void this.createIdea(text, spot.x, spot.y, angle);
    });
  }

  private startEdit(idea: Idea): void {
    this.menu.close();
    // The editor sits exactly on top of the note, so hide the note itself. This
    // is a class rather than an inline style: the renderer pools note elements,
    // and its recycle step already clears classes.
    this.renderer.editingId = idea.id;
    this.renderer.markDirty(idea.id);

    const done = () => {
      this.renderer.editingId = null;
      this.renderer.markDirty(idea.id);
    };
    // Runs on save and on cancel alike.
    this.composer.open(idea.x, idea.y, idea.angle, idea.text, idea.status, (text) => {
      if (text !== idea.text) void this.saveText(idea, text);
    });
    const watch = () => {
      if (this.composer.isOpen) requestAnimationFrame(watch);
      else done();
    };
    requestAnimationFrame(watch);
  }

  /**
   * Nudges a new note off any existing one. A short outward spiral is enough:
   * with the board this sparse it almost always succeeds on the first try, and
   * it never blocks note creation if it does not.
   */
  private freeSpotNear(x: number, y: number): { x: number; y: number } {
    const step = 46;
    for (let ring = 0; ring < 14; ring++) {
      for (let k = 0; k < Math.max(1, ring * 6); k++) {
        const angle = (k / Math.max(1, ring * 6)) * Math.PI * 2;
        const cx = x + Math.cos(angle) * ring * step;
        const cy = y + Math.sin(angle) * ring * step * 0.7;
        if (!this.occupied(cx, cy)) return { x: cx, y: cy };
      }
    }
    return { x, y };
  }

  private occupied(x: number, y: number): boolean {
    const probe = new Set<number>();
    this.renderer.grid.query({ x, y, w: NOTE_W, h: NOTE_H_DEFAULT }, probe);
    for (const id of probe) {
      const other = this.renderer.ideas.get(id);
      if (!other) continue;
      // Overlapping by a corner is fine and looks natural; a near-exact stack is
      // not. The threshold follows the shorter of the two cards.
      const near = Math.min(NOTE_H_DEFAULT, noteSize(other.text).h) * 0.62;
      if (Math.abs(other.x - x) < NOTE_W * 0.62 && Math.abs(other.y - y) < near) return true;
    }
    return false;
  }

  private openMenu(idea: Idea, clientX: number, clientY: number): void {
    this.select(idea.id);
    this.menu.open(idea, clientX, clientY, {
      canEdit: idea.authorId === this.me.id || this.me.isAdmin,
      // Everyone can bury; only the admin can erase. That asymmetry is the
      // whole point of "buried" being a status rather than a deletion.
      canDelete: this.me.isAdmin,
      onStatus: (status) => { void this.changeStatus(idea, status); },
      onEdit: () => { const current = this.renderer.ideas.get(idea.id); if (current) this.startEdit(current); },
      onDelete: () => { void this.deleteIdea(idea); },
    });
  }

  private select(id: number | null): void {
    if (this.selectedId === id) return;
    const previous = this.selectedId;
    this.selectedId = id;
    this.renderer.selectedId = id;
    if (previous !== null) this.renderer.markDirty(previous);
    if (id !== null) this.renderer.markDirty(id);
  }

  // ------------------------------------------------------------------- api

  private async createIdea(text: string, x: number, y: number, angle: number): Promise<void> {
    try {
      const idea = await api.createIdea(text, x, y, angle);
      this.renderer.upsert(idea);
      this.minimap.invalidate();
      this.updateCounter();
    } catch (e) {
      this.reportError(e);
    }
  }

  private async changeStatus(idea: Idea, status: number): Promise<void> {
    if (idea.status === status) { this.menu.close(); return; }
    // Optimistic: the colour flips under the cursor, the server confirms after.
    const optimistic: Idea = { ...idea, status };
    this.renderer.upsert(optimistic);
    this.minimap.invalidate();
    this.updateCounter();
    this.menu.update(optimistic);

    try {
      const saved = await api.setStatus(idea.id, status);
      this.renderer.upsert(saved);
      this.menu.update(saved);
    } catch (e) {
      this.renderer.upsert(idea);
      this.menu.update(idea);
      this.updateCounter();
      this.reportError(e);
    }
  }

  private async persistPosition(idea: Idea): Promise<void> {
    try {
      await api.setPosition(idea.id, idea.x, idea.y, idea.angle);
    } catch (e) {
      this.reportError(e);
    }
  }

  private async saveText(idea: Idea, text: string): Promise<void> {
    try {
      const saved = await api.setText(idea.id, text);
      this.renderer.upsert(saved);
    } catch (e) {
      this.reportError(e);
    }
  }

  private async deleteIdea(idea: Idea): Promise<void> {
    if (!confirm(t('menu.deleteConfirm'))) return;
    this.menu.close();
    try {
      await api.deleteIdea(idea.id);
      this.renderer.remove(idea.id);
      this.minimap.invalidate();
      this.updateCounter();
    } catch (e) {
      this.reportError(e);
    }
  }

  private reportError(e: unknown): void {
    if (e instanceof ApiError && e.status === 401) { location.reload(); return; }
    if (e instanceof ApiError && e.code === 'forbidden') { this.chrome.toast(t('common.forbidden')); return; }
    this.chrome.toast(t('common.error'));
  }

  // ---------------------------------------------------------------- stream

  private connectStream(): void {
    this.stream?.close();
    const source = new EventSource('/api/board/stream');
    this.stream = source;

    let connectedBefore = false;
    source.addEventListener('open', () => {
      this.chrome.offline.hidden = true;
      // Only a RE-connection needs a resync: frames may have been missed while
      // the stream was down. The first connect follows the initial load.
      if (connectedBefore) void this.resync();
      connectedBefore = true;
    });

    source.addEventListener('message', (e) => {
      let frame: StreamFrame;
      try { frame = JSON.parse((e as MessageEvent<string>).data) as StreamFrame; }
      catch { return; }
      // Our own change is already applied locally, and re-applying it would
      // undo an in-flight drag.
      if (frame.origin === ORIGIN_ID) return;
      this.applyFrame(frame);
    });

    source.addEventListener('error', () => {
      this.chrome.offline.hidden = false;
      // EventSource retries on its own; nothing to do but say so.
    });
  }

  private applyFrame(frame: StreamFrame): void {
    switch (frame.type) {
      case 'idea.created':
      case 'idea.updated': {
        this.renderer.upsert(frame.data);
        this.menu.update(frame.data);
        break;
      }
      case 'idea.moved': {
        const existing = this.renderer.ideas.get(frame.data.id);
        if (!existing) break;
        // Never yank a note out from under someone who is holding it.
        if ((this.gesture.mode === 'drag' || this.gesture.mode === 'rotate')
            && this.gesture.id === frame.data.id) break;
        this.renderer.upsert({ ...existing, ...frame.data });
        break;
      }
      case 'idea.deleted': {
        if (this.menu.ideaId === frame.data.id) this.menu.close();
        this.renderer.remove(frame.data.id);
        break;
      }
    }
    this.minimap.invalidate();
    this.updateCounter();
  }

  private async resync(): Promise<void> {
    try {
      const snapshot = await api.board();
      this.renderer.load(snapshot.ideas);
      this.minimap.invalidate();
      this.updateCounter();
    } catch { /* the stream will fire error and retry */ }
  }

  private startHeartbeat(): void {
    const beat = () => {
      // Only while the tab is actually in front — a forgotten background tab
      // must not inflate "time spent on the board".
      if (document.visibilityState === 'visible') void api.beat().catch(() => {});
    };
    window.setInterval(beat, HEARTBEAT_MS);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') beat();
    });
  }

  // ---------------------------------------------------------------- camera

  private redraw(): void {
    this.renderer.invalidate();
    this.minimap.invalidate();
    if (this.menu.isOpen) this.menu.close();
  }

  private fitAll(): void {
    this.viewport.fit(boundsOf(this.renderer.ideas.values()));
    this.redraw();
    this.saveCamera();
  }

  private saveCamera(): void {
    clearTimeout(this.saveCameraTimer);
    this.saveCameraTimer = window.setTimeout(() => {
      try {
        const { tx, ty, scale } = this.viewport;
        localStorage.setItem(CAMERA_KEY, JSON.stringify({ tx, ty, scale }));
      } catch { /* private mode */ }
    }, 400);
  }

  private restoreCamera(ideas: Idea[]): void {
    try {
      const raw = localStorage.getItem(CAMERA_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as { tx: number; ty: number; scale: number };
        if ([saved.tx, saved.ty, saved.scale].every(Number.isFinite)) {
          this.viewport.tx = saved.tx;
          this.viewport.ty = saved.ty;
          this.viewport.scale = clamp(saved.scale, MIN_SCALE, MAX_SCALE);
          return;
        }
      }
    } catch { /* fall through to fit */ }

    if (ideas.length === 0) {
      this.viewport.centreOn(0, 0);
      return;
    }
    this.fitWhenSized(ideas);
  }

  /**
   * The opening "fit everything" needs the canvas to have been laid out. During
   * construction it may not have been, so fall back to a ResizeObserver and fit
   * the moment the element gets a size.
   */
  private fitWhenSized(ideas: Idea[]): void {
    if (this.viewport.fit(boundsOf(ideas))) return;

    const canvas = this.chrome.canvas;
    const observer = new ResizeObserver(() => {
      if (!this.viewport.fit(boundsOf(this.renderer.ideas.values()))) return;
      observer.disconnect();
      this.redraw();
    });
    observer.observe(canvas);
  }
}
