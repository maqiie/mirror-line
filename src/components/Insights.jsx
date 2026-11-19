import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { accountName } from '../lib/DataContext';
import { baseSymbol, clock, lots, money, plClass, price } from '../lib/format';
import { useAudit } from '../lib/useAudit';

// Everything here is derived from the snapshot the dashboard already polls: no extra requests.

// Fixed order, assigned by account id so a colour never moves when a filter or sort changes.
const HUES = ['#d4af6a', '#4d9bff', '#a78bfa', '#22d3ee', '#f472b6', '#94a3b8'];
const pct = (n, dp = 1) => `${n.toFixed(dp)}%`;
const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

function Panel({ title, note, readout, children, className = '' }) {
  return (
    <section className={`card insight ${className}`}>
      <div className="card-head"><h2>{title}</h2>{note && <span className="muted small">{note}</span>}</div>
      <div className="readout" aria-live="polite">{readout}</div>
      {children}
    </section>
  );
}

/* ---------- live quotes ---------- */
export function QuoteStrip({ market }) {
  const prev = useRef({});
  const [dir, setDir] = useState({});
  useEffect(() => {
    const next = {};
    Object.entries(market ?? {}).forEach(([k, v]) => {
      const p = prev.current[k];
      next[k] = p == null || v === p ? undefined : v > p ? 'up' : 'down';
      prev.current[k] = v;
    });
    setDir((d) => Object.fromEntries(Object.keys(next).map((k) => [k, next[k] ?? d[k]])));
  }, [market]);
  const entries = Object.entries(market ?? {});
  if (!entries.length) return null;
  return (
    <ul className="quotes" aria-label="Live quotes">
      {entries.map(([sym, v]) => (
        <li key={sym} className={dir[sym] ?? ''}>
          <span>{sym}</span>
          <strong className="num">{price(sym, v)}</strong>
          <i aria-hidden="true">{dir[sym] === 'up' ? '▲' : dir[sym] === 'down' ? '▼' : '•'}</i>
        </li>
      ))}
    </ul>
  );
}

/* ---------- 1. where the money sits ---------- */
function Allocation({ state }) {
  const [hot, setHot] = useState(null);
  const rows = useMemo(() => {
    const total = state.accounts.reduce((t, a) => t + (a.equity || 0), 0) || 1;
    return state.accounts
      .map((a, i) => ({ a, color: HUES[i % HUES.length], share: ((a.equity || 0) / total) * 100, open: (a.equity || 0) - (a.balance || 0) }))
      .sort((x, y) => y.a.equity - x.a.equity);
  }, [state.accounts]);
  const h = rows.find((r) => r.a.id === hot);
  return (
    <Panel title="Where the money sits" note={`${rows.length} accounts`} readout={h ? <><strong>{h.a.name}</strong> holds {pct(h.share)} of combined equity, {money(h.a.equity, { whole: true })}</> : 'Hover an account to see its share of combined equity'}>
      <div className="stackbar" role="img" aria-label="Share of combined equity by account" onMouseLeave={() => setHot(null)}>
        {rows.map((r) => (
          <i key={r.a.id} style={{ flexGrow: Math.max(r.share, 0.5), background: r.color, opacity: hot && hot !== r.a.id ? 0.3 : 1 }} onMouseEnter={() => setHot(r.a.id)} />
        ))}
      </div>
      <ul className="legend-rows" onMouseLeave={() => setHot(null)}>
        {rows.map((r) => (
          <li key={r.a.id} className={hot === r.a.id ? 'hot' : ''} tabIndex={0} onMouseEnter={() => setHot(r.a.id)} onFocus={() => setHot(r.a.id)} onBlur={() => setHot(null)}>
            <i style={{ background: r.color }} aria-hidden="true" />
            <span className="nm">{r.a.name}{r.a.role === 'master' && <em>master</em>}</span>
            <span className="num muted">{pct(r.share)}</span>
            <span className="num">{money(r.a.equity, { whole: true })}</span>
            <span className={`num small ${plClass(r.open)}`}>{money(r.open, { sign: true, whole: true })}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/* ---------- 2. exposure by symbol ---------- */
function Exposure({ state }) {
  const [hot, setHot] = useState(null);
  const master = state.accounts.find((a) => a.role === 'master');
  const rows = useMemo(() => {
    const g = {};
    state.positions.forEach((p) => {
      const k = baseSymbol(p.symbol);
      const r = (g[k] ??= { sym: k, net: 0, gross: 0, pl: 0, n: 0, accts: new Set() });
      r.net += (p.side === 'buy' ? 1 : -1) * p.volume;
      r.gross += p.volume; r.pl += p.profit || 0; r.n += 1; r.accts.add(p.account_id);
    });
    return Object.values(g).sort((a, b) => b.gross - a.gross);
  }, [state.positions]);
  const max = Math.max(0.01, ...rows.map((r) => Math.abs(r.net)));
  const h = rows.find((r) => r.sym === hot);
  return (
    <Panel title="Exposure by symbol" note="all accounts" readout={h ? <><strong>{h.sym}</strong>: {h.n} position{h.n === 1 ? '' : 's'} on {h.accts.size} account{h.accts.size === 1 ? '' : 's'}, {lots(h.gross)} lots gross, {h.net >= 0 ? 'net long' : 'net short'} {lots(Math.abs(h.net))}</> : 'Net lots per symbol. Right is long, left is short'}>
      {rows.length === 0 ? <p className="muted small pad">No open positions{master ? ` on ${master.name}` : ''}.</p> : (
        <ul className="div-bars" onMouseLeave={() => setHot(null)}>
          {rows.map((r) => (
            <li key={r.sym} className={hot === r.sym ? 'hot' : ''} tabIndex={0} onMouseEnter={() => setHot(r.sym)} onFocus={() => setHot(r.sym)} onBlur={() => setHot(null)}>
              <strong>{r.sym}</strong>
              <div className="track" aria-hidden="true">
                <span className="axis" />
                <i className={r.net >= 0 ? 'long' : 'short'} style={{ width: `${(Math.abs(r.net) / max) * 50}%`, [r.net >= 0 ? 'left' : 'right']: '50%' }} />
              </div>
              <span className="num">{r.net > 0 ? '+' : r.net < 0 ? '−' : ''}{lots(Math.abs(r.net))}</span>
              <span className={`num small ${plClass(r.pl)}`}>{money(r.pl, { sign: true, whole: true })}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/* ---------- 3. open profit by position ---------- */
function OpenProfit({ state }) {
  const [hot, setHot] = useState(null);
  const rows = useMemo(
    () => [...state.positions].sort((a, b) => Math.abs(b.profit || 0) - Math.abs(a.profit || 0)).slice(0, 8).sort((a, b) => (b.profit || 0) - (a.profit || 0)),
    [state.positions]
  );
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.profit || 0)));
  const total = state.positions.reduce((t, p) => t + (p.profit || 0), 0);
  const h = rows.find((r) => r.ticket === hot);
  return (
    <Panel title="Open profit by position" note={`${state.positions.length} open`} readout={h ? <><strong>{h.symbol}</strong> {h.side} {lots(h.volume)} on {accountName(state, h.account_id)}: {price(h.symbol, h.open_price)} to {price(h.symbol, h.price)}</> : <>Total <span className={`num ${plClass(total)}`}>{money(total, { sign: true })}</span>. Largest moves shown</>}>
      {rows.length === 0 ? <p className="muted small pad">Nothing open right now.</p> : (
        <ul className="pl-bars" onMouseLeave={() => setHot(null)}>
          {rows.map((p) => (
            <li key={p.ticket} className={hot === p.ticket ? 'hot' : ''} tabIndex={0} onMouseEnter={() => setHot(p.ticket)} onFocus={() => setHot(p.ticket)} onBlur={() => setHot(null)}>
              <span className="who">{p.symbol}<em>{accountName(state, p.account_id)}</em></span>
              <div className="track" aria-hidden="true"><i className={(p.profit || 0) >= 0 ? 'gain' : 'loss'} style={{ width: `${(Math.abs(p.profit || 0) / max) * 100}%` }} /></div>
              <span className={`num ${plClass(p.profit)}`}>{money(p.profit, { sign: true })}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/* ---------- 4. copy quality ---------- */
function CopyQuality({ state }) {
  const [hot, setHot] = useState(null);
  const { counts, total, per } = useMemo(() => {
    const c = { executed: 0, skipped: 0, failed: 0 };
    const by = {};
    state.events.forEach((e) => e.results.forEach((r) => {
      if (c[r.status] != null) c[r.status] += 1;
      const b = (by[r.slave_id] ??= { id: r.slave_id, lat: [], ok: 0, n: 0 });
      b.n += 1; if (r.status === 'executed') { b.ok += 1; if (r.latency_ms) b.lat.push(r.latency_ms); }
    }));
    return { counts: c, total: c.executed + c.skipped + c.failed, per: Object.values(by).map((b) => ({ ...b, med: median(b.lat) })).sort((a, b) => (a.med ?? 1e9) - (b.med ?? 1e9)) };
  }, [state.events]);
  const rate = total ? (counts.executed / total) * 100 : null;
  const maxLat = Math.max(1, ...per.map((p) => p.med ?? 0));
  const h = per.find((p) => p.id === hot);
  return (
    <Panel title="Copy quality" note={`last ${state.events.length} events`} readout={h ? <><strong>{accountName(state, h.id)}</strong>: {h.ok} of {h.n} copied{h.med != null ? `, median ${h.med} ms` : ''}</> : total ? <><strong className="num">{pct(rate, 0)}</strong> of copy orders executed. Median time per follower below</> : 'Copy results appear after the first master trade'}>
      {total > 0 && (
        <>
          <div className="stackbar thin" role="img" aria-label={`${counts.executed} executed, ${counts.skipped} skipped, ${counts.failed} failed`}>
            {counts.executed > 0 && <i style={{ flexGrow: counts.executed, background: 'var(--gain)' }} />}
            {counts.skipped > 0 && <i style={{ flexGrow: counts.skipped, background: 'var(--warn)' }} />}
            {counts.failed > 0 && <i style={{ flexGrow: counts.failed, background: 'var(--loss)' }} />}
          </div>
          <p className="outcomes small"><span><b className="gain">●</b> {counts.executed} executed</span><span><b className="warn">●</b> {counts.skipped} skipped</span><span><b className="loss">●</b> {counts.failed} failed</span></p>
          <ul className="pl-bars lat" onMouseLeave={() => setHot(null)}>
            {per.map((p) => (
              <li key={p.id} className={hot === p.id ? 'hot' : ''} tabIndex={0} onMouseEnter={() => setHot(p.id)} onFocus={() => setHot(p.id)} onBlur={() => setHot(null)}>
                <span className="who">{accountName(state, p.id)}</span>
                <div className="track" aria-hidden="true"><i className="neutral" style={{ width: `${((p.med ?? 0) / maxLat) * 100}%` }} /></div>
                <span className="num">{p.med != null ? `${p.med} ms` : '—'}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {total === 0 && <p className="muted small pad">Nothing copied yet. <Link to="/activity">Open the activity log</Link></p>}
    </Panel>
  );
}


/* ---------- 5. order log (GET /audit/commands, same call as the Activity page) ---------- */
const ACTION = { open: 'Open', add: 'Add to trade', close: 'Close', partial_close: 'Partial close', modify: 'Change SL/TP', pending_place: 'Place pending', pending_modify: 'Change pending', pending_delete: 'Delete pending', close_all: 'Close all', close_ticket: 'Close position' };
const STATUS_COLOR = { executed: 'var(--gain)', pending: 'var(--ink-3)', sent: 'var(--ink-3)', skipped: 'var(--warn)', failed: 'var(--loss)', expired: 'var(--loss)' };

function OrderLog({ state, rows }) {
  const [hot, setHot] = useState(null);
  const data = useMemo(() => {
    const now = Date.now();
    const buckets = Array.from({ length: 24 }, (_, i) => ({ h: i, start: now - (24 - i) * 3600000, ok: 0, bad: 0, other: 0 }));
    const counts = {};
    const bad = [];
    rows.forEach((c) => {
      counts[c.status] = (counts[c.status] ?? 0) + 1;
      const age = now - new Date(c.created_at).getTime();
      const b = buckets[23 - Math.floor(age / 3600000)];
      if (b && age >= 0) { if (c.status === 'executed') b.ok += 1; else if (c.status === 'failed' || c.status === 'expired') b.bad += 1; else b.other += 1; }
      if (c.status === 'failed' || c.status === 'expired') bad.push(c);
    });
    const in24 = buckets.reduce((t, b) => t + b.ok + b.bad + b.other, 0);
    return { buckets, counts, bad: bad.slice(0, 5), in24, max: Math.max(1, ...buckets.map((b) => b.ok + b.bad + b.other)) };
  }, [rows]);
  const h = hot != null ? data.buckets[hot] : null;
  const order = ['executed', 'pending', 'sent', 'skipped', 'failed', 'expired'].filter((k) => data.counts[k]);
  return (
    <Panel className="wide" title="Order log" note={`last ${rows.length} orders`} readout={h ? <><strong>{clock(new Date(h.start).toISOString()).slice(0, 5)} to {clock(new Date(h.start + 3600000).toISOString()).slice(0, 5)}</strong>: {h.ok} executed, {h.bad} failed or expired, {h.other} other</> : <><strong className="num">{data.in24}</strong> orders in the last 24 hours. Hover a bar for that hour</>}>
      <div className="order-grid">
        <div>
          <div className="hours" role="img" aria-label="Orders per hour over the last 24 hours" onMouseLeave={() => setHot(null)}>
            {data.buckets.map((b, i) => {
              const t = b.ok + b.bad + b.other;
              return (
                <div key={b.h} className={`hr ${hot === i ? 'hot' : ''}`} onMouseEnter={() => setHot(i)} onTouchStart={() => setHot(i)}>
                  <span style={{ height: `${(t / data.max) * 100}%` }}>
                    {b.bad > 0 && <i style={{ flexGrow: b.bad, background: 'var(--loss)' }} />}
                    {b.other > 0 && <i style={{ flexGrow: b.other, background: 'var(--ink-3)' }} />}
                    {b.ok > 0 && <i style={{ flexGrow: b.ok, background: 'var(--gain)' }} />}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="hours-axis" aria-hidden="true"><span>24h ago</span><span>12h</span><span>now</span></div>
          <p className="outcomes small">
            {order.map((k) => <span key={k}><b style={{ color: STATUS_COLOR[k] }}>●</b> {data.counts[k]} {k === 'pending' || k === 'sent' ? 'waiting' : k}</span>)}
          </p>
        </div>
        <div>
          <h3 className="mini-h">Needs attention</h3>
          {data.bad.length === 0 ? <p className="muted small">No failed or expired orders in this log.</p> : (
            <ul className="attn">
              {data.bad.map((c) => (
                <li key={c.id}>
                  <div><strong>{ACTION[c.action] ?? c.action}{c.symbol ? ` ${c.symbol}` : ''}</strong><span className="muted small"> on {accountName(state, c.account_id)}</span></div>
                  <div className="small loss">{c.result_message || (c.status === 'expired' ? 'Expired before the EA picked it up' : 'Failed')}</div>
                  <div className="num muted small">{new Date(c.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} {clock(c.created_at)}</div>
                </li>
              ))}
            </ul>
          )}
          <Link className="link small" to="/activity">Open the full log</Link>
        </div>
      </div>
    </Panel>
  );
}

export default function Insights({ state }) {
  const audit = useAudit();
  return (
    <>
      <QuoteStrip market={state.market} />
      <div className="insights">
        <Allocation state={state} />
        <Exposure state={state} />
        <OpenProfit state={state} />
        <CopyQuality state={state} />
        {audit && audit.length > 0 && <OrderLog state={state} rows={audit} />}
      </div>
    </>
  );
}
