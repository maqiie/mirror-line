import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { useData, accountName } from '../lib/DataContext';
import { COMMON_SYMBOLS, SYMBOLS, lots, money, plClass, price } from '../lib/format';
import { Confirm, Empty, Field, PageHead, Segmented, SideBadge } from '../components/ui';

const SYMBOL_OK = /^[\w.\-#+]{1,32}$/;

function OrderTicket() {
  const { state, actions } = useData();
  const accepting = (a) => !a.paused && !a.kill_switch;
  const [picked, setPicked] = useState(() => state.accounts.filter((a) => a.status === 'online' && accepting(a)).map((a) => a.id));
  const [symbol, setSymbol] = useState('EURUSD');
  const [side, setSide] = useState('buy');
  const [entryPrice, setEntryPrice] = useState('');
  const [volume, setVolume] = useState('0.10');
  const [sl, setSl] = useState('');
  const [tp, setTp] = useState('');
  const [busy, setBusy] = useState(false);

  const sym = symbol.trim().toUpperCase();
  const suggestions = useMemo(() => [...new Set([...Object.keys(state.market ?? {}), ...COMMON_SYMBOLS, ...Object.keys(SYMBOLS)])], [state.market]);
  const market = state.market?.[sym] ?? state.market?.[sym.replace(/[^A-Z0-9].*$/, '')];
  const master = state.accounts.find((a) => a.role === 'master');
  const covered = state.accounts.filter((a) => picked.includes(a.id) && a.role === 'slave' && master && picked.includes(master.id) && state.links.some((l) => l.active && l.master_id === master.id && l.slave_id === a.id));
  const direct = picked.length - covered.length;
  const vol = Number(volume);
  const isPending = ['buy_limit', 'sell_limit', 'buy_stop', 'sell_stop'].includes(side);
  const entry = Number(entryPrice);
  const orderLabel = {
    buy: 'Market Buy',
    sell: 'Market Sell',
    buy_limit: 'Buy Limit',
    sell_limit: 'Sell Limit',
    buy_stop: 'Buy Stop',
    sell_stop: 'Sell Stop',
  }[side];
  const problem = !SYMBOL_OK.test(sym)
    ? 'Enter a valid symbol.'
    : !(vol > 0)
      ? 'Lots must be more than 0.'
      : isPending && !(entry > 0)
        ? 'Enter a valid pending-order entry price.'
        : picked.length === 0
          ? 'Choose at least one account.'
          : '';

  const toggle = (id) => setPicked((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]));
  const submit = async (e) => {
    e.preventDefault();
    if (problem) return;
    setBusy(true);
    await actions.placeOrder({
      account_ids: picked,
      symbol: sym,
      side,
      volume: vol,
      price: isPending ? entry : null,
      sl: sl ? Number(sl) : null,
      tp: tp ? Number(tp) : null,
    });
    setBusy(false);
  };

  return (
    <section className="card ticket">
      <h2>New trade</h2>
      <form onSubmit={submit} className="stack">
        <Field label="Order type">{(id) => (
          <select id={id} value={side} onChange={(e) => setSide(e.target.value)}>
            <option value="buy">Market Buy</option>
            <option value="sell">Market Sell</option>
            <option value="buy_stop">Buy Stop</option>
            <option value="sell_stop">Sell Stop</option>
            <option value="buy_limit">Buy Limit</option>
            <option value="sell_limit">Sell Limit</option>
          </select>
        )}</Field>
        <div className="row2">
          <Field label="Symbol">{(id) => <><input id={id} list="symbols" value={symbol} onChange={(e) => setSymbol(e.target.value)} autoCapitalize="characters" spellCheck="false" /><datalist id="symbols">{suggestions.map((s) => <option key={s} value={s} />)}</datalist></>}</Field>
          <Field label="Lots">{(id) => <input id={id} type="number" min="0.01" step="0.01" required value={volume} onChange={(e) => setVolume(e.target.value)} />}</Field>
        </div>
        {isPending && (
          <Field label="Entry price">{(id) => (
            <input id={id} type="number" min="0" step="any" required value={entryPrice} onChange={(e) => setEntryPrice(e.target.value)} placeholder="Pending order price" />
          )}</Field>
        )}
        <div className="row2">
          <Field label="Stop loss">{(id) => <input id={id} type="number" step="any" value={sl} onChange={(e) => setSl(e.target.value)} placeholder="Optional" />}</Field>
          <Field label="Take profit">{(id) => <input id={id} type="number" step="any" value={tp} onChange={(e) => setTp(e.target.value)} placeholder="Optional" />}</Field>
        </div>
        {market != null && <p className="muted small">Market price <strong className="num">{price(sym, market)}</strong></p>}
        <fieldset className="chips">
          <legend>Send to</legend>
          {state.accounts.map((a) => {
            const off = !accepting(a);
            return (
              <button type="button" key={a.id} disabled={off} aria-pressed={picked.includes(a.id)} className={`chip ${picked.includes(a.id) ? 'on' : ''}`} onClick={() => toggle(a.id)} title={off ? 'Paused or kill switch on' : a.status === 'offline' ? 'Offline: the order expires after 60 seconds if it does not come back' : undefined}>
                {a.name}{a.role === 'master' && <em>master</em>}{a.status === 'offline' && !off && <em>offline</em>}
              </button>
            );
          })}
        </fieldset>
        {covered.length > 0 && <p className="note">{covered.map((a) => a.name).join(', ')} will copy this from the master using {covered.length === 1 ? 'its' : 'their'} link, not as a separate order.</p>}
        {problem && picked.length > 0 && <p className="form-error">{problem}</p>}
        <button className={`btn btn-block ${side.startsWith('buy') ? 'btn-buy' : 'btn-sell'}`} disabled={busy || !!problem}>
          {orderLabel} {lots(vol || 0)} {sym || 'symbol'} on {direct} account{direct === 1 ? '' : 's'}
        </button>
      </form>
    </section>
  );
}

function Positions() {
  const { state, actions } = useData();
  const [filter, setFilter] = useState('all');
  const [confirmAll, setConfirmAll] = useState(false);
  const rows = state.positions.filter((p) => filter === 'all' || p.account_id === Number(filter)).sort((a, b) => new Date(b.opened_at) - new Date(a.opened_at));
  const total = rows.reduce((t, p) => t + p.profit, 0);

  return (
    <section className="card">
      <div className="card-head">
        <h2>Open positions <span className={`num total ${plClass(total)}`}>{money(total, { sign: true })}</span></h2>
        <div className="head-tools">
          <select aria-label="Filter by account" value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="all">All accounts</option>
            {state.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <button className="btn btn-sm btn-danger-soft" disabled={rows.length === 0} onClick={() => setConfirmAll(true)}>Close all</button>
        </div>
      </div>
      {rows.length === 0 ? (
        <Empty title="No open positions">Nothing is open{filter === 'all' ? '' : ' on this account'}. New trades appear here as they happen.</Empty>
      ) : (
        <div className="table-wrap">
          <table className="tight">
            <thead><tr><th>Account</th><th>Symbol</th><th>Side</th><th className="r">Lots</th><th className="r">Open</th><th className="r">Now</th><th className="r hide-md">SL</th><th className="r hide-md">TP</th><th className="r">Profit</th><th><span className="sr">Close</span></th></tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.ticket}>
                  <td className="nowrap">{accountName(state, p.account_id)}{p.master_ticket != null && <span className="copy-tag" title="Copied from the master">copy</span>}</td>
                  <td><strong>{p.symbol}</strong></td>
                  <td><SideBadge side={p.side} /></td>
                  <td className="r num">{lots(p.volume)}</td>
                  <td className="r num">{price(p.symbol, p.open_price)}</td>
                  <td className="r num">{price(p.symbol, p.price)}</td>
                  <td className="r num muted hide-md">{p.sl ? price(p.symbol, p.sl) : '—'}</td>
                  <td className="r num muted hide-md">{p.tp ? price(p.symbol, p.tp) : '—'}</td>
                  <td className={`r num ${plClass(p.profit)}`}>{money(p.profit, { sign: true })}</td>
                  <td className="r"><button className="icon-btn danger" onClick={() => actions.closePosition(p.ticket)} aria-label={`Close ${p.symbol} on ${accountName(state, p.account_id)}`}><X size={16} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {confirmAll && (
        <Confirm
          title={filter === 'all' ? 'Close everything on every account?' : `Close everything on ${accountName(state, Number(filter))}?`}
          confirmLabel="Close all positions" cancelLabel="Keep positions open" danger
          onConfirm={() => actions.closeAll(filter === 'all' ? null : Number(filter))} onClose={() => setConfirmAll(false)}
        >
          <p>This sends a close-all order to {filter === 'all' ? 'every account' : 'this account'}, including trades that were opened by hand in the terminal. It can't be undone.</p>
        </Confirm>
      )}
    </section>
  );
}

export default function Trades() {
  return (
    <>
      <PageHead title="Trades">Open or close trades on any account without switching terminals.</PageHead>
      <div className="grid-trades">
        <Positions />
        <OrderTicket />
      </div>
    </>
  );
}
