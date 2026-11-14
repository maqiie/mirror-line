import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { isLive } from '../lib/api';
import { Field, Logo } from '../components/ui';
import { SampleBoard } from '../components/site';

export default function Login() {
  const { signIn, signInDemo } = useAuth();
  const [email, setEmail] = useState(() => { try { return localStorage.getItem('mirrorline.email') ?? ''; } catch { return ''; } });
  const [password, setPassword] = useState('');
  const [error, setError] = useState(() => {
    try { return sessionStorage.getItem('mirrorline.notice') ?? ''; } catch { return ''; }
  });
  useEffect(() => { try { sessionStorage.removeItem('mirrorline.notice'); } catch { /* ignore */ } }, []);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await signIn(email.trim(), password);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <aside className="login-show">
        <Link to="/welcome" className="brand"><Logo size={34} /><span>Mirrorline</span></Link>
        <div className="login-show-copy">
          <span className="eyebrow"><i className="pulse" /> MT4 &amp; MT5 trade copier</span>
          <h2 className="sec-title">Trade once.<br /><em>Every account follows.</em></h2>
          <p className="lead">Watch your master account and everything copying it, with risk limits on every follower.</p>
        </div>
        <SampleBoard />
      </aside>
      <main className="login-panel">
        <Link to="/welcome" className="back"><ArrowLeft size={14} /> Back to home</Link>
        <div className="login-card">
          <div className="brand login-mobile-brand"><Logo size={30} /><span>Mirrorline</span></div>
          <h1>Welcome back</h1>
          <p className="muted">Sign in to manage your copier.</p>
          <form onSubmit={submit} className="stack">
            <Field label="Email">{(id) => <input id={id} type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
            <Field label="Password">{(id) => <input id={id} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />}</Field>
            <p className="hint" style={{ textAlign: 'right' }}><Link to="/forgot-password">Forgot password?</Link></p>
            {error && <p className="form-error" role="alert">{error}</p>}
            <p className="hint">Didn't receive your verification email? <Link to="/resend-verification">Resend it</Link></p>
            <button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          </form>
          {!isLive && <button className="btn btn-block" onClick={signInDemo}>Open the demo</button>}
          <p className="hint login-note">New to Mirrorline? <Link to="/register">Create an account</Link></p>
          <p className="hint login-note">Your trading password is never entered here. Each account’s EA signs in with a token.</p>
        </div>
      </main>
    </div>
  );
}
