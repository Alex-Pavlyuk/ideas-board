import { ApiError, api } from './api';
import { formatCountdown, lang, onLangChange, setLang, t, tf, type Key } from './i18n';
import { STATUSES } from './statuses';
import type { Me } from './types';

/**
 * First screen: a sheet of paper taped to the board, with the board itself —
 * real ideas, tilted and drifting — visible behind it. It is the one place in
 * the app that gets to be charming, and it sets up the metaphor everything
 * after it runs on.
 *
 * There is no sign-up link by design: accounts are issued by the administrator,
 * so the form only ever asks for credentials someone was handed.
 */

/**
 * Wallpaper with words. Deliberately not in the main dictionary: nothing reads
 * these out, they exist so the board looks inhabited before you are let in.
 */
const BACKDROP_IDEAS: Record<'en' | 'uk', string[]> = {
  en: [
    'Ship the changelog',
    'Kill the Monday call',
    'Open-source the design tokens',
    'One-click demo for sales',
    'Trial without a sales call',
    'Polish first, then Czech',
    'Pay for referrals',
    'Retire the old status page',
  ],
  uk: [
    'Випустити чейнджлог',
    'Скасувати понеділковий дзвінок',
    'Відкрити дизайн-токени',
    'Демо в один клік',
    'Тріал без дзвінка',
    'Спершу польська, потім чеська',
    'Платити за рекомендації',
    'Прибрати стару статус-сторінку',
  ],
};

/** x/y in viewport %, r = tilt, s = scale, d = parallax depth. */
const SCATTER = [
  { x: 7, y: 13, r: -8, s: 1.0, d: 1.0 },
  { x: 79, y: 9, r: 6, s: 0.9, d: 0.75 },
  { x: 13, y: 63, r: 5, s: 0.86, d: 1.3 },
  { x: 83, y: 56, r: -9, s: 1.05, d: 1.05 },
  { x: 39, y: 86, r: 3, s: 0.78, d: 1.5 },
  { x: 65, y: 79, r: -6, s: 0.7, d: 0.6 },
  { x: 25, y: 33, r: 9, s: 0.6, d: 0.42 },
  { x: 71, y: 32, r: -4, s: 0.64, d: 0.5 },
];

/** Every status except Buried — the backdrop should look alive. */
const LIVE_PAPERS = STATUSES.filter((status) => status.key !== 'status.5').map((status) => status.paper);

/** Reasons the callback may hand back. Anything else falls back to a generic error. */
const SSO_REASONS = new Set([
  'denied', 'state', 'exchange', 'profile', 'inactive',
  'disabled', 'domain', 'link_taken', 'unconfigured', 'no_account',
]);

const TAGLINES: Key[] = ['login.tagline.1', 'login.tagline.2', 'login.tagline.3', 'login.tagline.4'];
/** Chosen once per visit, so switching language does not reshuffle the line. */
const TAGLINE = TAGLINES[Math.floor(Math.random() * TAGLINES.length)]!;

export function renderLogin(mount: HTMLElement, onSuccess: (me: Me) => void): void {
  const root = el('div', 'login');

  // --- the board behind the sheet -----------------------------------------
  const board = el('div', 'login-board');
  board.setAttribute('aria-hidden', 'true');

  const notes = SCATTER.map((pos, i) => {
    const slot = el('span', 'login-note');
    slot.style.left = `${pos.x}%`;
    slot.style.top = `${pos.y}%`;
    slot.dataset.depth = String(pos.d);

    // Opacity and focus track depth, so the scatter reads as layers rather than
    // one flat sheet of stickers.
    slot.style.opacity = (0.26 + pos.d * 0.15).toFixed(2);
    if (pos.d < 0.8) slot.style.filter = `blur(${((0.8 - pos.d) * 1.3).toFixed(2)}px)`;

    const paper = el('span', 'login-note-paper');
    paper.style.transform = `rotate(${pos.r}deg) scale(${pos.s})`;
    // Buried grey is excluded: this is the board at its liveliest, not at rest.
    paper.style.background = LIVE_PAPERS[i % LIVE_PAPERS.length]!;
    paper.style.animationDelay = `${140 + i * 80}ms`;

    slot.appendChild(paper);
    board.appendChild(slot);
    return paper;
  });

  function fillNotes(): void {
    const texts = BACKDROP_IDEAS[lang()];
    notes.forEach((paper, i) => { paper.textContent = texts[i % texts.length] ?? ''; });
  }
  fillNotes();

  // --- the sheet ------------------------------------------------------------
  const sheet = document.createElement('form');
  sheet.className = 'login-sheet';
  sheet.noValidate = true;

  const tape = el('span', 'login-tape');
  tape.setAttribute('aria-hidden', 'true');

  const head = el('div', 'login-head');
  head.innerHTML = BULB;
  const title = el('h1');
  const underline = el('span', 'login-underline');
  underline.innerHTML = SQUIGGLE;
  underline.setAttribute('aria-hidden', 'true');
  const titleWrap = el('div', 'login-title');
  titleWrap.append(title, underline);
  head.appendChild(titleWrap);

  const tagline = el('p', 'login-tagline');

  const { label: emailLabel, input: email, caption: emailCaption } = field('email', 'username');
  const { label: passwordLabel, input: password, caption: passwordCaption } = field('password', 'current-password');

  const error = el('p', 'login-error');
  error.hidden = true;
  error.setAttribute('role', 'alert');

  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'login-go';
  const submitLabel = el('span');
  const submitArrow = el('span', 'login-go-arrow');
  submitArrow.textContent = '→';
  submit.append(submitLabel, submitArrow);

  const hint = el('p', 'login-hint');

  // Hidden until /api/auth/providers says GitLab is configured — offering a
  // button that can only fail is worse than not offering one.
  const ssoBlock = el('div', 'login-sso');
  ssoBlock.hidden = true;
  const divider = el('div', 'login-divider');
  const dividerText = el('span');
  divider.appendChild(dividerText);
  const gitlabButton = document.createElement('a');
  gitlabButton.className = 'login-sso-btn';
  // A plain link, not fetch: OAuth is a full-page journey to GitLab and back.
  gitlabButton.href = '/api/auth/gitlab';
  gitlabButton.innerHTML = TANUKI;
  const gitlabLabel = el('span');
  gitlabButton.appendChild(gitlabLabel);
  ssoBlock.append(divider, gitlabButton);

  const langSwitch = el('div', 'login-lang');
  const langButtons: Record<string, HTMLButtonElement> = {};
  for (const code of ['en', 'uk'] as const) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'login-lang-tab';
    b.textContent = code.toUpperCase();
    b.addEventListener('click', () => setLang(code));
    langButtons[code] = b;
    langSwitch.appendChild(b);
  }

  sheet.append(tape, head, tagline, emailLabel, passwordLabel, error, submit, hint, ssoBlock, langSwitch);
  root.append(board, sheet);
  mount.replaceChildren(root);

  // --- parallax -------------------------------------------------------------
  // The notes lag behind the pointer by depth, so the board reads as having
  // some thickness rather than being a flat backdrop.
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
    let pending = 0;
    root.addEventListener('pointermove', (e) => {
      if (pending) return;
      pending = requestAnimationFrame(() => {
        pending = 0;
        const dx = (e.clientX / window.innerWidth - 0.5) * 2;
        const dy = (e.clientY / window.innerHeight - 0.5) * 2;
        for (const slot of board.children) {
          const depth = Number((slot as HTMLElement).dataset.depth ?? 1);
          (slot as HTMLElement).style.translate = `${-dx * depth * 18}px ${-dy * depth * 14}px`;
        }
      });
    });
  }

  // --- lockout countdown ----------------------------------------------------
  let lockedUntil = 0;
  let ticker = 0;

  function tick(): void {
    const left = (lockedUntil - Date.now()) / 1000;
    if (left <= 0) {
      window.clearInterval(ticker);
      ticker = 0;
      lockedUntil = 0;
      submit.disabled = false;
      error.hidden = true;
      retranslate();
      return;
    }
    error.replaceChildren(
      document.createTextNode(tf('login.locked', { time: formatCountdown(left) })),
      el('span', 'login-error-hint', t('login.lockedHint')),
    );
  }

  function lockFor(seconds: number): void {
    lockedUntil = Date.now() + Math.max(1, seconds) * 1000;
    submit.disabled = true;
    error.hidden = false;
    window.clearInterval(ticker);
    ticker = window.setInterval(tick, 500);
    tick();
  }

  function showError(message: string): void {
    error.replaceChildren(document.createTextNode(message));
    error.hidden = false;
    // A small nudge is a faster read than the sentence underneath it.
    sheet.classList.remove('is-wrong');
    void sheet.offsetWidth;
    sheet.classList.add('is-wrong');
  }

  // --- translation ----------------------------------------------------------
  function retranslate(): void {
    document.title = t('app.title');
    title.textContent = t('app.title');
    tagline.textContent = t(TAGLINE);
    emailCaption.textContent = t('login.email');
    passwordCaption.textContent = t('login.password');
    submitLabel.textContent = submit.disabled && lockedUntil === 0 ? t('login.working') : t('login.submit');
    hint.textContent = t('login.hint');
    dividerText.textContent = t('login.or');
    gitlabLabel.textContent = t('login.gitlab');
    fillNotes();
    for (const [code, button] of Object.entries(langButtons)) {
      button.classList.toggle('is-active', code === lang());
    }
    if (lockedUntil > 0) tick();
  }
  onLangChange(retranslate);
  retranslate();

  email.focus();

  void api.providers()
    .then((providers) => { ssoBlock.hidden = !providers.gitlab; })
    .catch(() => { /* leave the button hidden */ });

  // The OAuth callback cannot answer with JSON — the browser is mid-redirect —
  // so it hands the reason back as ?sso=… for this screen to explain.
  const reason = new URLSearchParams(location.search).get('sso');
  if (reason) {
    history.replaceState(null, '', location.pathname);
    showError(SSO_REASONS.has(reason) ? t(`sso.${reason}` as Key) : t('login.error'));
  }

  // --- submit ---------------------------------------------------------------
  sheet.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (submit.disabled) return;

    if (!email.value.trim() || !password.value) {
      showError(t('login.missing'));
      return;
    }

    error.hidden = true;
    submit.disabled = true;
    submitLabel.textContent = t('login.working');
    try {
      const me = await api.login(email.value.trim(), password.value);
      sheet.classList.add('is-open');
      onSuccess(me);
    } catch (err) {
      password.value = '';
      if (err instanceof ApiError && err.status === 429) {
        // Retry-After turns "try again later" into a countdown the person can act on.
        lockFor(err.retryAfter || 60);
        submitLabel.textContent = t('login.submit');
        return;
      }
      showError(messageFor(err));
      password.focus();
    } finally {
      if (lockedUntil === 0) {
        submit.disabled = false;
        submitLabel.textContent = t('login.submit');
      }
    }
  });
}

function field(type: 'email' | 'password', autocomplete: AutoFill) {
  const label = el('label', 'paper-field');
  const caption = el('span', 'paper-caption');
  const input = document.createElement('input');
  input.type = type;
  input.name = type;
  input.autocomplete = autocomplete;
  input.required = true;
  label.append(caption, input);
  return { label, input, caption };
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, className?: string, text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function messageFor(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === 'missing_credentials') return t('login.missing');
    if (e.status === 401) return t('login.invalid');
  }
  return t('login.error');
}

/** The GitLab mark, so the button is recognisable at a glance. */
const TANUKI = `
<svg class="login-tanuki" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
  <path d="M23.955 13.587l-1.342-4.135-2.664-8.189a.455.455 0 0 0-.867 0L16.418 9.45H7.582L4.918 1.263a.455.455 0 0 0-.867 0L1.386 9.452.044 13.587a.924.924 0 0 0 .331 1.023L12 23.054l11.625-8.443a.92.92 0 0 0 .33-1.024"/>
</svg>`;

/** Drawn rather than an emoji: it has to sit on paper and match the ink. */
const BULB = `
<svg class="login-bulb" viewBox="0 0 32 32" fill="none" aria-hidden="true">
  <path d="M16 3.5c-4.7 0-8.2 3.4-8.2 7.9 0 3 1.5 4.9 2.9 6.5 1 1.2 1.7 2 1.9 3.4h6.8c.2-1.4.9-2.2 1.9-3.4 1.4-1.6 2.9-3.5 2.9-6.5 0-4.5-3.5-7.9-8.2-7.9Z"
        stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
  <path d="M12.8 24.4h6.4M13.8 27.6h4.4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  <path d="M16 12.6v4.4M13.6 10.6 16 12.6l2.4-2" stroke="currentColor" stroke-width="1.6"
        stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

/** A marker underline: two overlapping strokes, so it reads as drawn by hand. */
const SQUIGGLE = `
<svg viewBox="0 0 180 12" fill="none" preserveAspectRatio="none" aria-hidden="true">
  <path d="M3 7.5c28-3.4 74-4.6 174-2.6" stroke="currentColor" stroke-width="3.4" stroke-linecap="round"/>
  <path d="M14 10.4c40-2.2 96-2.6 150-1.4" stroke="currentColor" stroke-width="1.7"
        stroke-linecap="round" opacity=".5"/>
</svg>`;
