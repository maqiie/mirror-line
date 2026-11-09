// Thin client for the Rails API. Every call carries the dashboard user's bearer token.
// Function names are the contract used by src/contract.test.js, keep them stable.

const BASE = import.meta.env.VITE_API_URL || '';
export const isLive = import.meta.env.VITE_LIVE === 'true';

const KEY = 'mirrorline.token';
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* storage blocked */ } },
};

export const getToken = () => store.get(KEY);
export const setToken = (t) => store.set(KEY, t);
export const apiOrigin = () => BASE || window.location.origin;

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function req(path, { method = 'GET', body, auth = true } = {}) {
  let res;
  try {
    res = await fetch(BASE + path, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(auth && getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError("Can't reach the server. Check that the API is running.", 0);
  }

  if (res.status === 401 && auth) {
    setToken(null);
    try { sessionStorage.setItem('mirrorline.notice', 'Your session ended. Sign in again.'); } catch { /* ignore */ }
    if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) window.location.assign('/login');
    throw new ApiError('Your session ended. Sign in again.', 401);
  }

  if (!res.ok) {
    let msg = res.statusText || `Request failed (${res.status})`;
    try {
      const j = await res.json();
      msg = j.error || (Array.isArray(j.errors) ? j.errors.join(', ') : msg);
    } catch { /* body was not JSON */ }
    throw new ApiError(msg, res.status);
  }
  return res.status === 204 ? null : res.json();
}

// ---- session ----
export const login = (email, password) => req('/api/v1/session', { method: 'POST', body: { email, password }, auth: false }); // -> { token, expires_in, user }

// ---- the snapshot the app polls: { accounts, links, positions, events, equity, guards, copier, market } ----
export const snapshot = () => req('/api/v1/dashboard');

// ---- accounts ----
export const createAccount = (b) => req('/api/v1/trading_accounts', { method: 'POST', body: b }); // -> { account, token } (token shown once)
export const updateAccount = (id, patch) => req(`/api/v1/trading_accounts/${id}`, { method: 'PATCH', body: patch }); // name, broker, server, paused, kill_switch
export const setAccountPaused = (id, paused) => updateAccount(id, { paused });
export const setKillSwitch = (id, kill_switch) => updateAccount(id, { kill_switch });
export const removeAccount = (id) => req(`/api/v1/trading_accounts/${id}`, { method: 'DELETE' });
export const regenerateToken = (id) => req(`/api/v1/trading_accounts/${id}/regenerate_token`, { method: 'POST' }); // -> { token }
export const saveGuards = (id, g) => req(`/api/v1/trading_accounts/${id}/guards`, { method: 'PUT', body: g });

// ---- copy links ----
export const saveLink = (l) =>
  l.id ? req(`/api/v1/copy_links/${l.id}`, { method: 'PATCH', body: l }) : req('/api/v1/copy_links', { method: 'POST', body: l });
export const removeLink = (id) => req(`/api/v1/copy_links/${id}`, { method: 'DELETE' });

// ---- trading ----
export const closePosition = (ticket) => req(`/api/v1/positions/${ticket}/close`, { method: 'POST' });
export const closeAll = (accountId) => req('/api/v1/positions/close_all', { method: 'POST', body: { account_id: accountId ?? null } });
export const placeOrder = (b) => req('/api/v1/orders', { method: 'POST', body: b }); // -> { sent, copied_via_link, commands }
export const setCopierPaused = (paused) => req('/api/v1/copier', { method: 'PUT', body: { paused } });

// ---- activity log (not part of the snapshot) ----
const qs = (o) => {
  const p = new URLSearchParams(Object.entries(o).filter(([, v]) => v != null && v !== ''));
  return p.toString() ? `?${p}` : '';
};
export const auditCommands = (q = {}) => req(`/api/v1/audit/commands${qs(q)}`); // { status, account_id, limit }
