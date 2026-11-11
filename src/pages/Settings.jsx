import { Link } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { useData } from '../lib/DataContext';
import { apiOrigin, isLive } from '../lib/api';
import { PageHead, Toggle } from '../components/ui';

export default function Settings() {
  const { email, signOut } = useAuth();
  const { state, actions, derived } = useData();
  const paused = state.copier.paused;
  const initial = (email ?? '?').slice(0, 1).toUpperCase();

  return (
    <>
      <PageHead title="Settings">Your sign-in, the global copier switch and how this dashboard is connected.</PageHead>

      <div className="two-col">
        <section className="card">
          <div className="card-head"><h2>Profile</h2></div>
          <div className="profile">
            <span className="avatar" aria-hidden="true">{initial}</span>
            <div>
              <strong>{email ?? 'Signed in'}</strong>
              <p className="muted small">Dashboard administrator</p>
            </div>
          </div>
          <div className="actions pad"><button className="btn" onClick={signOut}><LogOut size={15} /> Sign out</button></div>
        </section>

        <section className="card">
          <div className="card-head"><h2>Copier</h2></div>
          <div className="setting-row">
            <div>
              <strong>Copy master trades to followers</strong>
              <p className="muted small">{paused ? 'Paused. New master trades will not reach followers. Closes and stop-loss changes still go through.' : 'Live. New master trades are mirrored to every active follower.'}</p>
            </div>
            <Toggle checked={!paused} onChange={(on) => actions.setPaused(!on)} label="Copy master trades to followers" />
          </div>
          <div className="setting-row">
            <div>
              <strong>Followers online</strong>
              <p className="muted small">Accounts currently connected and copying.</p>
            </div>
            <span className="num">{derived.synced} / {derived.followers}</span>
          </div>
        </section>
      </div>

      <section className="card">
        <div className="card-head"><h2>Connection</h2></div>
        <div className="kv">
          <div><span>Mode</span><strong>{isLive ? 'Live API' : 'Demo data'}</strong></div>
          <div><span>API origin</span><code>{apiOrigin()}</code></div>
          <div><span>Accounts</span><strong className="num">{state.accounts.length}</strong></div>
          <div><span>Copy links</span><strong className="num">{state.links.length}</strong></div>
        </div>
        <p className="hint pad">Need to connect a terminal or size your copies? See <Link to="/help">Help &amp; setup</Link>.</p>
      </section>
    </>
  );
}
