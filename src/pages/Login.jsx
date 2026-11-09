import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import { isLive } from '../lib/api';
import { Field, Logo } from '../components/ui';

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
      <div className="login-art" aria-hidden="true">
        <div className="art-half art-l"><span>Buy</span><i /><i /><i /></div>
        <div className="art-seam" />
        <div className="art-half art-r"><span>Copied</span><i /><i /><i /></div>
      </div>
      <main className="login-panel">
        <div className="brand"><Logo size={34} /><span>Mirrorline</span></div>
        <h1>Trade once. Every account follows.</h1>
        <p className="muted">Sign in to watch your master account and everything copying it.</p>
        <form onSubmit={submit} className="stack">
          <Field label="Email">{(id) => <input id={id} type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
          <Field label="Password">{(id) => <input id={id} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />}</Field>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        </form>
        {!isLive && <button className="btn btn-block" onClick={signInDemo}>Open the demo</button>}
      </main>
    </div>
  );
}
