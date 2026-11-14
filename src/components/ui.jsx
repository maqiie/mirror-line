import { useEffect, useId, useRef, useState } from 'react';
import { Check, Copy, X } from 'lucide-react';

// Two halves facing each other across a dashed seam.
export function Logo({ size = 30 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className="logo">
      <defs>
        <linearGradient id="logo-gold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f1d99f" />
          <stop offset="1" stopColor="#a8803a" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="#0b0f16" stroke="rgba(212,175,106,.45)" />
      <path d="M16 6v20" stroke="#d4af6a" strokeWidth="1.5" strokeDasharray="2 2.5" opacity=".7" />
      <path d="M13 22V10l-5 6z" fill="url(#logo-gold)" />
      <path d="M19 22V10l5 6z" fill="#f3efe6" opacity=".92" />
    </svg>
  );
}

export function Badge({ tone = 'neutral', children, title }) {
  return <span className={`badge badge-${tone}`} title={title}>{children}</span>;
}

export const SideBadge = ({ side }) => <Badge tone={side === 'buy' ? 'buy' : 'sell'}>{side === 'buy' ? 'Buy' : 'Sell'}</Badge>;
export const PlatformTag = ({ platform }) => <span className="platform">{platform === 'mt4' ? 'MT4' : 'MT5'}</span>;

export function StatusDot({ account }) {
  const { status, paused, kill_switch: kill } = account;
  const [tone, label] = kill ? ['loss', 'Kill switch on'] : paused ? ['warn', 'Paused'] : status === 'online' ? ['ok', 'Online'] : ['off', 'Offline'];
  return (
    <span className="status">
      <i className={`dot dot-${tone}`} />
      {label}
    </span>
  );
}

export function Toggle({ checked, onChange, label, disabled }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} className={`toggle ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)}>
      <span />
    </button>
  );
}

export function Field({ label, hint, error, children }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children(id)}
      {hint && !error && <p className="hint">{hint}</p>}
      {error && <p className="hint hint-err">{error}</p>}
    </div>
  );
}

export function Segmented({ value, onChange, options, label, full, tone }) {
  return (
    <div className={`seg ${full ? 'seg-full' : ''}`} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} className={value === o.value ? `on ${o.tone ?? tone ?? ''}` : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Empty({ title, children, action }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function CopyButton({ text, label = 'Copy' }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1800);
        } catch { /* clipboard blocked */ }
      }}
    >
      {done ? <Check size={14} /> : <Copy size={14} />} {done ? 'Copied' : label}
    </button>
  );
}

export function Modal({ title, onClose, children, wide }) {
  const ref = useRef(null);
  const onCloseRef = useRef(onClose);
  const titleId = useId();

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const prev = document.activeElement;
    const first = ref.current?.querySelector('input, select, textarea, button:not(.modal-x)');
    (first ?? ref.current)?.focus();
    const key = (e) => {
      if (e.key === 'Escape') onCloseRef.current?.();
      if (e.key === 'Tab') {
        const nodes = ref.current.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex="0"]');
        if (!nodes.length) return;
        const [a, z] = [nodes[0], nodes[nodes.length - 1]];
        if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
        else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
      }
    };
    document.addEventListener('keydown', key);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', key);
      document.body.style.overflow = '';
      prev?.focus?.();
    };
  }, []);

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref} tabIndex={-1}>
        <div className="modal-head">
          <h2 id={titleId}>{title}</h2>
          <button className="icon-btn modal-x" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Confirm({ title, children, confirmLabel, cancelLabel = 'Cancel', danger, onConfirm, onClose }) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={title} onClose={onClose}>
      <div className="stack">
        <div className="prose">{children}</div>
        <div className="actions">
          <button className="btn" onClick={onClose}>{cancelLabel}</button>
          <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} disabled={busy} onClick={async () => { setBusy(true); await onConfirm(); setBusy(false); onClose(); }}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function PageHead({ title, children, action }) {
  return (
    <header className="page-head">
      <div>
        <h1>{title}</h1>
        {children && <p className="muted">{children}</p>}
      </div>
      {action}
    </header>
  );
}
