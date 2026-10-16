/**
 * Two languages, one flat dictionary. Kept as a plain object rather than a
 * library: the whole UI is ~90 strings and the bundle stays dependency-free.
 */
export type Lang = 'en' | 'uk';

const DICT = {
  en: {
    'app.title': 'Ideas Board',
    'app.tagline': 'Where the team’s ideas live.',
    // Picked at random on each visit — the sign-in screen is the one place this
    // thing gets to have a personality.
    'login.tagline.1': 'Every good one started as a sticky note.',
    'login.tagline.2': 'Bad ideas welcome. That’s how the good ones turn up.',
    'login.tagline.3': 'The wall where nothing gets quietly forgotten.',
    'login.tagline.4': 'Half of these will be terrible. That’s the point.',

    'login.email': 'Email',
    'login.password': 'Password',
    'login.submit': 'Sign in',
    'login.working': 'Signing in…',
    'login.invalid': 'Wrong email or password.',
    'login.missing': 'Enter your email and password.',
    'login.throttled': 'Too many attempts. Try again in a minute.',
    'login.locked': 'Too many attempts. Try again in {time}.',
    'login.lockedHint': 'Locked to stop password guessing. The administrator can lift it.',
    'login.gitlab': 'Continue with GitLab',
    'login.or': 'or',

    'sso.denied': 'GitLab sign-in was cancelled.',
    'sso.state': 'That sign-in link expired. Try again.',
    'sso.exchange': 'GitLab did not confirm the sign-in.',
    'sso.profile': 'Could not read your GitLab profile.',
    'sso.inactive': 'That GitLab account is not active.',
    'sso.disabled': 'That account is switched off. Ask the administrator.',
    'sso.domain': 'That email domain is not allowed here.',
    'sso.link_taken': 'That GitLab account is already linked to someone else.',
    'sso.unconfigured': 'GitLab sign-in is not set up.',
    'sso.no_account': 'No board account matches that GitLab user. Ask the administrator for access.',
    'login.error': 'Could not reach the server.',
    'login.hint': 'Accounts are issued by the administrator.',

    'board.new': 'New idea',
    'board.search': 'Search ideas…',
    'board.empty.title': 'The board is empty',
    'board.empty.body': 'Double-click anywhere to pin the first idea.',
    'board.nomatch': 'No idea matches this filter.',
    'board.fit': 'Fit all',
    'board.zoomIn': 'Zoom in',
    'board.zoomOut': 'Zoom out',
    'board.reset': 'Reset zoom',
    'board.admin': 'Admin',
    'board.logout': 'Sign out',
    'board.placeholder': 'Type the idea…',
    'board.saveHint': 'Enter to pin · Esc to cancel',
    'board.all': 'All',
    'board.offline': 'Connection lost — reconnecting…',
    'board.counter.one': 'idea',
    'board.counter.few': 'ideas',
    'board.counter.many': 'ideas',
    'board.help': 'Shortcuts',

    'menu.status': 'Status',
    'menu.edit': 'Edit text',
    'menu.delete': 'Delete forever',
    'menu.deleteConfirm': 'Delete this idea permanently? This cannot be undone.',
    'menu.author': 'Added by',
    'menu.close': 'Close',

    'status.0': 'New',
    'status.1': 'Promising',
    'status.2': 'In progress',
    'status.3': 'Research',
    'status.4': 'On hold',
    'status.5': 'Buried',

    'help.title': 'Shortcuts',
    'help.dblclick': 'Double-click empty space',
    'help.dblclick.d': 'new idea there',
    'help.drag': 'Drag a note',
    'help.drag.d': 'move it',
    'help.rotate': 'Drag the corner handle',
    'help.rotate.d': 'tilt it',
    'help.click': 'Click a note',
    'help.click.d': 'change its status',
    'help.pan': 'Drag empty space / two-finger scroll',
    'help.pan.d': 'pan the board',
    'help.zoom': '⌘ or Ctrl + scroll, pinch',
    'help.zoom.d': 'zoom',
    'help.keys': 'N new · F fit · / search · Esc cancel',

    'admin.title': 'Administration',
    'admin.back': 'Back to board',
    'admin.tab.users': 'Users',
    'admin.tab.ideas': 'Ideas',
    'admin.tab.log': 'Activity log',
    'admin.tab.stats': 'Statistics',

    'admin.users.add': 'Add user',
    'admin.users.email': 'Email',
    'admin.users.name': 'Name',
    'admin.users.password': 'Password',
    'admin.users.passwordAuto': 'leave empty to generate',
    'admin.users.isAdmin': 'Administrator',
    'admin.users.create': 'Create',
    'admin.users.created': 'Account created. Copy the password now — it is not stored.',
    'admin.users.taken': 'That email already has an account.',
    'admin.users.badEmail': 'That does not look like an email.',
    'admin.users.tooShort': 'Too short — at least 10 characters, or 14 for an administrator.',
    'admin.users.common': 'That is one of the first passwords anyone would try.',
    'admin.users.tooSimple': 'Too repetitive — mix in more different characters.',
    'admin.users.containsEmail': 'Do not build the password out of the email address.',
    'admin.users.reset': 'Reset password',
    'admin.users.resetDone': 'New password:',
    'admin.users.disable': 'Disable',
    'admin.users.enable': 'Enable',
    'admin.users.delete': 'Delete',
    'admin.users.deleteConfirm': 'Delete this account? Their ideas stay on the board.',
    'admin.users.locked': 'locked',
    'admin.users.unlock': 'Unlock',
    'admin.users.unlink': 'Unlink GitLab',
    'admin.users.unlinkConfirm': 'Unlink this GitLab account? The board account and its password stay.',
    'admin.users.lockedFor': 'after {n} failed sign-ins',
    'admin.users.status': 'Status',
    'admin.users.active': 'active',
    'admin.users.disabled': 'disabled',
    'admin.users.online': 'on the board now',
    'admin.users.lastSeen': 'Last seen',
    'admin.users.never': 'never',
    'admin.users.actions': 'Actions',
    'admin.users.copy': 'Copy',
    'admin.users.copied': 'Copied',

    'admin.ideas.text': 'Idea',
    'admin.ideas.author': 'Author',
    'admin.ideas.status': 'Status',
    'admin.ideas.created': 'Created',
    'admin.ideas.delete': 'Delete forever',
    'admin.ideas.deleteConfirm': 'Delete this idea permanently? This cannot be undone.',
    'admin.ideas.search': 'Search…',
    'admin.ideas.empty': 'No ideas yet.',

    'admin.log.when': 'When',
    'admin.log.who': 'Who',
    'admin.log.what': 'What',
    'admin.log.detail': 'Detail',
    'admin.log.all': 'All events',
    'admin.log.allUsers': 'Everyone',
    'admin.log.more': 'Load more',
    'admin.log.export': 'Export NDJSON',
    'admin.log.empty': 'Nothing logged yet.',
    'admin.log.end': 'That is the whole log.',

    'admin.stats.period': 'Period',
    'admin.stats.7': 'Last 7 days',
    'admin.stats.30': 'Last 30 days',
    'admin.stats.90': 'Last 90 days',
    'admin.stats.all': 'All time',
    'admin.stats.user': 'User',
    'admin.stats.visits': 'Visits',
    'admin.stats.time': 'Time on board',
    'admin.stats.ideas': 'Ideas added',
    'admin.stats.changes': 'Status changes',
    'admin.stats.logins': 'Sign-ins',
    'admin.stats.byStatus': 'Ideas by status',
    'admin.stats.storage': 'Log storage',
    'admin.stats.events': 'events',
    'admin.stats.visitsTotal': 'visit records',
    'admin.stats.size': 'database size',
    'admin.stats.retention': 'raw events kept for',
    'admin.stats.days': 'days',
    'admin.stats.security': 'Sign-in security',
    'admin.stats.failedLogins': 'failed sign-ins',
    'admin.stats.lockouts': 'lockouts triggered',
    'admin.stats.lockedAccounts': 'accounts locked now',
    'admin.stats.blockedSources': 'addresses blocked now',
    'admin.stats.securityNote':
      'After five wrong passwords an account waits 30s, then 1m, 2m, 4m… up to 30 minutes. Counters reset on a correct password or an hour of quiet, and you can lift a lock from the Users tab.',
    'admin.stats.retentionNote':
      'Older raw events are pruned, but the daily counts and visit records are kept forever — a dashboard built later still sees the full history.',

    'event.1': 'Signed in',
    'event.2': 'Failed sign-in',
    'event.3': 'Signed out',
    'event.4': 'Opened the board',
    'event.5': 'Locked out after failed sign-ins',
    'event.6': 'Signed in with GitLab',
    'event.7': 'GitLab account linked',
    'event.10': 'Added an idea',
    'event.11': 'Changed status',
    'event.12': 'Moved an idea',
    'event.13': 'Edited the text',
    'event.14': 'Deleted an idea',
    'event.20': 'Created a user',
    'event.21': 'Changed account access',
    'event.22': 'Reset a password',
    'event.23': 'Deleted a user',
    'event.24': 'Unlocked an account',
    'event.30': 'Pruned old log entries',

    'common.cancel': 'Cancel',
    'common.save': 'Save',
    'common.close': 'Close',
    'common.loading': 'Loading…',
    'common.error': 'Something went wrong.',
    'common.forbidden': 'Administrators only.',
    'common.h': 'h',
    'common.m': 'm',
  },

  uk: {
    'app.title': 'Дошка ідей',
    'app.tagline': 'Тут живуть ідеї команди.',
    'login.tagline.1': 'Кожна хороша колись була просто стікером.',
    'login.tagline.2': 'Погані ідеї теж потрібні — інакше хороші не знайдуться.',
    'login.tagline.3': 'Стіна, де нічого не губиться по дорозі.',
    'login.tagline.4': 'Половина з них — жах. У цьому й суть.',

    'login.email': 'Електронна пошта',
    'login.password': 'Пароль',
    'login.submit': 'Увійти',
    'login.working': 'Входимо…',
    'login.invalid': 'Невірна пошта або пароль.',
    'login.missing': 'Введіть пошту та пароль.',
    'login.throttled': 'Забагато спроб. Спробуйте через хвилину.',
    'login.locked': 'Забагато спроб. Спробуйте через {time}.',
    'login.lockedHint': 'Блокування проти підбору пароля. Адміністратор може зняти його.',
    'login.gitlab': 'Увійти через GitLab',
    'login.or': 'або',

    'sso.denied': 'Вхід через GitLab скасовано.',
    'sso.state': 'Посилання для входу застаріло. Спробуйте ще раз.',
    'sso.exchange': 'GitLab не підтвердив вхід.',
    'sso.profile': 'Не вдалося прочитати профіль GitLab.',
    'sso.inactive': 'Той обліковий запис GitLab неактивний.',
    'sso.disabled': 'Цей обліковий запис вимкнено. Зверніться до адміністратора.',
    'sso.domain': 'Цей домен пошти тут не дозволено.',
    'sso.link_taken': 'Цей GitLab уже прив’язано до іншого користувача.',
    'sso.unconfigured': 'Вхід через GitLab не налаштовано.',
    'sso.no_account': 'Жоден обліковий запис дошки не збігається з цим користувачем GitLab. Попросіть доступ в адміністратора.',
    'login.error': 'Сервер не відповідає.',
    'login.hint': 'Облікові записи видає адміністратор.',

    'board.new': 'Нова ідея',
    'board.search': 'Пошук ідей…',
    'board.empty.title': 'Дошка порожня',
    'board.empty.body': 'Подвійний клік у будь-якому місці — і з’явиться перша ідея.',
    'board.nomatch': 'Жодна ідея не підходить під фільтр.',
    'board.fit': 'Показати все',
    'board.zoomIn': 'Збільшити',
    'board.zoomOut': 'Зменшити',
    'board.reset': 'Скинути масштаб',
    'board.admin': 'Адмінка',
    'board.logout': 'Вийти',
    'board.placeholder': 'Текст ідеї…',
    'board.saveHint': 'Enter — прикріпити · Esc — скасувати',
    'board.all': 'Усі',
    'board.offline': 'Зв’язок втрачено — перепідключення…',
    'board.counter.one': 'ідея',
    'board.counter.few': 'ідеї',
    'board.counter.many': 'ідей',
    'board.help': 'Підказки',

    'menu.status': 'Статус',
    'menu.edit': 'Змінити текст',
    'menu.delete': 'Видалити назавжди',
    'menu.deleteConfirm': 'Видалити ідею назавжди? Це незворотно.',
    'menu.author': 'Додав',
    'menu.close': 'Закрити',

    'status.0': 'Нова',
    'status.1': 'Перспективна',
    'status.2': 'В роботі',
    'status.3': 'Дослідження',
    'status.4': 'На паузі',
    'status.5': 'Похована',

    'help.title': 'Підказки',
    'help.dblclick': 'Подвійний клік на порожньому місці',
    'help.dblclick.d': 'нова ідея тут',
    'help.drag': 'Перетягнути стікер',
    'help.drag.d': 'перемістити',
    'help.rotate': 'Потягнути за куточок',
    'help.rotate.d': 'нахилити',
    'help.click': 'Клік на стікері',
    'help.click.d': 'змінити статус',
    'help.pan': 'Тягти порожнє місце / скрол двома пальцями',
    'help.pan.d': 'рухати дошку',
    'help.zoom': '⌘ або Ctrl + скрол, щипок',
    'help.zoom.d': 'масштаб',
    'help.keys': 'N — нова · F — все · / — пошук · Esc — скасувати',

    'admin.title': 'Адміністрування',
    'admin.back': 'До дошки',
    'admin.tab.users': 'Користувачі',
    'admin.tab.ideas': 'Ідеї',
    'admin.tab.log': 'Журнал дій',
    'admin.tab.stats': 'Статистика',

    'admin.users.add': 'Додати користувача',
    'admin.users.email': 'Електронна пошта',
    'admin.users.name': 'Ім’я',
    'admin.users.password': 'Пароль',
    'admin.users.passwordAuto': 'порожнє — згенерується',
    'admin.users.isAdmin': 'Адміністратор',
    'admin.users.create': 'Створити',
    'admin.users.created': 'Обліковий запис створено. Скопіюйте пароль — він не зберігається.',
    'admin.users.taken': 'Така пошта вже зайнята.',
    'admin.users.badEmail': 'Це не схоже на адресу пошти.',
    'admin.users.tooShort': 'Закоротко — щонайменше 10 символів, для адміністратора 14.',
    'admin.users.common': 'Це один із перших паролів, які спробує хто завгодно.',
    'admin.users.tooSimple': 'Забагато повторів — додайте різних символів.',
    'admin.users.containsEmail': 'Не будуйте пароль з адреси пошти.',
    'admin.users.reset': 'Новий пароль',
    'admin.users.resetDone': 'Новий пароль:',
    'admin.users.disable': 'Вимкнути',
    'admin.users.enable': 'Увімкнути',
    'admin.users.delete': 'Видалити',
    'admin.users.deleteConfirm': 'Видалити обліковий запис? Їхні ідеї залишаться на дошці.',
    'admin.users.locked': 'заблоковано',
    'admin.users.unlock': 'Розблокувати',
    'admin.users.unlink': 'Відв’язати GitLab',
    'admin.users.unlinkConfirm': 'Відв’язати цей GitLab? Обліковий запис дошки і його пароль залишаться.',
    'admin.users.lockedFor': 'після {n} невдалих входів',
    'admin.users.status': 'Стан',
    'admin.users.active': 'активний',
    'admin.users.disabled': 'вимкнений',
    'admin.users.online': 'зараз на дошці',
    'admin.users.lastSeen': 'Останній візит',
    'admin.users.never': 'ніколи',
    'admin.users.actions': 'Дії',
    'admin.users.copy': 'Копіювати',
    'admin.users.copied': 'Скопійовано',

    'admin.ideas.text': 'Ідея',
    'admin.ideas.author': 'Автор',
    'admin.ideas.status': 'Статус',
    'admin.ideas.created': 'Створено',
    'admin.ideas.delete': 'Видалити назавжди',
    'admin.ideas.deleteConfirm': 'Видалити ідею назавжди? Це незворотно.',
    'admin.ideas.search': 'Пошук…',
    'admin.ideas.empty': 'Ідей ще немає.',

    'admin.log.when': 'Коли',
    'admin.log.who': 'Хто',
    'admin.log.what': 'Що',
    'admin.log.detail': 'Деталі',
    'admin.log.all': 'Усі події',
    'admin.log.allUsers': 'Усі',
    'admin.log.more': 'Ще',
    'admin.log.export': 'Експорт NDJSON',
    'admin.log.empty': 'Журнал порожній.',
    'admin.log.end': 'Це весь журнал.',

    'admin.stats.period': 'Період',
    'admin.stats.7': 'Останні 7 днів',
    'admin.stats.30': 'Останні 30 днів',
    'admin.stats.90': 'Останні 90 днів',
    'admin.stats.all': 'Увесь час',
    'admin.stats.user': 'Користувач',
    'admin.stats.visits': 'Візитів',
    'admin.stats.time': 'Час на дошці',
    'admin.stats.ideas': 'Ідей додано',
    'admin.stats.changes': 'Змін статусу',
    'admin.stats.logins': 'Входів',
    'admin.stats.byStatus': 'Ідеї за статусом',
    'admin.stats.storage': 'Обсяг журналу',
    'admin.stats.events': 'подій',
    'admin.stats.visitsTotal': 'записів про візити',
    'admin.stats.size': 'розмір бази',
    'admin.stats.retention': 'сирі події зберігаються',
    'admin.stats.days': 'днів',
    'admin.stats.security': 'Захист входу',
    'admin.stats.failedLogins': 'невдалих входів',
    'admin.stats.lockouts': 'спрацювань блокування',
    'admin.stats.lockedAccounts': 'записів заблоковано зараз',
    'admin.stats.blockedSources': 'адрес заблоковано зараз',
    'admin.stats.securityNote':
      'Після п’яти невірних паролів обліковий запис чекає 30 с, далі 1 хв, 2 хв, 4 хв… до 30 хвилин. Лічильник скидається після правильного пароля або години тиші, а зняти блокування можна у вкладці «Користувачі».',
    'admin.stats.retentionNote':
      'Старі сирі події видаляються, але денні підсумки та записи про візити зберігаються назавжди — майбутній дашборд побачить усю історію.',

    'event.1': 'Увійшов',
    'event.2': 'Невдалий вхід',
    'event.3': 'Вийшов',
    'event.4': 'Відкрив дошку',
    'event.5': 'Заблоковано після невдалих входів',
    'event.6': 'Увійшов через GitLab',
    'event.7': 'Прив’язано GitLab',
    'event.10': 'Додав ідею',
    'event.11': 'Змінив статус',
    'event.12': 'Перемістив ідею',
    'event.13': 'Змінив текст',
    'event.14': 'Видалив ідею',
    'event.20': 'Створив користувача',
    'event.21': 'Змінив доступ',
    'event.22': 'Скинув пароль',
    'event.23': 'Видалив користувача',
    'event.24': 'Розблокував обліковий запис',
    'event.30': 'Очищення старих записів',

    'common.cancel': 'Скасувати',
    'common.save': 'Зберегти',
    'common.close': 'Закрити',
    'common.loading': 'Завантаження…',
    'common.error': 'Щось пішло не так.',
    'common.forbidden': 'Лише для адміністратора.',
    'common.h': 'год',
    'common.m': 'хв',
  },
} as const;

export type Key = keyof (typeof DICT)['en'];

const STORAGE_KEY = 'ib.lang';

function detect(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'en' || saved === 'uk') return saved;
  } catch { /* private mode */ }
  return navigator.language?.toLowerCase().startsWith('uk') ? 'uk' : 'en';
}

let current: Lang = detect();
const listeners = new Set<() => void>();

export function lang(): Lang {
  return current;
}

export function setLang(next: Lang): void {
  if (next === current) return;
  current = next;
  try { localStorage.setItem(STORAGE_KEY, next); } catch { /* private mode */ }
  document.documentElement.lang = next;
  for (const fn of listeners) fn();
}

export function onLangChange(fn: () => void): void {
  listeners.add(fn);
}

/** `t` with `{placeholder}` substitution — only the countdown and a couple of counts need it. */
export function tf(key: Key, vars: Record<string, string | number>): string {
  return t(key).replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole);
}

export function t(key: Key): string {
  return DICT[current][key] ?? DICT.en[key] ?? key;
}

/**
 * Plural form of "idea" for a count. English needs two forms, Ukrainian three
 * (1 ідея / 2-4 ідеї / 5+ ідей, with the usual teens exception), and the board
 * counter is prominent enough that getting it wrong is noticeable.
 */
export function ideasWord(count: number): string {
  if (current === 'en') return t(count === 1 ? 'board.counter.one' : 'board.counter.few');
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return t('board.counter.one');
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return t('board.counter.few');
  return t('board.counter.many');
}

/** Dates are the only place we lean on the platform's formatter. */
export function formatDateTime(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString(current === 'uk' ? 'uk-UA' : 'en-GB', {
    year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

/** mm:ss for a live countdown; the lockout is never longer than 30 minutes. */
export function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `0${t('common.m')}`;
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h > 0 ? `${h}${t('common.h')} ${m}${t('common.m')}` : `${m}${t('common.m')}`;
}

document.documentElement.lang = current;
