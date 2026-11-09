import { useCallback, useEffect, useState } from 'react';
import { useData, accountName } from '../lib/DataContext';
import { auditCommands, isLive } from '../lib/api';
import { clock, lots } from '../lib/format';
import { Badge, Empty, PageHead, Segmented } from '../components/ui';

const ACTION = {
  open: 'Open', add: 'Add to trade', close: 'Close', partial_close: 'Partial close', modify: 'Change SL/TP',
  pending_place: 'Place pending order', pending_modify: 'Change pending order', pending_delete: 'Delete pending order',
  close_all: 'Close all', close_ticket: 'Close position',
};
const TONE = { executed: 'gain', failed: 'loss', expired: 'loss', skipped: 'warn', pending: 'neutral', sent: 'accent' };
const FILTERS = [{ value: '', label: 'All' }, { value: 'failed', label: 'Failed' }, { value: 'expired', label: 'Expired' }, { value: 'skipped', label: 'Skipped' }, { value: 'pending', label: 'Waiting' }];

export default function Activity() {
  const { state, error } = useData();
  const [status, setStatus] = useState('');
  const [rows, setRows] = useState(null);
  const [problem, setProblem] = useState('');

  const load = useCallback(async () => {
    if (!isLive) return setRows([]);
    try {
      setRows(await auditCommands({ status, limit: 100 }));
      setProblem('');
    } catch (e) {
      if (e.status !== 401) setProblem(e.message);
    }
  }, [status]);

  useEffect(() => {
    setRows(null);
    load();
    const t = setInterval(() => { if (!document.hidden) load(); }, 5000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <>
      <PageHead title="Activity">Every order the copier sent to an account, and what happened to it. Check here when a copy didn't go through.</PageHead>
      <section className="card">
        <div className="card-head">
          <Segmented label="Status" value={status} onChange={setStatus} options={FILTERS} />
        </div>
        {problem && !error && <p className="form-error">{problem}</p>}
        {rows == null ? (
          <p className="muted pad">Loading…</p>
        ) : rows.length === 0 ? (
          <Empty title={status ? 'Nothing with that status' : 'No orders yet'}>{isLive ? 'Orders appear here as soon as the copier sends them.' : 'The activity log needs the live API. The Overview page shows demo events.'}</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Time</th><th>Account</th><th>Order</th><th>Status</th><th className="hide-md">Detail</th></tr></thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id}>
                    <td className="num muted" title={c.created_at}>{new Date(c.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}<span className="sub">{clock(c.created_at)}</span></td>
                    <td>{accountName(state, c.account_id)}</td>
                    <td><strong>{ACTION[c.action] ?? c.action}</strong>{c.symbol ? <> <span className="muted">{c.symbol}</span></> : null}{c.side ? <> <span className="muted">{c.side}</span></> : null}{c.volume ? <> <span className="num muted">{lots(c.volume)}</span></> : null}</td>
                    <td><Badge tone={TONE[c.status] ?? 'neutral'}>{c.status === 'pending' || c.status === 'sent' ? 'Waiting' : c.status[0].toUpperCase() + c.status.slice(1)}</Badge></td>
                    <td className="hide-md muted small">{c.result_message || (c.attempts > 1 ? `Sent ${c.attempts} times` : '')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
