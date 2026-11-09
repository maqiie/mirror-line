import { useState } from 'react';
import { ArrowRight, Pencil, Plus, Trash2 } from 'lucide-react';
import { Link as RouterLink } from 'react-router-dom';
import { useData } from '../lib/DataContext';
import { LOT_MODES, lotSummary } from '../lib/format';
import { Badge, Confirm, Empty, Field, Modal, PageHead, PlatformTag, Toggle } from '../components/ui';

const blank = (masterId, slaveId) => ({
  master_id: masterId, slave_id: slaveId, lot_mode: 'multiplier', lot_value: 1, reverse: false, max_slippage: 20,
  symbol_suffix: '', symbols: [], copy_pending: true, copy_missed_opens: false, active: true,
});

function LinkForm({ initial, onClose }) {
  const { state, actions } = useData();
  const editing = !!initial.id;
  const masters = state.accounts.filter((a) => a.role === 'master');
  const taken = (m, s) => state.links.some((l) => l.master_id === m && l.slave_id === s);
  const followers = state.accounts.filter((a) => a.role === 'slave' && (editing || !taken(initial.master_id, a.id)));
  const [f, setF] = useState({ ...initial, symbols: initial.symbols ?? [] });
  const [symbolText, setSymbolText] = useState((initial.symbols ?? []).join(', '));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const mode = LOT_MODES[f.lot_mode];
  const name = (id) => state.accounts.find((a) => a.id === id)?.name;
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    const value = Number(f.lot_value);
    if (!(value > 0)) return setErr(`${mode.field} must be greater than 0.`);
    if (f.lot_mode === 'risk_pct' && value > 100) return setErr('Risk can be at most 100%.');
    setErr('');
    setBusy(true);
    const symbols = symbolText.split(/[\s,]+/).map((s) => s.trim().toUpperCase()).filter(Boolean);
    const body = { ...f, lot_value: value, max_slippage: Math.round(Number(f.max_slippage) || 0), symbols };
    const ok = await actions.saveLink(body);
    setBusy(false);
    if (ok) onClose();
  };

  return (
    <Modal title={editing ? `Edit link to ${name(f.slave_id)}` : 'New copy link'} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        {!editing && (
          <div className="row2">
            <Field label="Copy from">{(id) => <select id={id} value={f.master_id} onChange={(e) => set('master_id', Number(e.target.value))}>{masters.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>}</Field>
            <Field label="To follower">{(id) => <select id={id} value={f.slave_id ?? ''} onChange={(e) => set('slave_id', Number(e.target.value))} required>{!f.slave_id && <option value="">Choose…</option>}{followers.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>}</Field>
          </div>
        )}
        <div className="row2">
          <Field label="Lot sizing">{(id) => <select id={id} value={f.lot_mode} onChange={(e) => set('lot_mode', e.target.value)}>{Object.entries(LOT_MODES).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}</select>}</Field>
          <Field label={mode.field}>{(id) => <input id={id} type="number" min="0" step={mode.step} max={mode.max} required value={f.lot_value} onChange={(e) => set('lot_value', e.target.value)} />}</Field>
        </div>
        <p className="hint">{mode.hint}</p>
        <div className="row2">
          <Field label="Max slippage (points)" hint="Skips the trade if price moved further than this.">{(id) => <input id={id} type="number" min="0" max="1000" step="1" required value={f.max_slippage} onChange={(e) => set('max_slippage', e.target.value)} />}</Field>
          <Field label="Symbol suffix" hint="Broker suffix such as .m or #.">{(id) => <input id={id} maxLength={16} pattern="[\w.\-#+]*" value={f.symbol_suffix} onChange={(e) => set('symbol_suffix', e.target.value)} placeholder="None" />}</Field>
        </div>
        <Field label="Only copy these symbols" hint="Leave empty to copy everything. Separate with commas, for example EURUSD, XAUUSD.">{(id) => <input id={id} value={symbolText} onChange={(e) => setSymbolText(e.target.value)} placeholder="All symbols" />}</Field>
        <div className="options">
          <label className="opt"><Toggle checked={f.reverse} onChange={(v) => set('reverse', v)} label="Reverse trades" /><span><strong>Reverse trades</strong><small>Buy becomes sell and the other way round.</small></span></label>
          <label className="opt"><Toggle checked={f.copy_pending} onChange={(v) => set('copy_pending', v)} label="Copy pending orders" /><span><strong>Copy pending orders</strong><small>Limit and stop orders from the master are placed too.</small></span></label>
          <label className="opt"><Toggle checked={f.copy_missed_opens} onChange={(v) => set('copy_missed_opens', v)} label="Catch up on open trades" /><span><strong>Catch up on open trades</strong><small>Copy trades the master already held before this link existed or while the follower was offline.</small></span></label>
        </div>
        {err && <p className="form-error" role="alert">{err}</p>}
        <div className="actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy || (!editing && !f.slave_id)}>{editing ? 'Save changes' : 'Create link'}</button></div>
      </form>
    </Modal>
  );
}

export default function CopyLinks() {
  const { state, actions } = useData();
  const [form, setForm] = useState(null);
  const [removing, setRemoving] = useState(null);
  const acc = (id) => state.accounts.find((a) => a.id === id);
  const master = state.accounts.find((a) => a.role === 'master');
  const followers = state.accounts.filter((a) => a.role === 'slave');
  const canAdd = master && followers.length > 0;

  return (
    <>
      <PageHead title="Copy links" action={canAdd && <button className="btn btn-primary" onClick={() => setForm(blank(master.id, null))}><Plus size={16} /> New link</button>}>
        Decide how each follower copies the master: lot size, direction, symbols and slippage.
      </PageHead>

      {state.links.length === 0 ? (
        <section className="card">
          <Empty title="No copy links yet" action={canAdd ? <button className="btn btn-primary" onClick={() => setForm(blank(master.id, null))}>Create a link</button> : <RouterLink className="btn btn-primary" to="/accounts">Connect accounts</RouterLink>}>
            {canAdd ? 'A link connects one follower to the master and sets how its trades are sized.' : 'Connect a master and at least one follower first.'}
          </Empty>
        </section>
      ) : (
        <div className="links">
          {state.links.map((l) => {
            const m = acc(l.master_id);
            const s = acc(l.slave_id);
            return (
              <article key={l.id} className={`card link ${l.active ? '' : 'is-off'}`}>
                <div className="link-flow">
                  <div><strong>{m?.name ?? 'Removed'}</strong><span className="muted small">Master</span></div>
                  <ArrowRight size={18} className="flow-arrow" aria-hidden="true" />
                  <div><strong>{s?.name ?? 'Removed'}</strong>{s && <span className="muted small"><PlatformTag platform={s.platform} /> {s.broker}</span>}</div>
                </div>
                <div className="link-rules">
                  <Badge tone="accent">{lotSummary(l)}</Badge>
                  {l.reverse && <Badge tone="sell">Reversed</Badge>}
                  {l.symbols?.length > 0 && <Badge title={l.symbols.join(', ')}>{l.symbols.length} symbol{l.symbols.length === 1 ? '' : 's'} only</Badge>}
                  {l.symbol_suffix && <Badge>Suffix {l.symbol_suffix}</Badge>}
                  <Badge>Slippage {l.max_slippage}</Badge>
                  {!l.copy_pending && <Badge>No pending</Badge>}
                  {l.copy_missed_opens && <Badge>Catches up</Badge>}
                </div>
                <div className="link-foot">
                  <label className="inline"><Toggle checked={l.active} onChange={() => actions.toggleLink(l)} label={`${l.active ? 'Pause' : 'Resume'} link to ${s?.name}`} /><span>{l.active ? 'Copying' : 'Paused'}</span></label>
                  <span className="grow" />
                  <button className="icon-btn" onClick={() => setForm(l)} aria-label={`Edit link to ${s?.name}`}><Pencil size={15} /></button>
                  <button className="icon-btn danger" onClick={() => setRemoving(l)} aria-label={`Delete link to ${s?.name}`}><Trash2 size={15} /></button>
                </div>
              </article>
            );
          })}
        </div>
      )}
      {form && <LinkForm initial={form} onClose={() => setForm(null)} />}
      {removing && (
        <Confirm title="Delete this link?" confirmLabel="Delete link" cancelLabel="Keep link" danger onConfirm={() => actions.removeLink(removing.id)} onClose={() => setRemoving(null)}>
          <p><strong>{acc(removing.slave_id)?.name}</strong> stops copying <strong>{acc(removing.master_id)?.name}</strong>. Its open trades stay open.</p>
        </Confirm>
      )}
    </>
  );
}
