// Instrument metadata for the demo simulator and the order ticket's symbol suggestions.
export const SYMBOLS = {
  EURUSD: { price: 1.0842, step: 0.0001, dp: 5, contract: 100000 },
  GBPUSD: { price: 1.2951, step: 0.0001, dp: 5, contract: 100000 },
  USDJPY: { price: 151.82, step: 0.01, dp: 3, contract: 1000 },
  XAUUSD: { price: 2652.4, step: 0.1, dp: 2, contract: 100 },
  US30: { price: 42810, step: 1, dp: 1, contract: 1 },
};
export const COMMON_SYMBOLS = ['EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD', 'USDCHF', 'NZDUSD', 'XAUUSD', 'XAGUSD', 'US30', 'NAS100', 'BTCUSD'];

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export const money = (n, { sign = false, whole = false } = {}) => {
  if (n == null || Number.isNaN(Number(n))) return '—';
  const body = (whole ? usd0 : usd).format(Math.abs(n));
  if (n < 0) return `−${body}`;
  return sign && n > 0 ? `+${body}` : body;
};

// Brokers add suffixes (EURUSD.m) so decimals are guessed from the magnitude of the price.
export const price = (symbol, n) => {
  if (n == null || n === 0) return '—';
  const base = String(symbol).replace(/[^A-Za-z0-9].*$/, '');
  const dp = SYMBOLS[base]?.dp ?? (n >= 10000 ? 1 : n >= 1000 ? 2 : n >= 10 ? 3 : 5);
  return Number(n).toFixed(dp);
};

export const lots = (n) => (n == null || Number.isNaN(Number(n)) ? '—' : Number(n).toFixed(2));
export const plClass = (n) => (n > 0 ? 'gain' : n < 0 ? 'loss' : '');
export const baseSymbol = (s) => String(s ?? '').replace(/[^A-Za-z0-9].*$/, '');

export function ago(iso) {
  if (!iso) return 'never';
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

export const clock = (iso) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
export const dayTime = (iso) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export const LOT_MODES = {
  fixed: { label: 'Fixed lot', field: 'Lot size', hint: 'Every copied trade uses this lot size.', step: '0.01' },
  multiplier: { label: 'Multiplier', field: 'Multiplier', hint: 'Master lot × this number.', step: '0.01' },
  balance_ratio: { label: 'Balance ratio', field: 'Scale', hint: 'Master lot × (follower balance ÷ master balance) × this number.', step: '0.01' },
  risk_pct: { label: 'Risk per trade', field: 'Risk %', hint: 'Sizes the lot so a stop-out loses this % of the follower balance. Trades without a stop loss are skipped.', step: '0.1', max: 100 },
};

export const lotSummary = (l) => {
  const v = Number(l.lot_value);
  switch (l.lot_mode) {
    case 'fixed': return `${v} lot${v === 1 ? '' : 's'} per trade`;
    case 'multiplier': return `${v}× master lots`;
    case 'balance_ratio': return `Balance ratio × ${v}`;
    case 'risk_pct': return `${v}% risk per trade`;
    default: return l.lot_mode;
  }
};

// What a follower would trade for a master lot (demo simulator only; the real sizing happens in the EA).
export function lotFor(link, masterLot, master, slave) {
  const r2 = (x) => Math.max(0.01, Math.round(x * 100) / 100);
  switch (link.lot_mode) {
    case 'fixed': return r2(link.lot_value);
    case 'multiplier': return r2(masterLot * link.lot_value);
    case 'balance_ratio': return r2((masterLot * slave.balance * link.lot_value) / (master?.balance || slave.balance));
    default: return r2(masterLot * 0.5);
  }
}

export const RESULT_TONE = { executed: 'gain', failed: 'loss', skipped: 'warn' };
