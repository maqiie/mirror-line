import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useData } from '../lib/DataContext';
import { accountName } from '../lib/DataContext';
import { ago, clock, lots, money, plClass } from '../lib/format';
import { Badge, Empty, PlatformTag, Segmented, SideBadge, StatusDot } from '../components/ui';
import EquityChart from '../components/EquityChart';
import MirrorBoard from '../components/MirrorBoard';

const RANGES = [{ value: 7, label: '7d' }, { value: 30, label: '30d' }, { value: 90, label: '90d' }];

export default function Overview() {
  const { state, derived: d } = useData();
  const [range, setRange] = useState(30);
  const first = state.equity.find((p) => p.t >= Date.now() - range * 86400000) ?? state.equity[0];
  const change = state.equity.length ? d.totalEquity - first.v : 0;
  const followers = state.accounts.filter((a) => a.role === 'slave');

  return (
    <>
      <section className="hero">
        <div className="hero-fig">
          <p className="muted">Combined equity across {state.accounts.length} account{state.accounts.length === 1 ? '' : 's'}</p>
          <div className="big num">{money(d.totalEquity, { whole: true })}<small>{money(d.totalEquity).slice(-3)}</small></div>
          <p className={`delta ${plClass(change)}`}>
            {money(change, { sign: true })} over {range} days
          </p>
        </div>
        <div className="hero-chart">
          <div className="chart-tools"><Segmented label="Range" value={range} onChange={setRange} options={RANGES} /></div>
          <EquityChart points={state.equity} days={range} />
        </div>
      </section>

      <section className="stats" aria-label="Summary">
        <div><span>Open profit</span><strong className={`num ${plClass(d.openPL)}`}>{money(d.openPL, { sign: true })}</strong></div>
        <div><span>Open positions</span><strong className="num">{d.openCount}</strong></div>
        <div><span>Followers copying</span><strong className="num">{d.synced}<em>/{d.followers}</em></strong></div>
        <div><span>Median copy time</span><strong className="num">{d.medianLatency != null ? `${d.medianLatency}` : '—'}{d.medianLatency != null && <em> ms</em>}</strong></div>
      </section>

      <section className="card board">
        <div className="card-head"><h2>Mirror board</h2><Link className="link" to="/trades">Manage trades</Link></div>
        <MirrorBoard state={state} />
      </section>

      <div className="two-col">
        <section className="card">
          <div className="card-head"><h2>Followers</h2><Link className="link" to="/accounts">All accounts</Link></div>
          {followers.length === 0 ? (
            <Empty title="No followers yet" action={<Link className="btn btn-primary" to="/accounts">Connect an account</Link>}>Add accounts that should copy your master.</Empty>
          ) : (
            <ul className="list">
              {followers.map((a) => (
                <li key={a.id}>
                  <div>
                    <strong>{a.name}</strong>
                    <div className="tags"><PlatformTag platform={a.platform} /><span className="muted small">{a.last_seen_at ? `seen ${ago(a.last_seen_at)}` : 'never connected'}</span></div>
                  </div>
                  <div className="meta">
                    <div className="num">{money(a.equity)}</div>
                    <StatusDot account={a} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <div className="card-head"><h2>Latest activity</h2><Link className="link" to="/activity">Full log</Link></div>
          {state.events.length === 0 ? (
            <Empty title="Nothing yet">Master trades and orders you send are logged here.</Empty>
          ) : (
            <ul className="list feed">
              {state.events.slice(0, 6).map((e) => {
                const bad = e.results.filter((r) => r.status === 'failed').length;
                const ok = e.results.filter((r) => r.status === 'executed').length;
                return (
                  <li key={e.id}>
                    <div>
                      <strong>{e.type === 'open' ? 'Opened' : e.type === 'close' ? 'Closed' : 'Modified'} {e.symbol}</strong>
                      <div className="tags"><SideBadge side={e.side} /><span className="num muted small">{lots(e.volume)} lots</span>{e.source === 'dashboard' && <Badge>Manual</Badge>}</div>
                    </div>
                    <div className="meta">
                      <span className="num muted small">{clock(e.at)}</span>
                      <div className="small tags">
                        {e.type === 'close' && e.profit != null && <strong className={`num ${plClass(e.profit)}`}>{money(e.profit, { sign: true })}</strong>}
                        {e.results.length > 0 && (bad ? <span className="loss">{bad} failed</span> : <span className="muted">{ok} of {e.results.length} done</span>)}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
