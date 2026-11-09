import { Link } from 'react-router-dom';
import { lots, money, plClass, price } from '../lib/format';
import { Badge, Empty, SideBadge } from './ui';

// The signature view: master trades on the left, each follower's copy mirrored on the right.
export default function MirrorBoard({ state }) {
  const master = state.accounts.find((a) => a.role === 'master');
  const followers = state.accounts.filter((a) => a.role === 'slave');
  const byId = Object.fromEntries(state.accounts.map((a) => [a.id, a]));
  const masterPositions = state.positions.filter((p) => p.account_id === master?.id).sort((a, b) => new Date(b.opened_at) - new Date(a.opened_at));
  const copiesOf = (ticket) => state.positions.filter((p) => p.master_ticket === ticket);
  const standalone = state.positions.filter((p) => p.account_id !== master?.id && p.master_ticket == null);

  if (!master) {
    return <Empty title="Add a master account" action={<Link className="btn btn-primary" to="/accounts">Connect accounts</Link>}>Trades you open on the master account will be mirrored here.</Empty>;
  }

  return (
    <div className="mirror">
      <div className="mirror-head">
        <div>
          <h3>{master.name}</h3>
          <span className="muted small">Master · {masterPositions.length} open</span>
        </div>
        <div className="seam-cap" aria-hidden="true" />
        <div className="right">
          <h3>Followers</h3>
          <span className="muted small">{followers.filter((f) => f.status === 'online' && !f.paused && !f.kill_switch).length} of {followers.length} copying</span>
        </div>
      </div>

      {masterPositions.length === 0 ? (
        <div className="mirror-empty">
          <Empty title="Nothing open on the master">Trades you open on {master.name} appear on both sides of the line within seconds.</Empty>
        </div>
      ) : (
        <ol className="mirror-rows">
          {masterPositions.map((p) => {
            const copies = copiesOf(p.ticket);
            const copied = new Set(copies.map((c) => c.account_id));
            const waiting = state.links.filter((l) => l.master_id === master.id && l.active && !copied.has(l.slave_id) && byId[l.slave_id]);
            return (
              <li key={p.ticket} className="mirror-row">
                <div className="side left">
                  <div className="leg">
                    <strong className="sym">{p.symbol}</strong>
                    <SideBadge side={p.side} />
                    <span className="num">{lots(p.volume)}</span>
                  </div>
                  <div className="sub">
                    <span className="num muted">{price(p.symbol, p.open_price)} → {price(p.symbol, p.price)}</span>
                    <span className={`num pl ${plClass(p.profit)}`}>{money(p.profit, { sign: true })}</span>
                  </div>
                </div>
                <div className="seam" aria-hidden="true"><i /></div>
                <div className="side right">
                  {copies.map((c) => (
                    <div key={c.ticket} className="copy" title={`${byId[c.account_id]?.name}: ${c.symbol} ${c.side} ${lots(c.volume)}`}>
                      <span className="who">{byId[c.account_id]?.name ?? 'Removed'}</span>
                      <span className="num">{lots(c.volume)}</span>
                      <span className={`num pl ${plClass(c.profit)}`}>{money(c.profit, { sign: true })}</span>
                    </div>
                  ))}
                  {waiting.map((l) => {
                    const f = byId[l.slave_id];
                    const why = f.kill_switch ? 'kill switch' : f.paused ? 'paused' : f.status !== 'online' ? 'offline' : state.copier.paused ? 'copying paused' : 'not copied';
                    return (
                      <div key={`w${l.id}`} className="copy copy-miss" title={`${f.name} has not copied this trade (${why})`}>
                        <span className="who">{f.name}</span>
                        <Badge tone="warn">{why}</Badge>
                      </div>
                    );
                  })}
                  {copies.length === 0 && waiting.length === 0 && <span className="muted small">No active links</span>}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {standalone.length > 0 && (
        <p className="mirror-foot muted small">
          {standalone.length} more open position{standalone.length === 1 ? '' : 's'} on followers {standalone.length === 1 ? 'was' : 'were'} not copied from the master. <Link to="/trades">See all trades</Link>
        </p>
      )}
    </div>
  );
}
