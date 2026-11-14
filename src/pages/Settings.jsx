import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { LogOut, ShieldCheck, Smartphone, RefreshCw } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { useData } from '../lib/DataContext';
import {
  apiOrigin,
  isLive,
  getSessions,
  revokeSession,
  revokeAllSessions,
  changePassword,
} from '../lib/api';
import { PageHead, Toggle, Field } from '../components/ui';

function sessionDate(value) {
  if (!value) return 'Not available';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not available' : date.toLocaleString();
}

function SessionItem({ session, onRevoke, busy }) {
  const device = session.user_agent || 'Unknown device';

  return (
    <div className="setting-row">
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <strong>{device.length > 90 ? `${device.slice(0, 90)}…` : device}</strong>
          {session.is_current && <span className="badge">Current session</span>}
        </div>
        <p className="muted small">
          IP: {session.ip_address || 'Unknown'} · Last active: {sessionDate(session.last_used_at)}
        </p>
        <p className="muted small">
          Signed in: {sessionDate(session.created_at)}
        </p>
      </div>
      <button
        className="btn btn-sm"
        disabled={busy}
        onClick={() => onRevoke(session)}
      >
        Revoke
      </button>
    </div>
  );
}

export default function Settings() {
  const { email, signOut } = useAuth();
  const { state, actions, derived } = useData();
  const navigate = useNavigate();

  const paused = state.copier.paused;
  const initial = (email ?? '?').slice(0, 1).toUpperCase();

  const [sessions, setSessions] = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState('');
  const [sessionBusy, setSessionBusy] = useState('');

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');
  const [passwordBusy, setPasswordBusy] = useState(false);

  async function loadSessions() {
    if (!isLive) return;

    setSessionsLoading(true);
    setSessionsError('');

    try {
      const result = await getSessions();
      setSessions(Array.isArray(result.sessions) ? result.sessions : []);
    } catch (err) {
      setSessionsError(err.message || 'Could not load sessions.');
    } finally {
      setSessionsLoading(false);
    }
  }

  useEffect(() => {
    loadSessions();
  }, []);

  async function handleRevoke(session) {
    const label = session.is_current ? 'this current session' : 'this session';
    if (!window.confirm(`Are you sure you want to revoke ${label}?`)) return;

    setSessionBusy(String(session.id));
    setSessionsError('');

    try {
      await revokeSession(session.id);

      if (session.is_current) {
        await signOut();
        navigate('/login', { replace: true });
        return;
      }

      await loadSessions();
    } catch (err) {
      setSessionsError(err.message || 'Could not revoke session.');
    } finally {
      setSessionBusy('');
    }
  }

  async function handleRevokeAll() {
    if (!window.confirm('This will sign out all devices, including this one. Continue?')) return;

    setSessionBusy('all');
    setSessionsError('');

    try {
      await revokeAllSessions();
      await signOut();
      navigate('/login', { replace: true });
    } catch (err) {
      setSessionsError(err.message || 'Could not revoke sessions.');
    } finally {
      setSessionBusy('');
    }
  }

  async function handlePasswordChange(e) {
    e.preventDefault();
    setPasswordError('');
    setPasswordSuccess('');

    if (newPassword.length < 8) {
      setPasswordError('Your new password must contain at least 8 characters.');
      return;
    }

    if (newPassword !== passwordConfirmation) {
      setPasswordError('The new passwords do not match.');
      return;
    }

    setPasswordBusy(true);

    try {
      await changePassword(currentPassword, newPassword, passwordConfirmation);
      setPasswordSuccess('Password changed. Signing you out…');

      await signOut();
      navigate('/login', { replace: true });
    } catch (err) {
      setPasswordError(err.message || 'Could not change password.');
    } finally {
      setPasswordBusy(false);
    }
  }

  return (
    <>
      <PageHead title="Settings">
        Your sign-in, account security, the global copier switch and how this dashboard is connected.
      </PageHead>

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
          <div className="actions pad">
            <button className="btn" onClick={signOut}>
              <LogOut size={15} /> Sign out
            </button>
          </div>
        </section>

        <section className="card">
          <div className="card-head"><h2>Copier</h2></div>
          <div className="setting-row">
            <div>
              <strong>Copy master trades to followers</strong>
              <p className="muted small">
                {paused
                  ? 'Paused. New master trades will not reach followers. Closes and stop-loss changes still go through.'
                  : 'Live. New master trades are mirrored to every active follower.'}
              </p>
            </div>
            <Toggle
              checked={!paused}
              onChange={(on) => actions.setPaused(!on)}
              label="Copy master trades to followers"
            />
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
        <div className="card-head">
          <h2><ShieldCheck size={17} /> Account security</h2>
        </div>

        <div className="pad stack">
          <div>
            <h3>Change password</h3>
            <p className="muted small">
              Choose a new password for your Mirrorline dashboard account.
              Changing it signs out all active sessions.
            </p>
          </div>

          <form className="stack" onSubmit={handlePasswordChange}>
            <Field label="Current password">
              {(id) => (
                <input
                  id={id}
                  type="password"
                  autoComplete="current-password"
                  required
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                />
              )}
            </Field>

            <Field label="New password" hint="Use at least 8 characters.">
              {(id) => (
                <input
                  id={id}
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              )}
            </Field>

            <Field label="Confirm new password">
              {(id) => (
                <input
                  id={id}
                  type="password"
                  autoComplete="new-password"
                  required
                  value={passwordConfirmation}
                  onChange={(e) => setPasswordConfirmation(e.target.value)}
                />
              )}
            </Field>

            {passwordError && <p className="form-error" role="alert">{passwordError}</p>}
            {passwordSuccess && <p className="note" role="status">{passwordSuccess}</p>}

            <div>
              <button className="btn btn-primary" disabled={passwordBusy}>
                {passwordBusy ? 'Updating password…' : 'Change password'}
              </button>
            </div>
          </form>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h2><Smartphone size={17} /> Active sessions</h2>
          {isLive && (
            <button className="btn btn-sm" onClick={loadSessions} disabled={sessionsLoading}>
              <RefreshCw size={14} /> Refresh
            </button>
          )}
        </div>

        {!isLive && (
          <p className="hint pad">Session management is available when connected to the live API.</p>
        )}

        {isLive && (
          <div className="pad">
            {sessionsLoading && <p className="muted small">Loading sessions…</p>}
            {sessionsError && <p className="form-error" role="alert">{sessionsError}</p>}

            {!sessionsLoading && !sessionsError && sessions.length === 0 && (
              <p className="muted small">No active sessions were returned.</p>
            )}

            {sessions.map((session) => (
              <SessionItem
                key={session.id}
                session={session}
                onRevoke={handleRevoke}
                busy={sessionBusy === String(session.id) || sessionBusy === 'all'}
              />
            ))}

            {sessions.length > 1 && (
              <div className="actions" style={{ marginTop: 16 }}>
                <button
                  className="btn"
                  onClick={handleRevokeAll}
                  disabled={!!sessionBusy}
                >
                  Revoke all sessions
                </button>
              </div>
            )}
          </div>
        )}
      </section>

      <section className="card">
        <div className="card-head"><h2>Connection</h2></div>
        <div className="kv">
          <div><span>Mode</span><strong>{isLive ? 'Live API' : 'Demo data'}</strong></div>
          <div><span>API origin</span><code>{apiOrigin()}</code></div>
          <div><span>Accounts</span><strong className="num">{state.accounts.length}</strong></div>
          <div><span>Copy links</span><strong className="num">{state.links.length}</strong></div>
        </div>
        <p className="hint pad">
          Need to connect a terminal or size your copies? See <Link to="/help">Help &amp; setup</Link>.
        </p>
      </section>
    </>
  );
}
