import { STATUSES, statusIcon } from '../statuses';
import { lang, onLangChange, setLang, t } from '../i18n';
import type { Me } from '../types';

export interface Chrome {
  root: HTMLElement;
  canvas: HTMLElement;
  world: HTMLElement;
  newButton: HTMLButtonElement;
  search: HTMLInputElement;
  filterChips: Map<number, HTMLButtonElement>;
  allChip: HTMLButtonElement;
  counter: HTMLElement;
  emptyState: HTMLElement;
  offline: HTMLElement;
  hud: HTMLElement;
  zoomIn: HTMLButtonElement;
  zoomOut: HTMLButtonElement;
  fit: HTMLButtonElement;
  helpButton: HTMLButtonElement;
  helpPanel: HTMLElement;
  toast: (message: string) => void;
  retranslate: () => void;
}

/**
 * Builds the fixed UI around the canvas. Plain DOM construction, no template
 * strings: every label has to survive a language switch without a reload, and
 * keeping references beats re-parsing HTML.
 */
export function buildChrome(me: Me): Chrome {
  const root = el('div', 'board-app');

  // --- top bar ------------------------------------------------------------
  const bar = el('header', 'topbar');

  const brand = el('div', 'brand');
  const mark = el('span', 'brand-mark');
  mark.textContent = '◆';
  const brandText = el('span', 'brand-text');
  brand.append(mark, brandText);

  const newButton = document.createElement('button');
  newButton.type = 'button';
  newButton.className = 'btn btn-primary';
  const plus = el('span', 'btn-plus');
  plus.textContent = '+';
  const newLabel = el('span');
  newButton.append(plus, newLabel);

  const filters = el('div', 'filters');
  const allChip = chip('all');
  const filterChips = new Map<number, HTMLButtonElement>();
  filters.appendChild(allChip);
  for (const status of STATUSES) {
    const c = chip(String(status.id));
    c.style.setProperty('--chip', status.accent);
    // The icon goes before the label, so the row of chips doubles as the legend
    // for what the colours on the board mean.
    c.insertBefore(statusIcon(status, 'chip-icon'), c.firstChild);
    filterChips.set(status.id, c);
    filters.appendChild(c);
  }

  const searchWrap = el('div', 'search-wrap');
  const searchIcon = el('span', 'search-icon');
  searchIcon.textContent = '⌕';
  const search = document.createElement('input');
  search.type = 'search';
  search.className = 'search';
  search.autocomplete = 'off';
  searchWrap.append(searchIcon, search);

  const counter = el('span', 'counter');

  const spacer = el('div', 'spacer');

  const langSwitch = el('div', 'lang-switch');
  const langButtons: Record<string, HTMLButtonElement> = {};
  for (const code of ['en', 'uk'] as const) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'lang-btn';
    b.textContent = code.toUpperCase();
    b.addEventListener('click', () => setLang(code));
    langButtons[code] = b;
    langSwitch.appendChild(b);
  }

  const helpButton = iconButton('?');
  helpButton.classList.add('btn-icon-help');

  const who = el('div', 'who');
  const avatar = el('span', 'avatar');
  avatar.textContent = initials(me.name || me.email);
  const whoName = el('span', 'who-name');
  whoName.textContent = me.name || me.email;
  who.append(avatar, whoName);

  const adminLink = document.createElement('a');
  adminLink.className = 'btn btn-ghost';
  adminLink.href = '/admin/';
  adminLink.hidden = !me.isAdmin;

  const logout = document.createElement('button');
  logout.type = 'button';
  logout.className = 'btn btn-ghost';
  logout.id = 'logout';

  bar.append(brand, newButton, filters, searchWrap, counter, spacer, langSwitch, helpButton, who, adminLink, logout);

  // --- canvas -------------------------------------------------------------
  const canvas = el('div', 'canvas');
  const world = el('div', 'world');
  world.dataset.detail = 'near';
  canvas.appendChild(world);

  // --- overlays -----------------------------------------------------------
  const emptyState = el('div', 'empty-state');
  const emptyTitle = el('h2');
  const emptyBody = el('p');
  emptyState.append(emptyTitle, emptyBody);
  emptyState.hidden = true;

  const offline = el('div', 'offline');
  offline.hidden = true;

  const hud = el('div', 'hud');
  const zoomOut = iconButton('−');
  const zoomIn = iconButton('+');
  const fit = iconButton('⤢');
  const zoomGroup = el('div', 'hud-zoom');
  zoomGroup.append(zoomOut, zoomIn, fit);
  hud.appendChild(zoomGroup);

  const helpPanel = el('div', 'help-panel');
  helpPanel.hidden = true;

  const toastEl = el('div', 'toast');
  toastEl.hidden = true;
  let toastTimer = 0;

  root.append(bar, canvas, emptyState, offline, hud, helpPanel, toastEl);

  // --- translation --------------------------------------------------------
  function retranslate(): void {
    document.title = t('app.title');
    brandText.textContent = t('app.title');
    newLabel.textContent = t('board.new');
    search.placeholder = t('board.search');
    allChip.textContent = t('board.all');
    for (const status of STATUSES) {
      const c = filterChips.get(status.id);
      if (!c) continue;
      // Only the label — setting textContent on the chip would delete its icon.
      const label = c.querySelector('.chip-label');
      if (label) label.textContent = t(status.key);
      // Narrow screens drop the labels, so the name has to live somewhere.
      c.title = t(status.key);
    }
    emptyTitle.textContent = t('board.empty.title');
    emptyBody.textContent = t('board.empty.body');
    offline.textContent = t('board.offline');
    adminLink.textContent = t('board.admin');
    logout.textContent = t('board.logout');
    helpButton.title = t('board.help');
    zoomIn.title = t('board.zoomIn');
    zoomOut.title = t('board.zoomOut');
    fit.title = t('board.fit');
    for (const [code, button] of Object.entries(langButtons)) {
      button.classList.toggle('is-active', code === lang());
    }
    renderHelp(helpPanel);
  }

  onLangChange(retranslate);
  retranslate();

  helpButton.addEventListener('click', () => { helpPanel.hidden = !helpPanel.hidden; });

  return {
    root, canvas, world, newButton, search, filterChips, allChip, counter,
    emptyState, offline, hud, zoomIn, zoomOut, fit, helpButton, helpPanel,
    toast(message: string) {
      toastEl.textContent = message;
      toastEl.hidden = false;
      clearTimeout(toastTimer);
      toastTimer = window.setTimeout(() => { toastEl.hidden = true; }, 3600);
    },
    retranslate,
  };
}

function renderHelp(panel: HTMLElement): void {
  panel.replaceChildren();
  const title = el('h3');
  title.textContent = t('help.title');
  panel.appendChild(title);

  const rows: [Parameters<typeof t>[0], Parameters<typeof t>[0]][] = [
    ['help.dblclick', 'help.dblclick.d'],
    ['help.click', 'help.click.d'],
    ['help.drag', 'help.drag.d'],
    ['help.rotate', 'help.rotate.d'],
    ['help.pan', 'help.pan.d'],
    ['help.zoom', 'help.zoom.d'],
  ];
  const list = el('dl', 'help-list');
  for (const [term, description] of rows) {
    const dt = el('dt');
    dt.textContent = t(term);
    const dd = el('dd');
    dd.textContent = t(description);
    list.append(dt, dd);
  }
  const keys = el('p', 'help-keys');
  keys.textContent = t('help.keys');
  panel.append(list, keys);
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, className?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function chip(value: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'chip is-on';
  b.dataset.value = value;
  if (value !== 'all') b.appendChild(el('span', 'chip-label'));
  return b;
}

function iconButton(glyph: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn-icon';
  b.textContent = glyph;
  return b;
}

function initials(name: string): string {
  const parts = name.replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '?';
  const second = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? '' : '';
  return (first + second).toUpperCase();
}
