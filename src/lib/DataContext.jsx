import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import * as api from './api';
import * as demo from './demo';

const Ctx = createContext(null);
export const useData = () => useContext(Ctx);

const POLL_MS = 3000;

export function DataProvider({ children }) {
  const live = api.isLive;
  const [state, setState] = useState(() => (live ? null : demo.seed()));
  const [error, setError] = useState(null); // set while the last refresh failed
  const [toasts, setToasts] = useState([]);
  const pausedRef = useRef(false);
  const inflight = useRef(false);

  const toast = useCallback((message, tone = 'ok') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t.slice(-3), { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'err' ? 6000 : 3500);
  }, []);

  const refresh = useCallback(async () => {
    if (inflight.current) return;
    inflight.current = true;
    try {
      const snap = await api.snapshot();
      setState(snap);
      setError(null);
    } catch (e) {
      if (e.status !== 401) setError(e.message);
    } finally {
      inflight.current = false;
    }
  }, []);

  useEffect(() => {
    if (live) {
      refresh();
      const t = setInterval(() => { if (!document.hidden) refresh(); }, POLL_MS);
      const onVisible = () => { if (!document.hidden) refresh(); };
      document.addEventListener('visibilitychange', onVisible);
      return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVisible); };
    }
    const a = setInterval(() => setState((s) => demo.jitter(s)), 2200);
    const b = setInterval(() => setState((s) => (pausedRef.current ? s : demo.randomEvent(s))), 11000);
    return () => { clearInterval(a); clearInterval(b); };
  }, [live, refresh]);

  useEffect(() => { pausedRef.current = !!state?.copier?.paused; }, [state?.copier?.paused]);

  // One place for every change: call the API then refresh (live), or edit local state (demo).
  const act = useCallback(
    async (liveFn, demoFn, okMessage) => {
      try {
        let result;
        if (live) {
          result = await liveFn();
          refresh();
        } else {
          setState((s) => demoFn(s, (r) => (result = r)));
        }
        if (okMessage) toast(typeof okMessage === 'function' ? okMessage(result) : okMessage);
        return result ?? true;
      } catch (e) {
        if (e.status !== 401) toast(e.message, 'err');
        return false;
      }
    },
    [live, refresh, toast]
  );

  const patchAccount = (id, patch) => (s) => ({ ...s, accounts: s.accounts.map((a) => (a.id === id ? { ...a, ...patch } : a)) });

  const actions = useMemo(
    () => ({
      refresh,
      setPaused: (paused) =>
        act(() => api.setCopierPaused(paused), (s) => ({ ...s, copier: { ...s.copier, paused } }), paused ? 'Copying paused' : 'Copying resumed'),

      saveLink: (link) =>
        act(
          () => api.saveLink(link),
          (s) => ({
            ...s,
            links: link.id
              ? s.links.map((l) => (l.id === link.id ? { ...l, ...link } : l))
              : [...s.links, { ...link, id: demo.nextLocalId(), active: link.active ?? true }],
          }),
          link.id ? 'Link saved' : 'Link created'
        ),
      toggleLink: (link) =>
        act(
          () => api.saveLink({ id: link.id, active: !link.active }),
          (s) => ({ ...s, links: s.links.map((l) => (l.id === link.id ? { ...l, active: !l.active } : l)) }),
          link.active ? 'Link paused' : 'Link resumed'
        ),
      removeLink: (id) => act(() => api.removeLink(id), (s) => ({ ...s, links: s.links.filter((l) => l.id !== id) }), 'Link removed'),

      closePosition: (ticket) => act(() => api.closePosition(ticket), (s) => demo.closeByTicket(s, ticket), 'Close order sent'),
      closeAll: (accountId) => act(() => api.closeAll(accountId), (s) => demo.closeAllLocal(s, accountId), 'Close orders sent'),
      placeOrder: (order) =>
        act(
          () => api.placeOrder(order),
          (s) => demo.openManual(s, order),
          (r) => {
            if (!r || r === true) return 'Order sent';
            const via = r.copied_via_link?.length ?? 0;
            const direct = `${r.sent} account${r.sent === 1 ? '' : 's'}`;
            return via ? `Order sent to ${direct}. ${via} follower${via === 1 ? '' : 's'} will copy it from the master.` : `Order sent to ${direct}`;
          }
        ),

      saveGuards: (id, g) => act(() => api.saveGuards(id, g), (s) => ({ ...s, guards: { ...s.guards, [id]: g } }), 'Limits saved'),

      setAccountPaused: (acc) =>
        act(() => api.setAccountPaused(acc.id, !acc.paused), patchAccount(acc.id, { paused: !acc.paused }), acc.paused ? `${acc.name} resumed` : `${acc.name} paused`),
      setKillSwitch: (acc, on) =>
        act(() => api.setKillSwitch(acc.id, on), patchAccount(acc.id, { kill_switch: on }), on ? `Kill switch on for ${acc.name}` : `Kill switch off for ${acc.name}`),
      updateAccount: (acc, patch) =>
        act(() => api.updateAccount(acc.id, patch), patchAccount(acc.id, patch), 'Account updated'),
      removeAccount: (acc) =>
        act(
          () => api.removeAccount(acc.id),
          (s) => ({
            ...s,
            accounts: s.accounts.filter((a) => a.id !== acc.id),
            links: s.links.filter((l) => l.slave_id !== acc.id && l.master_id !== acc.id),
            positions: s.positions.filter((p) => p.account_id !== acc.id),
          }),
          `${acc.name} removed`
        ),

      // Return { account, token } so the UI can show the EA token once.
      addAccount: async (form) => {
        try {
          if (live) {
            const res = await api.createAccount(form);
            refresh();
            return res;
          }
          const account = { id: demo.nextLocalId(), ...form, kill_switch: false, status: 'offline', paused: false, balance: 0, equity: 0, last_seen_at: null };
          setState((s) => ({
            ...s,
            accounts: [...s.accounts, account],
            guards: account.role === 'slave' ? { ...s.guards, [account.id]: { ...demo.DEFAULT_GUARDS } } : s.guards,
          }));
          return { account, token: demo.newToken() };
        } catch (e) {
          if (e.status !== 401) toast(e.message, 'err');
          return null;
        }
      },
      regenerateToken: async (acc) => {
        try {
          return (live ? await api.regenerateToken(acc.id) : { token: demo.newToken() }).token;
        } catch (e) {
          if (e.status !== 401) toast(e.message, 'err');
          return null;
        }
      },
    }),
    [act, live, refresh, toast]
  );

  const derived = useMemo(() => (state ? summarize(state) : null), [state]);

  if (!state) {
    return (
      <div className="boot" role="status">
        {error ? (
          <>
            <p>Can't reach the server.</p>
            <p className="muted">{error}</p>
            <button className="btn" onClick={refresh}>Try again</button>
          </>
        ) : (
          <p>Loading your accounts…</p>
        )}
      </div>
    );
  }
  return <Ctx.Provider value={{ state, derived, error, toasts, toast, actions, live }}>{children}</Ctx.Provider>;
}

function summarize(s) {
  const followers = s.accounts.filter((a) => a.role === 'slave');
  const live = followers.filter((a) => a.status === 'online' && !a.paused && !a.kill_switch);
  const lat = s.events
    .slice(0, 20)
    .flatMap((e) => e.results.filter((r) => r.status === 'executed' && r.latency_ms > 0).map((r) => r.latency_ms))
    .sort((a, b) => a - b);
  return {
    totalEquity: s.accounts.reduce((t, a) => t + (a.equity || 0), 0),
    totalBalance: s.accounts.reduce((t, a) => t + (a.balance || 0), 0),
    openPL: s.positions.reduce((t, p) => t + (p.profit || 0), 0),
    openCount: s.positions.length,
    followers: followers.length,
    synced: live.length,
    medianLatency: lat.length ? lat[Math.floor(lat.length / 2)] : null,
    master: s.accounts.find((a) => a.role === 'master') ?? null,
  };
}

export const accountName = (state, id) => state.accounts.find((a) => a.id === id)?.name ?? 'Removed account';
