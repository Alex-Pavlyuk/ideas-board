import { STATUSES, statusIcon } from '../statuses';
import { formatDateTime, onLangChange, t } from '../i18n';
import type { Idea } from '../types';

export interface MenuActions {
  onStatus: (status: number) => void;
  onEdit: () => void;
  onDelete: () => void;
  canEdit: boolean;
  canDelete: boolean;
}

/**
 * The one thing you can do to a note is decide what it is now, so the menu is
 * six colour swatches and nothing else above the fold. Positioned in screen
 * space and flipped to stay on screen.
 */
export class StatusMenu {
  readonly el = document.createElement('div');
  private idea: Idea | null = null;
  private actions: MenuActions | null = null;

  constructor(private readonly onClose: () => void) {
    this.el.className = 'menu';
    this.el.hidden = true;
    this.el.addEventListener('pointerdown', (e) => e.stopPropagation());
    onLangChange(() => { if (this.idea && this.actions) this.render(); });
    document.body.appendChild(this.el);
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  get ideaId(): number | null {
    return this.idea?.id ?? null;
  }

  open(idea: Idea, screenX: number, screenY: number, actions: MenuActions): void {
    this.idea = idea;
    this.actions = actions;
    this.render();
    this.el.hidden = false;
    this.position(screenX, screenY);
  }

  /** Re-renders in place when the note changes under an open menu. */
  update(idea: Idea): void {
    if (this.idea?.id !== idea.id) return;
    this.idea = idea;
    this.render();
  }

  close(): void {
    if (this.el.hidden) return;
    this.el.hidden = true;
    this.idea = null;
    this.actions = null;
    this.onClose();
  }

  private position(x: number, y: number): void {
    const { width, height } = this.el.getBoundingClientRect();
    const margin = 12;
    const left = Math.min(Math.max(margin, x - width / 2), window.innerWidth - width - margin);
    const top = y + height + margin > window.innerHeight ? y - height - 14 : y + 14;
    this.el.style.left = `${Math.round(left)}px`;
    this.el.style.top = `${Math.round(Math.max(margin, top))}px`;
  }

  private render(): void {
    const idea = this.idea;
    const actions = this.actions;
    if (!idea || !actions) return;

    this.el.replaceChildren();

    // Who pinned it and when. The address, not the display name: on a
    // ten-person board the useful question is who to walk over and ask.
    const head = document.createElement('div');
    head.className = 'menu-head';
    const caption = document.createElement('span');
    caption.className = 'menu-caption';
    caption.textContent = t('menu.author');
    const who = document.createElement('span');
    who.className = 'menu-email';
    who.textContent = idea.authorEmail || idea.author;
    const when = document.createElement('span');
    when.className = 'menu-when';
    when.textContent = formatDateTime(idea.createdAt);
    head.append(caption, who, when);

    const grid = document.createElement('div');
    grid.className = 'menu-grid';
    for (const status of STATUSES) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'menu-status';
      button.style.setProperty('--swatch', status.paper);
      button.setAttribute('aria-pressed', String(status.id === idea.status));
      if (status.id === idea.status) button.classList.add('is-current');

      // The swatch shows the paper the note will turn, and carries the icon
      // that says what the status actually means.
      const swatch = document.createElement('span');
      swatch.className = 'menu-swatch';
      swatch.appendChild(statusIcon(status));
      const label = document.createElement('span');
      label.textContent = t(status.key);
      button.append(swatch, label);
      button.addEventListener('click', () => actions.onStatus(status.id));
      grid.appendChild(button);
    }

    this.el.append(head, grid);

    if (actions.canEdit || actions.canDelete) {
      const foot = document.createElement('div');
      foot.className = 'menu-foot';
      if (actions.canEdit) {
        const edit = document.createElement('button');
        edit.type = 'button';
        edit.className = 'menu-link';
        edit.textContent = t('menu.edit');
        edit.addEventListener('click', () => actions.onEdit());
        foot.appendChild(edit);
      }
      if (actions.canDelete) {
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'menu-link is-danger';
        del.textContent = t('menu.delete');
        del.addEventListener('click', () => actions.onDelete());
        foot.appendChild(del);
      }
      this.el.appendChild(foot);
    }
  }
}
