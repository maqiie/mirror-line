import { NavLink, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { LogOut, WifiOff } from 'lucide-react';
import { useAuth } from './lib/auth';
import { DataProvider, useData } from './lib/DataContext';
import { Logo, Toggle } from './components/ui';
import Login from './pages/Login';
import Overview from './pages/Overview';
import Accounts from './pages/Accounts';
import CopyLinks from './pages/CopyLinks';
import Trades from './pages/Trades';
import Risk from './pages/Risk';
import Activity from './pages/Activity';

const NAV = [
  { to: '/', label: 'Overview', end: true },
  { to: '/trades', label: 'Trades' },
  { to: '/accounts', label: 'Accounts' },
  { to: '/links', label: 'Copy links' },
  { to: '/risk', label: 'Risk' },
  { to: '/activity', label: 'Activity' },
];

function Shell() {
  const { signOut, email } = useAuth();
  const { state, actions, toasts, derived, error } = useData();
  const paused = state.copier.paused;
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-in">
          <div className="brand"><Logo /><span>Mirrorline</span></div>
          <nav aria-label="Main">
            {NAV.map(({ to, label, end }) => <NavLink key={to} to={to} end={end}>{label}</NavLink>)}
          </nav>
          <div className="top-tools">
            <label className={`copying ${paused ? 'is-paused' : ''}`} title="Global switch for copying new master trades">
              <span className="pulse" aria-hidden="true" />
              <span>{paused ? 'Copying paused' : 'Copying live'}</span>
              <Toggle checked={!paused} onChange={(on) => actions.setPaused(!on)} label="Copy master trades to followers" />
            </label>
            <button className="icon-btn" onClick={signOut} aria-label={`Sign out${email ? ` (${email})` : ''}`} title={email ? `Sign out ${email}` : 'Sign out'}><LogOut size={17} /></button>
          </div>
        </div>
      </header>

      {error && (
        <div className="banner banner-err" role="status"><WifiOff size={16} /><span>Lost connection to the server. Showing the last data. Retrying every few seconds.</span></div>
      )}
      {paused && !error && (
        <div className="banner" role="status">
          <span>Copying is paused. New master trades won't reach followers. Closes and stop-loss changes still go through.</span>
          <button className="btn btn-sm" onClick={() => actions.setPaused(false)}>Resume copying</button>
        </div>
      )}

      <main className="main"><Outlet /></main>
      <footer className="foot muted small">{derived.synced} of {derived.followers} followers online</footer>

      <div className="toasts" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className={`toast ${t.tone}`}>{t.message}</div>)}
      </div>
    </div>
  );
}

function Protected() {
  const { token } = useAuth();
  if (!token) return <Navigate to="/login" replace />;
  return <DataProvider><Shell /></DataProvider>;
}

export default function App() {
  const { token } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={token ? <Navigate to="/" replace /> : <Login />} />
      <Route element={<Protected />}>
        <Route index element={<Overview />} />
        <Route path="trades" element={<Trades />} />
        <Route path="accounts" element={<Accounts />} />
        <Route path="links" element={<CopyLinks />} />
        <Route path="risk" element={<Risk />} />
        <Route path="activity" element={<Activity />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
