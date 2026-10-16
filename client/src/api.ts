import type { BoardSnapshot, Idea, Me } from './types';

/**
 * Random per-tab id sent with every mutating call and echoed back on the SSE
 * stream, so the tab that made a change ignores its own broadcast instead of
 * re-applying it on top of the local (already correct) state.
 */
export const ORIGIN_ID = Math.random().toString(36).slice(2) + Date.now().toString(36);

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    /** Seconds to wait, from a 429. Lets the form count down instead of guessing. */
    readonly retryAfter = 0,
  ) {
    super(code);
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined
      ? { 'X-Origin-Id': ORIGIN_ID }
      : { 'Content-Type': 'application/json', 'X-Origin-Id': ORIGIN_ID },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  });

  if (!res.ok) {
    let code = `http_${res.status}`;
    // The header is the fallback: the built-in rate limiter sets it without a body.
    let retryAfter = Number(res.headers.get('Retry-After')) || 0;
    try {
      const payload = await res.json() as { error?: string; retryAfter?: number };
      if (payload?.error) code = payload.error;
      if (payload?.retryAfter) retryAfter = payload.retryAfter;
    } catch { /* non-JSON error page */ }
    throw new ApiError(res.status, code, retryAfter);
  }

  return res.status === 204 ? (undefined as T) : await res.json() as T;
}

export const api = {
  me: () => request<Me>('GET', '/api/auth/me'),
  providers: () => request<{ gitlab: boolean }>('GET', '/api/auth/providers'),
  login: (email: string, password: string) => request<Me>('POST', '/api/auth/login', { email, password }),
  logout: () => request<{ ok: true }>('POST', '/api/auth/logout'),

  board: () => request<BoardSnapshot>('GET', '/api/board'),
  beat: () => request<{ ok: true }>('POST', '/api/board/beat'),

  createIdea: (text: string, x: number, y: number, angle: number) =>
    request<Idea>('POST', '/api/ideas', { text, x, y, angle }),
  setStatus: (id: number, status: number) =>
    request<Idea>('PATCH', `/api/ideas/${id}/status`, { status }),
  setPosition: (id: number, x: number, y: number, angle: number) =>
    request<{ ok: true }>('PATCH', `/api/ideas/${id}/position`, { x, y, angle }),
  setText: (id: number, text: string) =>
    request<Idea>('PATCH', `/api/ideas/${id}/text`, { text }),
  deleteIdea: (id: number) => request<{ ok: true }>('DELETE', `/api/ideas/${id}`),
};

export interface AdminUser {
  id: number;
  email: string;
  name: string;
  isAdmin: boolean;
  isActive: boolean;
  createdAt: number;
  lastSeenAt: number | null;
  online: boolean;
  /** GitLab handle when the account is linked to SSO. */
  gitlab: string | null;
  lockedUntil: number | null;
  failedAttempts: number;
}

export interface LogEvent {
  id: number;
  ts: number;
  kind: number;
  userId: number | null;
  user: string | null;
  ideaId: number | null;
  idea: string | null;
  a: number | null;
  b: number | null;
  meta: string | null;
}

export interface UserActivity {
  userId: number;
  email: string;
  name: string;
  lastSeenAt: number | null;
  visits: number;
  secondsOnBoard: number;
  ideasCreated: number;
  statusChanges: number;
  logins: number;
}

export interface Stats {
  users: UserActivity[];
  ideasByStatus: Record<string, number>;
  daily: { day: number; kind: number; count: number }[];
  storage: {
    events: number;
    visits: number;
    bytes: number;
    oldestEventTs: number | null;
    retentionDays: number;
  };
  security: {
    failedLogins: number;
    lockouts: number;
    lockedAccounts: number;
    blockedSources: number;
  };
}

export const adminApi = {
  users: () => request<AdminUser[]>('GET', '/api/admin/users'),
  createUser: (email: string, password: string, name: string, isAdmin: boolean) =>
    request<AdminUser & { password: string }>('POST', '/api/admin/users', { email, password, name, isAdmin }),
  resetPassword: (id: number, password: string) =>
    request<{ ok: true; password: string }>('POST', `/api/admin/users/${id}/password`, { password }),
  setActive: (id: number, active: boolean) =>
    request<{ ok: true }>('POST', `/api/admin/users/${id}/active`, { active }),
  deleteUser: (id: number) => request<{ ok: true }>('DELETE', `/api/admin/users/${id}`),
  unlockUser: (id: number) => request<{ ok: true }>('POST', `/api/admin/users/${id}/unlock`),
  unlinkGitLab: (id: number) => request<{ ok: true }>('POST', `/api/admin/users/${id}/unlink-gitlab`),

  ideas: () => request<Idea[]>('GET', '/api/admin/ideas'),

  events: (params: { kind?: number; userId?: number; before?: number; limit?: number }) => {
    const q = new URLSearchParams();
    if (params.kind !== undefined) q.set('kind', String(params.kind));
    if (params.userId !== undefined) q.set('userId', String(params.userId));
    if (params.before !== undefined) q.set('before', String(params.before));
    q.set('limit', String(params.limit ?? 100));
    return request<{ events: LogEvent[]; nextBefore: number | null }>('GET', `/api/admin/events?${q}`);
  },

  stats: (since?: number, days = 30) => {
    const q = new URLSearchParams({ days: String(days) });
    if (since !== undefined) q.set('since', String(since));
    return request<Stats>('GET', `/api/admin/stats?${q}`);
  },
};
