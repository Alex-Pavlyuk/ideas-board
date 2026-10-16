import { t } from '../i18n';
import { statusMeta } from '../statuses';
import { noteSize } from './geometry';

const MAX_LENGTH = 280;

/**
 * The inline note editor. It lives inside the world layer and wears the same
 * `.note` shape, so writing an idea happens on the board itself rather than in
 * a dialog off to one side — you see where the note will land while you type.
 */
export class Composer {
  private readonly el = document.createElement('div');
  private readonly textarea = document.createElement('textarea');
  private pendingCommit: ((text: string) => void) | null = null;
  private settled = false;

  /** @param onToggle fires whenever the editor opens or closes, so the board can react. */
  constructor(world: HTMLElement, private readonly onToggle: () => void = () => {}) {
    this.el.className = 'note note-composer';
    this.el.hidden = true;

    this.textarea.maxLength = MAX_LENGTH;
    this.textarea.rows = 4;
    this.textarea.spellcheck = false;

    const hint = document.createElement('div');
    hint.className = 'composer-hint';

    this.el.append(this.textarea, hint);
    world.appendChild(this.el);

    this.textarea.addEventListener('keydown', (e) => {
      // Enter pins the note; Shift+Enter is a line break, because some ideas
      // genuinely want two lines.
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.finish(true);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.finish(false);
      }
      e.stopPropagation();
    });
    this.textarea.addEventListener('blur', () => this.finish(true));
    // The card grows under the cursor as the idea gets longer, so what you type
    // into is the size the note will actually be.
    this.textarea.addEventListener('input', () => this.resize());
    // The board's own pan/select handlers must not fight the editor.
    this.el.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.el.addEventListener('dblclick', (e) => e.stopPropagation());
    this.el.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });

    this.hintEl = hint;
  }

  private readonly hintEl: HTMLElement;

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  open(
    worldX: number,
    worldY: number,
    angle: number,
    initial: string,
    status: number,
    commit: (text: string) => void,
  ): void {
    // Opening a second editor while one is live must not silently drop the first.
    if (!this.el.hidden) this.finish(true);

    this.pendingCommit = commit;
    this.settled = false;
    this.el.style.transform = `translate3d(${worldX}px, ${worldY}px, 0) rotate(${angle}deg)`;
    this.el.style.setProperty('--paper', statusMeta(status).paper);
    this.el.hidden = false;
    this.hintEl.textContent = t('board.saveHint');
    this.textarea.placeholder = t('board.placeholder');
    this.textarea.value = initial;
    this.resize();
    this.onToggle();

    // Focus after paint, or Safari drops the caret.
    requestAnimationFrame(() => {
      this.textarea.focus();
      this.textarea.setSelectionRange(initial.length, initial.length);
    });
  }

  /** Matches the card to its text, using the same steps a pinned note uses. */
  private resize(): void {
    const size = noteSize(this.textarea.value);
    this.el.style.height = `${size.h}px`;
    this.textarea.style.fontSize = `${size.fontSize}px`;
  }

  cancel(): void {
    this.finish(false);
  }

  /** Keeps what was typed. Clicking away on the board means "done", not "discard". */
  commit(): void {
    this.finish(true);
  }

  private finish(save: boolean): void {
    if (this.settled || this.el.hidden) return;
    this.settled = true;

    const text = this.textarea.value.trim();
    const commit = this.pendingCommit;
    this.el.hidden = true;
    this.pendingCommit = null;
    this.textarea.value = '';

    this.onToggle();

    if (save && text.length > 0) commit?.(text);
  }
}
