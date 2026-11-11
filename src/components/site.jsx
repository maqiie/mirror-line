import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { Logo, SideBadge } from './ui';

// Shared chrome for the public pages (landing + login). Presentation only, no data or API calls.

export function SiteNav({ onLanding = false }) {
  const to = (hash) => (onLanding ? hash : `/welcome${hash}`);
  const A = ({ hash, children }) => (onLanding ? <a href={hash}>{children}</a> : <Link to={to(hash)}>{children}</Link>);
  return (
    <header className="site-nav">
      <div className="site-nav-in">
        <Link to="/welcome" className="brand" aria-label="Mirrorline home"><Logo /><span>Mirrorline</span></Link>
        <nav aria-label="Site">
          <A hash="#features">Features</A>
          <A hash="#how">How it works</A>
          <A hash="#risk">Risk controls</A>
          <A hash="#faq">FAQ</A>
        </nav>
        <Link to="/login" className="btn btn-primary btn-sm">Sign in <ArrowRight size={14} /></Link>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-foot">
      <div className="site-foot-in">
        <div>
          <div className="brand"><Logo size={26} /><span>Mirrorline</span></div>
          <p className="muted small">Trade once on your master account. Every follower mirrors it, within the limits you set.</p>
        </div>
        <nav aria-label="Footer">
          <a href="/welcome#features">Features</a>
          <a href="/welcome#how">How it works</a>
          <a href="/welcome#risk">Risk controls</a>
          <a href="/welcome#faq">FAQ</a>
          <Link to="/login">Sign in</Link>
        </nav>
      </div>
      <p className="site-risk muted small">
        Trading leveraged products such as forex, metals and indices carries a high level of risk and may not be suitable for everyone. Copy trading does not remove that risk. Only trade with money you can afford to lose.
      </p>
    </footer>
  );
}

// A frozen, clearly-labelled sample of the mirror board. Not connected to any account.
const SAMPLE = [
  { sym: 'XAUUSD', side: 'sell', lots: '0.50', pl: '+$440.00', copies: [['Alpha follower', '0.25', '+$220.00'], ['Scalp account', '0.10', '+$88.00'], ['Safe growth', '0.93', '+$818.40']] },
  { sym: 'GBPUSD', side: 'buy', lots: '0.80', pl: '+$264.00', copies: [['Alpha follower', '0.40', '+$132.00'], ['Scalp account', '0.10', '+$33.00'], ['Safe growth', '1.49', '+$491.70']] },
  { sym: 'EURUSD', side: 'buy', lots: '1.00', pl: '+$210.00', copies: [['Alpha follower', '0.50', '+$105.00'], ['Scalp account', '0.10', '+$21.00']] },
];

export function SampleBoard() {
  return (
    <div className="sample" aria-label="Sample mirror board">
      <div className="sample-bar">
        <span className="tags"><i className="dot dot-ok" /> <strong>Mirror board</strong></span>
        <span className="badge badge-accent">Sample data</span>
      </div>
      <div className="mirror">
        <div className="mirror-head">
          <div><h3>Main master</h3><span className="muted small">Master · 3 open</span></div>
          <div className="seam-cap" aria-hidden="true" />
          <div className="right"><h3>Followers</h3><span className="muted small">3 of 4 copying</span></div>
        </div>
        <ol className="mirror-rows">
          {SAMPLE.map((p) => (
            <li key={p.sym} className="mirror-row">
              <div className="side left">
                <div className="leg"><strong className="sym">{p.sym}</strong><SideBadge side={p.side} /><span className="num">{p.lots}</span></div>
                <div className="sub"><span className="num pl gain">{p.pl}</span></div>
              </div>
              <div className="seam" aria-hidden="true"><i /></div>
              <div className="side right">
                {p.copies.map(([who, lots, pl]) => (
                  <div key={who} className="copy"><span className="who">{who}</span><span className="num">{lots}</span><span className="num pl gain">{pl}</span></div>
                ))}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
