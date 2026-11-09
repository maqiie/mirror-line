import { useState } from 'react';
import { KeyRound, Pause, Pencil, Play, Plus, ShieldAlert, Trash2 } from 'lucide-react';
import { useData } from '../lib/DataContext';
import { apiOrigin } from '../lib/api';
import { ago, money } from '../lib/format';
import { Badge, Confirm, CopyButton, Empty, Field, Modal, PageHead, PlatformTag, StatusDot } from '../components/ui';

function TokenSteps({ account, token, onDone }) {
  const ea = account.role === 'master' ? 'CopierMaster' : 'CopierSlave';
  return (
    <div className="stack">
      <p><strong>{account.name}</strong> is added. Finish the setup inside {account.platform.toUpperCase()}:</p>
      <div className="token"><code>{token}</code><CopyButton text={token} label="Copy token" /></div>
      <p className="hint">This token is shown once. If you lose it, generate a new one from the account card.</p>
      <ol className="steps">
        <li>Copy <code>{ea}</code> into the terminal's <code>Experts</code> folder and compile it.</li>
        <li>In Tools → Options → Expert Advisors, tick Allow WebRequest and add <code>{apiOrigin()}</code>.</li>
        <li>Attach <code>{ea}</code> to any chart and paste the token into its token input.</li>
      </ol>
      <div className="actions"><button className="btn btn-primary" onClick={onDone}>Done</button></div>
    </div>
  );
}

function AddAccount({ onClose, hasMaster }) {
  const { actions } = useData();
  const [form, setForm] = useState({ name: '', platform: 'mt5', login: '', broker: '', server: '', role: hasMaster ? 'slave' : 'master' });
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    const res = await actions.addAccount({ ...form, login: form.login.trim() });
    setBusy(false);
    if (res) setResult(res);
  };

  return (
    <Modal title={result ? 'Finish setup' : 'Connect an account'} onClose={onClose}>
      {result ? (
        <TokenSteps account={result.account ?? form} token={result.token} onDone={onClose} />
      ) : (
        <form onSubmit={submit} className="stack">
          <Field label="Account name">{(id) => <input id={id} required value={form.name} onChange={set('name')} placeholder="Scalp account" />}</Field>
          <div className="row2">
            <Field label="Platform">{(id) => <select id={id} value={form.platform} onChange={set('platform')}><option value="mt5">MetaTrader 5</option><option value="mt4">MetaTrader 4</option></select>}</Field>
            <Field label="Role" hint={form.role === 'master' ? 'You open trades here.' : 'Copies trades from a master.'}>
              {(id) => <select id={id} value={form.role} onChange={set('role')}><option value="slave">Follower</option><option value="master">Master</option></select>}
            </Field>
          </div>
          <div className="row2">
            <Field label="Login number" hint="Digits only.">{(id) => <input id={id} required inputMode="numeric" pattern="[0-9]+" value={form.login} onChange={set('login')} placeholder="51872304" />}</Field>
            <Field label="Broker">{(id) => <input id={id} required value={form.broker} onChange={set('broker')} placeholder="Exness" />}</Field>
          </div>
          <Field label="Server" hint="Exactly as it appears in the terminal's login window.">{(id) => <input id={id} required value={form.server} onChange={set('server')} placeholder="Exness-MT5Real8" />}</Field>
          <p className="hint">You never enter your trading password here. The EA signs in with a token.</p>
          <div className="actions">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" disabled={busy}>{busy ? 'Adding…' : 'Add account'}</button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function EditAccount({ account, onClose }) {
  const { actions } = useData();
  const [f, setF] = useState({ name: account.name, broker: account.broker, server: account.server });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <Modal title={`Edit ${account.name}`} onClose={onClose}>
      <form className="stack" onSubmit={async (e) => { e.preventDefault(); setBusy(true); const ok = await actions.updateAccount(account, f); setBusy(false); if (ok) onClose(); }}>
        <Field label="Account name">{(id) => <input id={id} required value={f.name} onChange={set('name')} />}</Field>
        <div className="row2">
          <Field label="Broker">{(id) => <input id={id} value={f.broker} onChange={set('broker')} />}</Field>
          <Field label="Server">{(id) => <input id={id} value={f.server} onChange={set('server')} />}</Field>
        </div>
        <p className="hint">Login, platform and role can't change. Remove the account and connect it again to change those.</p>
        <div className="actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy}>Save changes</button></div>
      </form>
    </Modal>
  );
}

export default function Accounts() {
  const { state, actions } = useData();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [killing, setKilling] = useState(null);
  const [newToken, setNewToken] = useState(null);
  const regen = async (a) => { const token = await actions.regenerateToken(a); if (token) setNewToken({ account: a, token }); };
  const sorted = [...state.accounts].sort((a, b) => (a.role === b.role ? a.id - b.id : a.role === 'master' ? -1 : 1));

  return (
    <>
      <PageHead title="Accounts" action={<button className="btn btn-primary" onClick={() => setAdding(true)}><Plus size={16} /> Connect account</button>}>
        {state.accounts.length} connected. Trades on a master are copied to its followers.
      </PageHead>

      {sorted.length === 0 ? (
        <section className="card"><Empty title="No accounts connected" action={<button className="btn btn-primary" onClick={() => setAdding(true)}>Connect your first account</button>}>Add your master account first, then the accounts that should follow it.</Empty></section>
      ) : (
        <div className="cards">
          {sorted.map((a) => (
            <article key={a.id} className={`card acct ${a.role === 'master' ? 'is-master' : ''} ${a.kill_switch ? 'is-killed' : ''}`}>
              <div className="acct-top">
                <div>
                  <h3>{a.name}</h3>
                  <p className="muted small">{a.broker || 'Broker not set'}{a.server ? `, ${a.server}` : ''}</p>
                </div>
                <div className="tags"><PlatformTag platform={a.platform} />{a.role === 'master' && <Badge tone="accent">Master</Badge>}</div>
              </div>
              <div className="acct-nums">
                <div><span>Balance</span><strong className="num">{money(a.balance)}</strong></div>
                <div><span>Equity</span><strong className="num">{money(a.equity)}</strong></div>
              </div>
              <div className="acct-meta">
                <StatusDot account={a} />
                <span className="muted small">Login {a.login}. {a.last_seen_at ? `Seen ${ago(a.last_seen_at)}` : 'Never connected'}</span>
              </div>
              <div className="acct-actions">
                <div>
                <button className="btn btn-sm" onClick={() => actions.setAccountPaused(a)}>
                  {a.paused ? <><Play size={14} /> Resume</> : <><Pause size={14} /> Pause</>}
                </button>
                <button className={`btn btn-sm ${a.kill_switch ? 'btn-danger' : ''}`} onClick={() => (a.kill_switch ? actions.setKillSwitch(a, false) : setKilling(a))}>
                  <ShieldAlert size={14} /> {a.kill_switch ? 'Kill switch on' : 'Kill switch'}
                </button>
                <button className="btn btn-sm" onClick={() => regen(a)}><KeyRound size={14} /> New token</button>
                </div>
                <div>
                <button className="icon-btn" onClick={() => setEditing(a)} aria-label={`Edit ${a.name}`}><Pencil size={15} /></button>
                <button className="icon-btn danger" onClick={() => setRemoving(a)} aria-label={`Remove ${a.name}`}><Trash2 size={15} /></button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {adding && <AddAccount onClose={() => setAdding(false)} hasMaster={state.accounts.some((a) => a.role === 'master')} />}
      {editing && <EditAccount account={editing} onClose={() => setEditing(null)} />}
      {newToken && (
        <Modal title="New token" onClose={() => setNewToken(null)}>
          <div className="stack">
            <p>Paste this into the EA on <strong>{newToken.account.name}</strong>. The old token stops working right away.</p>
            <div className="token"><code>{newToken.token}</code><CopyButton text={newToken.token} label="Copy token" /></div>
            <div className="actions"><button className="btn btn-primary" onClick={() => setNewToken(null)}>Done</button></div>
          </div>
        </Modal>
      )}
      {killing && (
        <Confirm title={`Turn on the kill switch for ${killing.name}?`} confirmLabel="Turn on kill switch" danger onConfirm={() => actions.setKillSwitch(killing, true)} onClose={() => setKilling(null)}>
          <p>The EA on this account receives a kill signal and the dashboard stops sending it orders. Turn it off here to resume.</p>
        </Confirm>
      )}
      {removing && (
        <Confirm title={`Remove ${removing.name}?`} confirmLabel="Remove account" cancelLabel="Keep account" danger onConfirm={() => actions.removeAccount(removing)} onClose={() => setRemoving(null)}>
          <p>Its copy links are deleted and the EA stops receiving commands. Trades open at the broker are not closed.</p>
        </Confirm>
      )}
    </>
  );
}
