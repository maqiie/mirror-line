// Thin client for the Rails API. Existing trading exports remain stable.

const BASE = import.meta.env.VITE_API_URL || '';
export const isLive = import.meta.env.VITE_LIVE === 'true';

const KEY = 'mirrorline.token';
const REFRESH_KEY = 'mirrorline.refresh_token';

const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => {
    try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); }
    catch { /* storage blocked */ }
  },
};

export const getToken = () => store.get(KEY);
export const setToken = (t) => store.set(KEY, t);
export const getRefreshToken = () => store.get(REFRESH_KEY);
export const setRefreshToken = (t) => store.set(REFRESH_KEY, t);
export const clearTokens = () => {
  setToken(null);
  setRefreshToken(null);
};
export const apiOrigin = () => BASE || window.location.origin;

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function readError(res) {
  let msg = res.statusText || `Request failed (${res.status})`;
  try {
    const j = await res.json();
    msg = j.error || (Array.isArray(j.errors) ? j.errors.join(', ') : msg);
  } catch { /* response was not JSON */ }
  return new ApiError(msg, res.status);
}

async function rawRequest(path, { method = 'GET', body, token } = {}) {
  let res;
  try {
    res = await fetch(BASE + path, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError("Can't reach the server. Check that the API is running.", 0);
  }
  return res;
}

let refreshInFlight = null;

async function rotateSession() {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    const refreshToken = getRefreshToken();
    if (!refreshToken) throw new ApiError('Your session ended. Sign in again.', 401);

    const res = await rawRequest('/api/v1/auth/refresh', {
      method: 'POST',
      body: { refresh_token: refreshToken },
    });

    if (!res.ok) throw await readError(res);

    const data = await res.json();
    if (!data.token || !data.refresh_token) {
      throw new ApiError('The server returned an invalid refreshed session.', 401);
    }

    setToken(data.token);
    setRefreshToken(data.refresh_token);
    return data.token;
  })();

  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

function endSession() {
  clearTokens();
  try {
    sessionStorage.setItem('mirrorline.notice', 'Your session ended. Sign in again.');
  } catch { /* ignore */ }

  if (
    typeof window !== 'undefined' &&
    !['/login', '/welcome', '/register', '/verify-email', '/resend-verification', '/forgot-password', '/reset-password'].includes(window.location.pathname)
  ) {
    window.location.assign('/login');
  }
}

async function req(path, { method = 'GET', body, auth = true } = {}) {
  const tokenUsed = auth ? getToken() : null;
  let res = await rawRequest(path, { method, body, token: tokenUsed });

  if (res.status === 401 && auth) {
    // If another request already rotated the token, retry with that token.
    let currentToken = getToken();

    if (currentToken && currentToken !== tokenUsed) {
      res = await rawRequest(path, { method, body, token: currentToken });
    } else if (currentToken === 'demo' && !isLive) {
      throw await readError(res);
    } else if (getRefreshToken()) {
      try {
        currentToken = await rotateSession();
        res = await rawRequest(path, { method, body, token: currentToken });
      } catch (error) {
        endSession();
        throw new ApiError('Your session ended. Sign in again.', 401);
      }
    } else {
      endSession();
      throw new ApiError('Your session ended. Sign in again.', 401);
    }

    if (res.status === 401) {
      endSession();
      throw new ApiError('Your session ended. Sign in again.', 401);
    }
  }

  if (!res.ok) throw await readError(res);
  return res.status === 204 ? null : res.json();
}

// ---- authentication ----
export const login = (email, password) =>
  req('/api/v1/session', { method: 'POST', body: { email, password }, auth: false });

export const register = (email, password) =>
  req('/api/v1/auth/register', { method: 'POST', body: { email, password }, auth: false });

export const verifyEmail = (token) =>
  req(`/api/v1/auth/verify-email?token=${encodeURIComponent(token)}`, { auth: false });

export const resendVerification = (email) =>
  req('/api/v1/auth/verification/resend', { method: 'POST', body: { email }, auth: false });

export const forgotPassword = (email) =>
  req('/api/v1/auth/password/forgot', { method: 'POST', body: { email }, auth: false });

export const resetPassword = (token, newPassword, passwordConfirmation) =>
  req('/api/v1/auth/password/reset', {
    method: 'POST',
    body: {
      token,
      new_password: newPassword,
      password_confirmation: passwordConfirmation,
    },
    auth: false,
  });

export const getSessions = () => req('/api/v1/sessions');

export const revokeSession = (id) =>
  req(`/api/v1/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });

export const revokeAllSessions = () =>
  req('/api/v1/sessions', { method: 'DELETE' });

export const changePassword = (currentPassword, newPassword, passwordConfirmation) =>
  req('/api/v1/password/change', {
    method: 'PATCH',
    body: {
      current_password: currentPassword,
      new_password: newPassword,
      password_confirmation: passwordConfirmation,
    },
  });

export async function logout() {
  try {
    return await req('/api/v1/session', { method: 'DELETE' });
  } finally {
    clearTokens();
  }
}

// ---- dashboard snapshot ----
export const snapshot = () => req('/api/v1/dashboard');

// ---- accounts ----
export const createAccount = (b) => req('/api/v1/trading_accounts', { method: 'POST', body: b });
export const updateAccount = (id, patch) => req(`/api/v1/trading_accounts/${id}`, { method: 'PATCH', body: patch });
export const setAccountPaused = (id, paused) => updateAccount(id, { paused });
export const setKillSwitch = (id, kill_switch) => updateAccount(id, { kill_switch });
export const removeAccount = (id) => req(`/api/v1/trading_accounts/${id}`, { method: 'DELETE' });
export const regenerateToken = (id) => req(`/api/v1/trading_accounts/${id}/regenerate_token`, { method: 'POST' });
export const saveGuards = (id, g) => req(`/api/v1/trading_accounts/${id}/guards`, { method: 'PUT', body: g });

// ---- copy links ----
export const saveLink = (l) =>
  l.id ? req(`/api/v1/copy_links/${l.id}`, { method: 'PATCH', body: l }) : req('/api/v1/copy_links', { method: 'POST', body: l });
export const removeLink = (id) => req(`/api/v1/copy_links/${id}`, { method: 'DELETE' });

// ---- trading ----
export const closePosition = (ticket) => req(`/api/v1/positions/${ticket}/close`, { method: 'POST' });
export const closeAll = (accountId) => req('/api/v1/positions/close_all', { method: 'POST', body: { account_id: accountId ?? null } });
export const placeOrder = (b) => req('/api/v1/orders', { method: 'POST', body: b });
export const setCopierPaused = (paused) => req('/api/v1/copier', { method: 'PUT', body: { paused } });

// ---- activity log ----
const qs = (o) => {
  const p = new URLSearchParams(Object.entries(o).filter(([, v]) => v != null && v !== ''));
  return p.toString() ? `?${p}` : '';
};
export const auditCommands = (q = {}) => req(`/api/v1/audit/commands${qs(q)}`);
