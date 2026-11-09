import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useData } from '../lib/DataContext';
import { Empty, Field, PageHead, PlatformTag } from '../components/ui';

const LIMITS = [
  { key: 'max_lot', label: 'Biggest single trade', unit: 'lots', hint: 'The largest lot size the EA will open.', step: '0.01' },
  { key: 'max_open', label: 'Open trades at once', unit: 'trades', hint: 'The most trades the EA will hold open.', step: '1' },
  { key: 'daily_loss_pct', label: 'Daily loss limit', unit: '% of balance', hint: 'Halts new trades for the day once this loss is reached.', step: '0.1' },
  { key: 'min_margin_level', label: 'Lowest margin level', unit: '%', hint: 'New trades are only allowed above this level.', step: '1' },
  { key: 'max_spread', label: 'Widest spread', unit: 'points', hint: 'Trades wait while the spread is wider than this.', step: '1' },
];

function Limits({ account, current }) {
  const { actions } = useData();
  const [vals, setVals] = useState(() => Object.fromEntries(LIMITS.map((l) => [l.key, String(current[l.key])])));
  const [busy, setBusy] = useState(false);
  const dirty = LIMITS.some((l) => Number(vals[l.key]) !== Number(current[l.key]));
  const invalid = LIMITS.some((l) => vals[l.key] === '' || !(Number(vals[l.key]) >= 0));

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    await actions.saveGuards(account.id, Object.fromEntries(LIMITS.map((l) => [l.key, Number(vals[l.key])])));
    setBusy(false);
  };

  return (
    <form className="card risk" onSubmit={save}>
      <div className="risk-head">
        <div><h3>{account.name}</h3><div className="tags"><PlatformTag platform={account.platform} /><span className="muted small">{account.broker}</span></div></div>
        <div className="actions">
          <button type="button" className="btn btn-sm" disabled={!dirty} onClick={() => setVals(Object.fromEntries(LIMITS.map((l) => [l.key, String(current[l.key])])))}>Reset</button>
          <button className="btn btn-sm btn-primary" disabled={!dirty || invalid || busy}>Save limits</button>
        </div>
      </div>
      <div className="limits">
        {LIMITS.map((l) => (
          <Field key={l.key} label={l.label} hint={l.hint}>
            {(id) => (
              <div className="unit">
                <input id={id} type="number" inputMode="decimal" min="0" step={l.step} value={vals[l.key]} onChange={(e) => setVals((v) => ({ ...v, [l.key]: e.target.value }))} />
                <span>{l.unit}</span>
              </div>
            )}
          </Field>
        ))}
      </div>
    </form>
  );
}

export default function Risk() {
  const { state } = useData();
  const followers = state.accounts.filter((a) => a.role === 'slave');
  return (
    <>
      <PageHead title="Risk limits">Each follower gets its own limits. They are sent to its EA within a few seconds and replace the EA's own inputs.</PageHead>
      {followers.length === 0 ? (
        <section className="card"><Empty title="No followers to protect" action={<Link className="btn btn-primary" to="/accounts">Connect an account</Link>}>Limits apply to follower accounts.</Empty></section>
      ) : (
        <div className="stack-lg">
          {followers.map((a) => state.guards[a.id] && <Limits key={`${a.id}:${JSON.stringify(state.guards[a.id])}`} account={a} current={state.guards[a.id]} />)}
        </div>
      )}
    </>
  );
}
