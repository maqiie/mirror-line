import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import * as api from '../lib/api';
import { Field, Logo } from '../components/ui';
import { SampleBoard } from '../components/site';

function AuthFrame({ title, description, children }) {
  return (
    <div className="login">
      <aside className="login-show">
        <Link to="/welcome" className="brand"><Logo size={34} /><span>Mirrorline</span></Link>
        <div className="login-show-copy">
          <span className="eyebrow"><i className="pulse" /> MT4 &amp; MT5 trade copier</span>
          <h2 className="sec-title">Trade once.<br /><em>Every account follows.</em></h2>
          <p className="lead">One secure account to manage your trading connections and copier.</p>
        </div>
        <SampleBoard />
      </aside>
      <main className="login-panel">
        <Link to="/welcome" className="back"><ArrowLeft size={14} /> Back to home</Link>
        <div className="login-card">
          <div className="brand login-mobile-brand"><Logo size={30} /><span>Mirrorline</span></div>
          <h1>{title}</h1>
          <p className="muted">{description}</p>
          {children}
        </div>
      </main>
    </div>
  );
}

function Feedback({ error, success }) {
  return (
    <>
      {error && <p className="form-error" role="alert">{error}</p>}
      {success && <p className="note" role="status">{success}</p>}
    </>
  );
}

export function Register() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');
    setSuccess('');
    if (password !== confirmation) return setError('Passwords do not match.');
    setBusy(true);
    try {
      const result = await api.register(email.trim(), password);
      setSuccess(result.message || 'Your account has been created. Check your email for the verification link.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthFrame title="Create account" description="Get started with your Mirrorline account.">
      <form onSubmit={submit} className="stack">
        <Field label="Email">
          {(id) => <input id={id} type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} />}
        </Field>
        <Field label="Password" hint="Use at least 8 characters.">
          {(id) => <input id={id} type="password" autoComplete="new-password" minLength={8} required value={password} onChange={e => setPassword(e.target.value)} />}
        </Field>
        <Field label="Confirm password">
          {(id) => <input id={id} type="password" autoComplete="new-password" required value={confirmation} onChange={e => setConfirmation(e.target.value)} />}
        </Field>
        <Feedback error={error} success={success} />
        <button className="btn btn-primary btn-block" disabled={busy || !!success}>
          {busy ? 'Creating account…' : 'Create account'}
        </button>
      </form>
      <p className="hint login-note">Already registered? <Link to="/login">Sign in</Link></p>
    </AuthFrame>
  );
}

export function VerifyEmail() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);

  async function verify() {
    setBusy(true);
    setError('');
    try {
      const result = await api.verifyEmail(token);
      setSuccess(result.message || 'Your email has been verified. You can now sign in.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthFrame title="Verify your email" description="Confirm your email address to activate your account.">
      <div className="stack">
        {!token && <Feedback error="The verification link is missing its token. Request a new verification email." />}
        {token && !success && !error && (
          <button className="btn btn-primary btn-block" onClick={verify} disabled={busy}>
            {busy ? 'Verifying…' : 'Verify email address'}
          </button>
        )}
        <Feedback error={error} success={success} />
        {success && <Link className="btn btn-primary btn-block" to="/login">Continue to sign in</Link>}
        {!success && <Link className="link" to="/resend-verification">Request another verification email</Link>}
      </div>
    </AuthFrame>
  );
}

export function ResendVerification() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const result = await api.resendVerification(email.trim());
      setSuccess(result.message || 'If an account needs verification, a new email will be sent.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthFrame title="Resend verification" description="We'll send a fresh verification link if your account needs one.">
      <form onSubmit={submit} className="stack">
        <Field label="Email">
          {(id) => <input id={id} type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} />}
        </Field>
        <Feedback error={error} success={success} />
        <button className="btn btn-primary btn-block" disabled={busy}>
          {busy ? 'Sending…' : 'Resend verification email'}
        </button>
      </form>
      <p className="hint login-note"><Link to="/login">Back to sign in</Link></p>
    </AuthFrame>
  );
}

export function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const result = await api.forgotPassword(email.trim());
      setSuccess(result.message || 'If an account exists for that email, password reset instructions will be sent.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthFrame title="Reset your password" description="Enter your email and we'll send password reset instructions.">
      <form onSubmit={submit} className="stack">
        <Field label="Email">
          {(id) => <input id={id} type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} />}
        </Field>
        <Feedback error={error} success={success} />
        <button className="btn btn-primary btn-block" disabled={busy}>
          {busy ? 'Sending…' : 'Send reset link'}
        </button>
      </form>
      <p className="hint login-note"><Link to="/login">Back to sign in</Link></p>
    </AuthFrame>
  );
}

export function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');
    setSuccess('');
    if (!token) return setError('The reset link is missing its token. Request a new password reset email.');
    if (password !== confirmation) return setError('Passwords do not match.');
    setBusy(true);
    try {
      const result = await api.resetPassword(token, password, confirmation);
      setSuccess(result.message || 'Your password has been reset. Sign in with your new password.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthFrame title="Choose a new password" description="Enter and confirm your new password.">
      <form onSubmit={submit} className="stack">
        <Field label="New password">
          {(id) => <input id={id} type="password" autoComplete="new-password" minLength={8} required value={password} onChange={e => setPassword(e.target.value)} />}
        </Field>
        <Field label="Confirm new password">
          {(id) => <input id={id} type="password" autoComplete="new-password" required value={confirmation} onChange={e => setConfirmation(e.target.value)} />}
        </Field>
        <Feedback error={error} success={success} />
        {!success && <button className="btn btn-primary btn-block" disabled={busy || !token}>
          {busy ? 'Updating password…' : 'Reset password'}
        </button>}
        {success && <Link className="btn btn-primary btn-block" to="/login">Continue to sign in</Link>}
      </form>
    </AuthFrame>
  );
}
