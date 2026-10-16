import '../styles/app.css';
import '../styles/admin.css';
import { ApiError, adminApi, api, type AdminUser, type LogEvent, type Stats } from './api';
import { clear, copyText, formatBytes, h, on } from './dom';
import { formatCountdown, formatDateTime, formatDuration, lang, onLangChange, setLang, t, tf, type Key } from './i18n';
import { STATUSES, statusMeta } from './statuses';
import type { Idea, Me } from './types';

const EVENT_KINDS = [1, 6, 2, 5, 3, 4, 7, 10, 11, 12, 13, 14, 20, 21, 22, 23, 24, 30];

type Tab = 'users' | 'ideas' | 'log' | 'stats';

class AdminApp {
  private tab: Tab = 'users';
  private readonly body = h('main', { class: 'admin-body' });
  private readonly tabButtons = new Map<Tab, HTMLButtonElement>();
  private users: AdminUser[] = [];

  constructor(private readonly mount: HTMLElement, private readonly me: Me) {
    const header = this.buildHeader();
    this.mount.replaceChildren(h('div', { class: 'admin' }, header, this.body));
    onLangChange(() => { this.retranslate(); void this.render(); });
    this.retranslate();
    void this.render();
  }

  private readonly labels = {
    title: h('span', { class: 'brand-text' }),
    back: h('a', { class: 'btn btn-ghost', href: '/' }),
  };

  private buildHeader(): HTMLElement {
    const tabs = h('nav', { class: 'admin-tabs' });
    for (const tab of ['users', 'ideas', 'log', 'stats'] as Tab[]) {
      const button = h('button', { type: 'button', class: 'admin-tab' });
      on(button, 'click', () => {
        this.tab = tab;
        this.syncTabs();
        void this.render();
      });
      this.tabButtons.set(tab, button);
      tabs.appendChild(button);
    }

    const langSwitch = h('div', { class: 'lang-switch' });
    for (const code of ['en', 'uk'] as const) {
      const b = h('button', { type: 'button', class: 'lang-btn', text: code.toUpperCase() });
      on(b, 'click', () => setLang(code));
      b.dataset.code = code;
      langSwitch.appendChild(b);
    }
    this.langSwitch = langSwitch;

    return h('header', { class: 'admin-header' },
      h('div', { class: 'brand' }, h('span', { class: 'brand-mark', text: '◆' }), this.labels.title),
      tabs,
      h('div', { class: 'spacer' }),
      langSwitch,
      this.labels.back,
    );
  }

  private langSwitch!: HTMLElement;

  private retranslate(): void {
    document.title = `${t('admin.title')} · ${t('app.title')}`;
    this.labels.title.textContent = t('admin.title');
    this.labels.back.textContent = `← ${t('admin.back')}`;
    for (const [tab, button] of this.tabButtons) {
      button.textContent = t(`admin.tab.${tab}` as Key);
    }
    for (const b of this.langSwitch.querySelectorAll<HTMLButtonElement>('.lang-btn')) {
      b.classList.toggle('is-active', b.dataset.code === lang());
    }
    this.syncTabs();
  }

  private syncTabs(): void {
    for (const [tab, button] of this.tabButtons) button.classList.toggle('is-active', tab === this.tab);
  }

  private async render(): Promise<void> {
    clear(this.body);
    this.body.appendChild(h('p', { class: 'muted', text: t('common.loading') }));
    try {
      const view = this.tab === 'users' ? await this.renderUsers()
        : this.tab === 'ideas' ? await this.renderIdeas()
        : this.tab === 'log' ? await this.renderLog()
        : await this.renderStats();
      clear(this.body);
      this.body.appendChild(view);
    } catch (e) {
      clear(this.body);
      this.body.appendChild(h('p', { class: 'error', text: errorText(e) }));
    }
  }

  // ------------------------------------------------------------------ users

  private async renderUsers(): Promise<HTMLElement> {
    this.users = await adminApi.users();

    const feedback = h('div', { class: 'feedback', hidden: true });

    const email = h('input', { type: 'email', placeholder: 'name@company.com', autocomplete: 'off' });
    const name = h('input', { type: 'text', autocomplete: 'off' });
    const password = h('input', { type: 'text', autocomplete: 'off', placeholder: t('admin.users.passwordAuto') });
    const isAdmin = h('input', { type: 'checkbox' });
    const submit = h('button', { type: 'submit', class: 'btn btn-primary', text: t('admin.users.create') });

    const form = h('form', { class: 'card add-user' },
      h('h2', { text: t('admin.users.add') }),
      h('div', { class: 'add-user-grid' },
        field(t('admin.users.email'), email),
        field(t('admin.users.name'), name),
        field(t('admin.users.password'), password),
        h('label', { class: 'checkbox' }, isAdmin, h('span', { text: t('admin.users.isAdmin') })),
        submit,
      ),
      feedback,
    );

    on(form, 'submit', async (e) => {
      e.preventDefault();
      submit.disabled = true;
      try {
        const created = await adminApi.createUser(email.value.trim(), password.value, name.value.trim(), isAdmin.checked);
        showCredentials(feedback, t('admin.users.created'), created.email, created.password);
        email.value = '';
        name.value = '';
        password.value = '';
        isAdmin.checked = false;
        this.users = await adminApi.users();
        table.replaceWith(table = this.usersTable());
      } catch (err) {
        feedback.hidden = false;
        feedback.className = 'feedback is-error';
        feedback.replaceChildren(document.createTextNode(errorText(err)));
      } finally {
        submit.disabled = false;
      }
    });

    let table = this.usersTable();
    return h('div', { class: 'stack' }, form, table);
  }

  private usersTable(): HTMLElement {
    const rows = this.users.map((user) => {
      const feedback = h('td', { class: 'cell-feedback', colSpan: 5 });
      const feedbackRow = h('tr', { class: 'row-feedback', hidden: true }, feedback);

      const reset = actionButton(t('admin.users.reset'), async () => {
        const result = await adminApi.resetPassword(user.id, '');
        feedbackRow.hidden = false;
        clear(feedback);
        showCredentials(feedback, t('admin.users.resetDone'), user.email, result.password);
      });

      const toggle = actionButton(user.isActive ? t('admin.users.disable') : t('admin.users.enable'), async () => {
        await adminApi.setActive(user.id, !user.isActive);
        void this.render();
      });

      const remove = actionButton(t('admin.users.delete'), async () => {
        if (!confirm(t('admin.users.deleteConfirm'))) return;
        await adminApi.deleteUser(user.id);
        void this.render();
      }, 'is-danger');

      const unlink = actionButton(t('admin.users.unlink'), async () => {
        if (!confirm(t('admin.users.unlinkConfirm'))) return;
        await adminApi.unlinkGitLab(user.id);
        void this.render();
      });

      const unlock = actionButton(t('admin.users.unlock'), async () => {
        await adminApi.unlockUser(user.id);
        void this.render();
      });

      const self = user.id === this.me.id;
      toggle.disabled = self;
      remove.disabled = self;

      const row = h('tr', {},
        h('td', {},
          h('div', { class: 'user-email' }, document.createTextNode(user.email),
            user.isAdmin ? h('span', { class: 'tag', text: 'admin' }) : null,
            user.gitlab ? h('span', { class: 'tag is-gitlab', text: `@${user.gitlab}` }) : null),
          h('div', { class: 'muted small', text: user.name }),
        ),
        h('td', {},
          user.lockedUntil
            ? h('div', { class: 'stack-tight' },
                h('span', { class: 'pill is-locked', text: t('admin.users.locked') }),
                h('span', { class: 'muted small', text: tf('admin.users.lockedFor', { n: user.failedAttempts }) }))
            : user.online
              ? h('span', { class: 'pill is-online', text: t('admin.users.online') })
              : h('span', { class: user.isActive ? 'pill' : 'pill is-off', text: user.isActive ? t('admin.users.active') : t('admin.users.disabled') }),
        ),
        h('td', { class: 'muted small', text: user.lastSeenAt ? formatDateTime(user.lastSeenAt) : t('admin.users.never') }),
        h('td', { class: 'muted small', text: formatDateTime(user.createdAt) }),
        h('td', { class: 'actions' },
          user.lockedUntil ? unlock : null, user.gitlab ? unlink : null, reset, toggle, remove),
      );

      return [row, feedbackRow];
    }).flat();

    return h('div', { class: 'card' },
      h('table', { class: 'table' },
        h('thead', {}, h('tr', {},
          th('admin.users.email'), th('admin.users.status'), th('admin.users.lastSeen'),
          th('admin.ideas.created'), th('admin.users.actions'),
        )),
        h('tbody', {}, ...rows),
      ),
    );
  }

  // ------------------------------------------------------------------ ideas

  private async renderIdeas(): Promise<HTMLElement> {
    const ideas = await adminApi.ideas();
    const search = h('input', { type: 'search', class: 'search', placeholder: t('admin.ideas.search') });
    const tbody = h('tbody');

    const draw = (query: string) => {
      const q = query.trim().toLowerCase();
      const filtered = q
        ? ideas.filter((i) => i.text.toLowerCase().includes(q) || i.author.toLowerCase().includes(q))
        : ideas;
      clear(tbody);
      if (filtered.length === 0) {
        tbody.appendChild(h('tr', {}, h('td', { colSpan: 5, class: 'muted', text: t('admin.ideas.empty') })));
        return;
      }
      for (const idea of filtered) tbody.appendChild(this.ideaRow(idea, () => void this.render()));
    };

    on(search, 'input', () => draw(search.value));
    draw('');

    return h('div', { class: 'stack' },
      h('div', { class: 'toolbar' }, search, h('span', { class: 'muted small', text: `${ideas.length}` })),
      h('div', { class: 'card' },
        h('table', { class: 'table' },
          h('thead', {}, h('tr', {},
            th('admin.ideas.text'), th('admin.ideas.status'), th('admin.ideas.author'),
            th('admin.ideas.created'), th('admin.users.actions'),
          )),
          tbody,
        ),
      ),
    );
  }

  private ideaRow(idea: Idea, refresh: () => void): HTMLElement {
    const meta = statusMeta(idea.status);
    const remove = actionButton(t('admin.ideas.delete'), async () => {
      if (!confirm(t('admin.ideas.deleteConfirm'))) return;
      await api.deleteIdea(idea.id);
      refresh();
    }, 'is-danger');

    return h('tr', {},
      h('td', { class: 'cell-idea' }, h('span', { class: 'idea-text', text: idea.text })),
      h('td', {}, h('span', { class: 'status-pill', text: t(meta.key), style: `--pill:${meta.accent}` })),
      h('td', { class: 'muted small', text: idea.author }),
      h('td', { class: 'muted small', text: formatDateTime(idea.createdAt) }),
      h('td', { class: 'actions' }, remove),
    );
  }

  // -------------------------------------------------------------------- log

  private async renderLog(): Promise<HTMLElement> {
    if (this.users.length === 0) this.users = await adminApi.users();

    const kindSelect = h('select', { class: 'select' },
      h('option', { value: '', text: t('admin.log.all') }),
      ...EVENT_KINDS.map((k) => h('option', { value: String(k), text: t(`event.${k}` as Key) })),
    );
    const userSelect = h('select', { class: 'select' },
      h('option', { value: '', text: t('admin.log.allUsers') }),
      ...this.users.map((u) => h('option', { value: String(u.id), text: u.email })),
    );
    const exportLink = h('a', { class: 'btn btn-ghost', href: '/api/admin/events/export.ndjson', text: t('admin.log.export'), download: '' });

    const tbody = h('tbody');
    const more = h('button', { type: 'button', class: 'btn', text: t('admin.log.more') });
    const end = h('p', { class: 'muted small', text: t('admin.log.end'), hidden: true });

    let cursor: number | null = null;

    const load = async (reset: boolean) => {
      if (reset) { cursor = null; clear(tbody); end.hidden = true; more.hidden = false; }
      more.disabled = true;
      try {
        const params: { kind?: number; userId?: number; before?: number } = {};
        if (kindSelect.value) params.kind = Number(kindSelect.value);
        if (userSelect.value) params.userId = Number(userSelect.value);
        if (cursor !== null) params.before = cursor;

        const page = await adminApi.events(params);
        for (const event of page.events) tbody.appendChild(this.logRow(event));

        if (tbody.childElementCount === 0) {
          tbody.appendChild(h('tr', {}, h('td', { colSpan: 4, class: 'muted', text: t('admin.log.empty') })));
        }
        cursor = page.nextBefore;
        if (page.events.length < 100) { more.hidden = true; end.hidden = tbody.childElementCount === 0; }
      } finally {
        more.disabled = false;
      }
    };

    on(kindSelect, 'change', () => void load(true));
    on(userSelect, 'change', () => void load(true));
    on(more, 'click', () => void load(false));
    await load(true);

    return h('div', { class: 'stack' },
      h('div', { class: 'toolbar' }, kindSelect, userSelect, h('div', { class: 'spacer' }), exportLink),
      h('div', { class: 'card' },
        h('table', { class: 'table table-log' },
          h('thead', {}, h('tr', {}, th('admin.log.when'), th('admin.log.who'), th('admin.log.what'), th('admin.log.detail'))),
          tbody,
        ),
      ),
      h('div', { class: 'log-foot' }, more, end),
    );
  }

  private logRow(event: LogEvent): HTMLElement {
    return h('tr', {},
      h('td', { class: 'muted small nowrap', text: formatDateTime(event.ts) }),
      h('td', { class: 'small', text: event.user ?? '—' }),
      h('td', { class: 'small' }, h('span', { class: `event-tag k${event.kind}`, text: t(`event.${event.kind}` as Key) })),
      h('td', { class: 'small muted' }, detailFor(event)),
    );
  }

  // ------------------------------------------------------------------ stats

  private async renderStats(): Promise<HTMLElement> {
    const periods: [Key, number][] = [
      ['admin.stats.7', 7], ['admin.stats.30', 30], ['admin.stats.90', 90], ['admin.stats.all', 0],
    ];
    const select = h('select', { class: 'select' },
      ...periods.map(([key, days]) => h('option', { value: String(days), text: t(key), selected: days === 30 })),
    );

    const panel = h('div', { class: 'stack' });
    const draw = async () => {
      const days = Number(select.value);
      const since = days > 0 ? Math.floor(Date.now() / 1000) - days * 86400 : undefined;
      const stats = await adminApi.stats(since, days || 365);
      clear(panel);
      panel.append(this.statsUsers(stats), this.statsSummary(stats));
    };
    on(select, 'change', () => void draw());
    await draw();

    return h('div', { class: 'stack' },
      h('div', { class: 'toolbar' },
        h('span', { class: 'muted small', text: t('admin.stats.period') }), select),
      panel,
    );
  }

  private statsUsers(stats: Stats): HTMLElement {
    const rows = stats.users.map((u) => h('tr', {},
      h('td', {},
        h('div', { text: u.name || u.email }),
        h('div', { class: 'muted small', text: u.email }),
      ),
      h('td', { class: 'num', text: String(u.visits) }),
      h('td', { class: 'num', text: formatDuration(u.secondsOnBoard) }),
      h('td', { class: 'num', text: String(u.ideasCreated) }),
      h('td', { class: 'num', text: String(u.statusChanges) }),
      h('td', { class: 'num', text: String(u.logins) }),
    ));

    return h('div', { class: 'card' },
      h('table', { class: 'table' },
        h('thead', {}, h('tr', {},
          th('admin.stats.user'), th('admin.stats.visits'), th('admin.stats.time'),
          th('admin.stats.ideas'), th('admin.stats.changes'), th('admin.stats.logins'),
        )),
        h('tbody', {}, ...rows),
      ),
    );
  }

  private statsSummary(stats: Stats): HTMLElement {
    const total = Object.values(stats.ideasByStatus).reduce((a, b) => a + b, 0);
    const bars = STATUSES.map((status) => {
      const count = stats.ideasByStatus[String(status.id)] ?? 0;
      const share = total > 0 ? (count / total) * 100 : 0;
      return h('div', { class: 'bar-row' },
        h('span', { class: 'bar-label', text: t(status.key) }),
        h('span', { class: 'bar-track' },
          h('span', { class: 'bar-fill', style: `width:${share}%;background:${status.accent}` })),
        h('span', { class: 'bar-value', text: String(count) }),
      );
    });

    const s = stats.storage;
    const sec = stats.security;
    return h('div', { class: 'grid-cards' },
      h('div', { class: 'card pad' }, h('h2', { text: t('admin.stats.byStatus') }), ...bars),
      h('div', { class: 'card pad' },
        h('h2', { text: t('admin.stats.security') }),
        h('dl', { class: 'facts' },
          h('dt', { text: t('admin.stats.failedLogins') }), h('dd', { text: String(sec.failedLogins) }),
          h('dt', { text: t('admin.stats.lockouts') }), h('dd', { text: String(sec.lockouts) }),
          h('dt', { text: t('admin.stats.lockedAccounts') }),
          h('dd', { class: sec.lockedAccounts > 0 ? 'is-warn' : '', text: String(sec.lockedAccounts) }),
          h('dt', { text: t('admin.stats.blockedSources') }),
          h('dd', { class: sec.blockedSources > 0 ? 'is-warn' : '', text: String(sec.blockedSources) }),
        ),
        h('p', { class: 'muted small', text: t('admin.stats.securityNote') }),
      ),
      h('div', { class: 'card pad' },
        h('h2', { text: t('admin.stats.storage') }),
        h('dl', { class: 'facts' },
          h('dt', { text: t('admin.stats.events') }), h('dd', { text: s.events.toLocaleString() }),
          h('dt', { text: t('admin.stats.visitsTotal') }), h('dd', { text: s.visits.toLocaleString() }),
          h('dt', { text: t('admin.stats.size') }), h('dd', { text: formatBytes(s.bytes) }),
          h('dt', { text: t('admin.stats.retention') }), h('dd', { text: `${s.retentionDays} ${t('admin.stats.days')}` }),
        ),
        h('p', { class: 'muted small', text: t('admin.stats.retentionNote') }),
      ),
    );
  }
}

// ---------------------------------------------------------------- helpers

function th(key: Key): HTMLElement {
  return h('th', { text: t(key) });
}

function field(label: string, input: HTMLElement): HTMLElement {
  return h('label', { class: 'field' }, h('span', { text: label }), input);
}

function actionButton(label: string, action: () => Promise<void>, extra = ''): HTMLButtonElement {
  const button = h('button', { type: 'button', class: `btn btn-small ${extra}`, text: label });
  on(button, 'click', async () => {
    button.disabled = true;
    try { await action(); }
    catch (e) { alert(errorText(e)); }
    finally { button.disabled = false; }
  });
  return button;
}

/** One-time credentials: shown once, with a copy button, never fetchable again. */
function showCredentials(host: HTMLElement, title: string, email: string, password: string): void {
  host.hidden = false;
  host.className = 'feedback is-ok';
  const value = h('code', { class: 'cred', text: `${email} / ${password}` });
  const copy = h('button', { type: 'button', class: 'btn btn-small', text: t('admin.users.copy') });
  on(copy, 'click', async () => {
    if (await copyText(`${email} / ${password}`)) copy.textContent = t('admin.users.copied');
  });
  host.replaceChildren(h('span', { text: title }), value, copy);
}

function detailFor(event: LogEvent): string {
  if (event.kind === 11 && event.a !== null && event.b !== null) {
    const from = STATUSES.find((s) => s.id === event.a);
    const to = STATUSES.find((s) => s.id === event.b);
    const label = event.idea ?? event.meta ?? `#${event.ideaId ?? '?'}`;
    return `${from ? t(from.key) : event.a} → ${to ? t(to.key) : event.b} · ${label}`;
  }
  // Kind 5 carries the lock length it triggered, which is the interesting part.
  if (event.kind === 5) return `${event.meta ?? ''} · ${formatCountdown(event.a ?? 0)}`;
  if (event.kind === 21) return event.b === 1 ? t('admin.users.active') : t('admin.users.disabled');
  if (event.kind === 30) return `${event.a ?? 0}`;
  return event.meta ?? event.idea ?? (event.ideaId ? `#${event.ideaId}` : '');
}

function errorText(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === 'email_taken') return t('admin.users.taken');
    if (e.code === 'bad_email') return t('admin.users.badEmail');
    if (e.code === 'password_too_short') return t('admin.users.tooShort');
    if (e.code === 'password_common') return t('admin.users.common');
    if (e.code === 'password_too_simple') return t('admin.users.tooSimple');
    if (e.code === 'password_contains_email') return t('admin.users.containsEmail');
    if (e.code === 'forbidden') return t('common.forbidden');
  }
  return t('common.error');
}

// -------------------------------------------------------------------- boot

const mount = document.getElementById('root');
if (!mount) throw new Error('#root missing');

void (async () => {
  try {
    const me = await api.me();
    if (!me.isAdmin) {
      mount.replaceChildren(h('div', { class: 'boot' },
        h('div', {}, h('p', { text: t('common.forbidden') }),
          h('a', { class: 'btn', href: '/', text: `← ${t('admin.back')}` }))));
      return;
    }
    new AdminApp(mount, me);
  } catch {
    location.href = '/';
  }
})();
