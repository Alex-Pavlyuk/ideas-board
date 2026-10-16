import type { Key } from './i18n';

export const STATUS = {
  New: 0,
  Promising: 1,
  InProgress: 2,
  Research: 3,
  Hold: 4,
  Buried: 5,
} as const;

export interface StatusMeta {
  id: number;
  key: Key;
  /** Note paper. Pastel on purpose — the ink has to stay readable at any zoom. */
  paper: string;
  /** Saturated version of the same hue, used for chips, icons and the minimap. */
  accent: string;
  /** Inner markup of a 24×24 icon. Colour comes from `currentColor`. */
  icon: string;
}

/**
 * Icons carry the meaning that colour alone cannot: six pastels are hard to tell
 * apart from memory, impossible for a colour-blind reader, and meaningless to
 * someone opening the board for the first time. Each is a plain shape at 24×24
 * so it stays legible at the 14px the chips render it.
 */
const ICONS = {
  // Sparkle — freshly pinned, nobody has decided anything yet.
  new: '<path d="M12 3.2c.6 4.1 1.7 5.2 5.8 5.8-4.1.6-5.2 1.7-5.8 5.8-.6-4.1-1.7-5.2-5.8-5.8 4.1-.6 5.2-1.7 5.8-5.8Z"/>'
     + '<path d="M17.8 14.6c.3 2 .8 2.5 2.8 2.8-2 .3-2.5.8-2.8 2.8-.3-2-.8-2.5-2.8-2.8 2-.3 2.5-.8 2.8-2.8Z"/>',
  // Line trending up and to the right.
  promising: '<path d="M3 17.5 9.5 11l4 4L21 7.5" fill="none" stroke="currentColor" stroke-width="2.1"'
           + ' stroke-linecap="round" stroke-linejoin="round"/>'
           + '<path d="M15.5 7.5H21v5.5" fill="none" stroke="currentColor" stroke-width="2.1"'
           + ' stroke-linecap="round" stroke-linejoin="round"/>',
  // Play — it is moving.
  inProgress: '<path d="M7.5 4.8v14.4L19.5 12z"/>',
  // Magnifier — being looked into.
  research: '<circle cx="10.6" cy="10.6" r="6.4" fill="none" stroke="currentColor" stroke-width="2.1"/>'
          + '<path d="m15.4 15.4 5.1 5.1" fill="none" stroke="currentColor" stroke-width="2.1"'
          + ' stroke-linecap="round"/>',
  // Pause — parked, on purpose.
  hold: '<path d="M9 4.8v14.4M15 4.8v14.4" fill="none" stroke="currentColor" stroke-width="2.6"'
      + ' stroke-linecap="round"/>',
  // Arrow down onto a line — laid to rest, still on the wall.
  buried: '<path d="M12 3.5v9.5M7.6 8.6 12 13l4.4-4.4M4 19.5h16" fill="none" stroke="currentColor"'
        + ' stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/>',
} as const;

/**
 * Order matters: it is the order of the filter chips and of the status menu,
 * and it runs from "just arrived" to "put to rest".
 */
export const STATUSES: StatusMeta[] = [
  { id: STATUS.New,        key: 'status.0', paper: '#ffe47a', accent: '#e8b800', icon: ICONS.new },
  { id: STATUS.Promising,  key: 'status.1', paper: '#dcc0ff', accent: '#8b5cf6', icon: ICONS.promising },
  { id: STATUS.InProgress, key: 'status.2', paper: '#9debb8', accent: '#16a34a', icon: ICONS.inProgress },
  { id: STATUS.Research,   key: 'status.3', paper: '#a6d4ff', accent: '#2b7fff', icon: ICONS.research },
  { id: STATUS.Hold,       key: 'status.4', paper: '#ffc79a', accent: '#ea7317', icon: ICONS.hold },
  { id: STATUS.Buried,     key: 'status.5', paper: '#8d939c', accent: '#6b7280', icon: ICONS.buried },
];

const BY_ID = new Map(STATUSES.map((s) => [s.id, s]));

export function statusMeta(id: number): StatusMeta {
  return BY_ID.get(id) ?? STATUSES[0]!;
}

/** An <svg> for the status, inheriting colour from its parent. */
export function statusIcon(status: StatusMeta, className = 'status-icon'): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'currentColor');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', className);
  svg.innerHTML = status.icon;
  return svg;
}
