// Demo data + a tiny market/copier simulator, so the app is fully explorable without a backend.
import { SYMBOLS, lotFor } from './format';

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const r2 = (x) => Math.round(x * 100) / 100;
let seq = 9000;
const nextId = () => ++seq;
const iso = (msAgo = 0) => new Date(Date.now() - msAgo).toISOString();

function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const DEFAULT_GUARDS = { max_lot: 5, max_open: 10, daily_loss_pct: 5, min_margin_level: 150, max_spread: 30 };

const profitOf = (p, market) =>
  r2((market[p.symbol] - p.open_price) * (p.side === 'buy' ? 1 : -1) * p.volume * SYMBOLS[p.symbol].contract);

function recompute(s) {
  const positions = s.positions.map((p) => ({ ...p, price: s.market[p.symbol], profit: profitOf(p, s.market) }));
  const accounts = s.accounts.map((a) => {
    const open = positions.filter((p) => p.account_id === a.id).reduce((t, p) => t + p.profit, 0);
    return { ...a, equity: r2(a.balance + open) };
  });
  return { ...s, positions, accounts };
}

function equitySeries(endValue) {
  const rand = mulberry32(42);
  const pts = [];
  let v = endValue * 0.84;
  for (let i = 89; i >= 0; i--) {
    v += (rand() - 0.42) * endValue * 0.012;
    pts.push({ t: Date.now() - i * 86400000, v });
  }
  const k = endValue / pts[pts.length - 1].v;
  return pts.map((p) => ({ ...p, v: r2(p.v * k) }));
}

export function seed() {
  const market = Object.fromEntries(Object.entries(SYMBOLS).map(([k, v]) => [k, v.price]));
  const accounts = [
    { id: 1, name: 'Main master', platform: 'mt5', login: '51872304', broker: 'Exness', server: 'Exness-MT5Real8', role: 'master', kill_switch: false, status: 'online', paused: false, balance: 25840.22, equity: 25840.22, last_seen_at: iso(1200) },
    { id: 2, name: 'Alpha follower', platform: 'mt5', login: '51990127', broker: 'Exness', server: 'Exness-MT5Real8', role: 'slave', kill_switch: false, status: 'online', paused: false, balance: 12910.5, equity: 12910.5, last_seen_at: iso(900) },
    { id: 3, name: 'Scalp account', platform: 'mt4', login: '8841932', broker: 'IC Markets', server: 'ICMarketsSC-Live07', role: 'slave', kill_switch: false, status: 'online', paused: false, balance: 5400, equity: 5400, last_seen_at: iso(2100) },
    { id: 4, name: 'Safe growth', platform: 'mt5', login: '70031845', broker: 'Pepperstone', server: 'Pepperstone-Edge12', role: 'slave', kill_switch: false, status: 'online', paused: false, balance: 48200, equity: 48200, last_seen_at: iso(1500) },
    { id: 5, name: 'Demo sandbox', platform: 'mt4', login: '5021177', broker: 'Exness', server: 'Exness-Trial4', role: 'slave', kill_switch: false, status: 'offline', paused: true, balance: 100000, equity: 100000, last_seen_at: iso(3 * 3600000) },
  ];
  const links = [
    { id: 1, master_id: 1, slave_id: 2, lot_mode: 'multiplier', lot_value: 0.5, reverse: false, max_slippage: 20, symbol_suffix: '', copy_pending: true, copy_missed_opens: false, symbols: [], active: true },
    { id: 2, master_id: 1, slave_id: 3, lot_mode: 'fixed', lot_value: 0.1, reverse: false, max_slippage: 15, symbol_suffix: '.m', copy_pending: true, copy_missed_opens: false, symbols: [], active: true },
    { id: 3, master_id: 1, slave_id: 4, lot_mode: 'balance_ratio', lot_value: 1, reverse: false, max_slippage: 30, symbol_suffix: '', copy_pending: true, copy_missed_opens: false, symbols: [], active: true },
    { id: 4, master_id: 1, slave_id: 5, lot_mode: 'multiplier', lot_value: 2, reverse: true, max_slippage: 25, symbol_suffix: '', copy_pending: true, copy_missed_opens: false, symbols: [], active: false },
  ];
  const guards = Object.fromEntries(accounts.filter((a) => a.role === 'slave').map((a) => [a.id, { ...DEFAULT_GUARDS }]));

  let s = { accounts, links, market, guards, positions: [], events: [], copier: { paused: false } };
  const masterTrades = [
    { symbol: 'EURUSD', side: 'buy', volume: 1.0, open: 1.0821, sl: 1.0785, tp: 1.0912 },
    { symbol: 'XAUUSD', side: 'sell', volume: 0.5, open: 2661.2, sl: 2674.0, tp: 2630.0 },
    { symbol: 'GBPUSD', side: 'buy', volume: 0.8, open: 1.2918, sl: 1.2870, tp: 1.3020 },
  ];
  masterTrades.forEach((t) => {
    s = openOnMaster(s, t, { open_price: t.open, silent: true });
  });
  s.events = [
    mkEvent(s, 'open', 'EURUSD', 'buy', 1.0, 3 * 60000),
    mkEvent(s, 'close', 'USDJPY', 'sell', 0.6, 22 * 60000, 184.6),
    mkEvent(s, 'modify', 'XAUUSD', 'sell', 0.5, 41 * 60000),
    mkEvent(s, 'open', 'US30', 'buy', 0.2, 95 * 60000),
  ];
  s.equity = equitySeries(s.accounts.reduce((t, a) => t + a.balance, 0));
  return recompute(s);
}

function copyTargets(s) {
  return s.links.filter((l) => l.active && !s.copier.paused).map((l) => ({ link: l, slave: s.accounts.find((a) => a.id === l.slave_id) }));
}

function results(s, masterLot, forceSkipSpread = false) {
  const master = s.accounts.find((a) => a.role === 'master');
  return s.links.map((link) => {
    const slave = s.accounts.find((a) => a.id === link.slave_id);
    const base = { slave_id: slave.id, volume: lotFor(link, masterLot, master, slave) };
    if (!link.active || s.copier.paused) return { ...base, status: 'skipped', latency_ms: 0, note: s.copier.paused ? 'Copying is paused' : 'Link is paused' };
    if (slave.paused || slave.status === 'offline') return { ...base, status: 'skipped', latency_ms: 0, note: 'Account is offline' };
    if (forceSkipSpread || Math.random() < 0.06) return { ...base, status: 'skipped', latency_ms: Math.round(rnd(60, 120)), note: 'Spread too wide' };
    return { ...base, status: 'executed', latency_ms: Math.round(rnd(38, 190)), note: '' };
  });
}

function mkEvent(s, type, symbol, side, volume, msAgo = 0, profit = null) {
  const res = results(s, volume).map((r) => ({ ...r, latency_ms: r.latency_ms }));
  return { id: nextId(), type, symbol, side, volume, at: iso(msAgo), profit, source: 'master', results: res };
}

function openOnMaster(s, t, { open_price, silent = false } = {}) {
  const master = s.accounts.find((a) => a.role === 'master');
  const ticket = nextId() + 7000000;
  const op = open_price ?? s.market[t.symbol];
  const base = { symbol: t.symbol, side: t.side, open_price: op, sl: t.sl ?? null, tp: t.tp ?? null, opened_at: iso(rnd(60000, 7200000)) };
  const res = results(s, t.volume);
  const mirrored = res
    .filter((r) => r.status === 'executed')
    .map((r) => ({ ...base, ticket: nextId() + 7000000, account_id: r.slave_id, master_ticket: ticket, volume: r.volume, side: s.links.find((l) => l.slave_id === r.slave_id).reverse ? (t.side === 'buy' ? 'sell' : 'buy') : t.side }));
  const next = { ...s, positions: [...s.positions, { ...base, ticket, account_id: master.id, master_ticket: null, volume: t.volume }, ...mirrored] };
  if (!silent) next.events = [{ id: nextId(), type: 'open', symbol: t.symbol, side: t.side, volume: t.volume, at: iso(), profit: null, source: 'master', results: res }, ...s.events].slice(0, 60);
  return next;
}

export function jitter(s) {
  const market = { ...s.market };
  Object.entries(SYMBOLS).forEach(([k, m]) => {
    market[k] = Number((market[k] + rnd(-3.2, 3.2) * m.step).toFixed(m.dp));
  });
  const next = recompute({ ...s, market });
  const now = Date.now();
  next.accounts = next.accounts.map((a) => (a.status === 'online' && !a.paused ? { ...a, last_seen_at: new Date(now - rnd(200, 2400)).toISOString() } : a));
  return next;
}

export function randomEvent(s) {
  if (s.copier.paused) return s;
  const master = s.accounts.find((a) => a.role === 'master');
  const open = s.positions.filter((p) => p.account_id === master.id);
  if (open.length < 5 && (open.length < 2 || Math.random() < 0.6)) {
    const symbol = pick(Object.keys(SYMBOLS));
    const side = pick(['buy', 'sell']);
    const m = SYMBOLS[symbol];
    const dir = side === 'buy' ? 1 : -1;
    const t = { symbol, side, volume: pick([0.2, 0.5, 0.8, 1.0, 1.5]), sl: Number((s.market[symbol] - dir * m.step * 40).toFixed(m.dp)), tp: Number((s.market[symbol] + dir * m.step * 80).toFixed(m.dp)) };
    return recompute(openOnMaster(s, t));
  }
  return closeByTicket(s, pick(open).ticket);
}

export function closeByTicket(s, ticket) {
  const pos = s.positions.find((p) => p.ticket === ticket);
  if (!pos) return s;
  const master = s.accounts.find((a) => a.role === 'master');
  const closing = pos.account_id === master.id ? s.positions.filter((p) => p.ticket === ticket || p.master_ticket === ticket) : [pos];
  const ids = new Set(closing.map((p) => p.ticket));
  const profit = closing.find((p) => p.account_id === pos.account_id).profit;
  const ev = { id: nextId(), type: 'close', symbol: pos.symbol, side: pos.side, volume: pos.volume, at: iso(), profit, source: pos.account_id === master.id ? 'master' : 'dashboard', account_id: pos.account_id, results: closing.filter((p) => p.account_id !== pos.account_id).map((p) => ({ slave_id: p.account_id, volume: p.volume, status: 'executed', latency_ms: Math.round(rnd(35, 170)), note: '' })) };
  const accounts = s.accounts.map((a) => {
    const realised = closing.filter((p) => p.account_id === a.id).reduce((t, p) => t + p.profit, 0);
    return realised ? { ...a, balance: r2(a.balance + realised) } : a;
  });
  return recompute({ ...s, accounts, positions: s.positions.filter((p) => !ids.has(p.ticket)), events: [ev, ...s.events].slice(0, 60) });
}

export function closeAllLocal(s, accountId) {
  let next = s;
  const targets = s.positions.filter((p) => (accountId ? p.account_id === accountId : true) && p.master_ticket == null);
  targets.forEach((p) => {
    next = closeByTicket(next, p.ticket);
  });
  if (accountId) {
    next.positions.filter((p) => p.account_id === accountId).forEach((p) => {
      next = closeByTicket(next, p.ticket);
    });
  }
  return next;
}

export function openManual(s, { account_ids, symbol, side, volume, sl, tp }) {
  const op = s.market[symbol];
  const added = account_ids.map((id) => ({ ticket: nextId() + 7000000, account_id: id, master_ticket: null, symbol, side, volume, open_price: op, price: op, sl: sl || null, tp: tp || null, profit: 0, opened_at: iso() }));
  const ev = { id: nextId(), type: 'open', symbol, side, volume, at: iso(), profit: null, source: 'dashboard', results: account_ids.map((id) => ({ slave_id: id, volume, status: 'executed', latency_ms: Math.round(rnd(40, 160)), note: '' })) };
  return recompute({ ...s, positions: [...s.positions, ...added], events: [ev, ...s.events].slice(0, 60) });
}

export function summary(s) {
  const followers = s.accounts.filter((a) => a.role === 'slave');
  const online = followers.filter((a) => a.status === 'online' && !a.paused);
  const lat = s.events.slice(0, 20).flatMap((e) => e.results.filter((r) => r.status === 'executed').map((r) => r.latency_ms)).sort((a, b) => a - b);
  return {
    totalEquity: s.accounts.reduce((t, a) => t + a.equity, 0),
    totalBalance: s.accounts.reduce((t, a) => t + a.balance, 0),
    openPL: s.positions.reduce((t, p) => t + p.profit, 0),
    openCount: s.positions.length,
    followers: followers.length,
    synced: online.length,
    medianLatency: lat.length ? lat[Math.floor(lat.length / 2)] : null,
  };
}

export const newToken = () => 'ml_' + Array.from({ length: 32 }, () => 'abcdef0123456789'[Math.floor(Math.random() * 16)]).join('');
export const nextLocalId = nextId;
export { copyTargets };
