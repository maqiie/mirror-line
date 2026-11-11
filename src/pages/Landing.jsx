import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Eye, FileClock, KeyRound, Layers, Link2, ShieldCheck, SlidersHorizontal, Zap } from 'lucide-react';
import { SampleBoard, SiteFooter, SiteNav } from '../components/site';

const FEATURES = [
  { icon: Layers, title: 'One master, many followers', text: 'Trade on a single master account. Every linked follower on MT4 or MT5 opens, modifies and closes the same trade.' },
  { icon: SlidersHorizontal, title: 'Lot sizing per follower', text: 'Fixed lot, multiplier, balance ratio or risk per trade. Each follower sizes the trade the way you decide.' },
  { icon: Link2, title: 'Rules on every link', text: 'Reverse direction, cap slippage, map broker suffixes, filter symbols, copy pending orders and catch up on open trades.' },
  { icon: ShieldCheck, title: 'Risk guardrails', text: 'Five limits per follower are pushed to its EA: biggest trade, open trades, daily loss, margin level and spread.' },
  { icon: Zap, title: 'Pause and kill switch', text: 'Pause copying globally or per account. The kill switch stops one account at once without touching the others.' },
  { icon: FileClock, title: 'A log you can trust', text: 'Every order sent to an account is recorded with its result, so a copy that failed, expired or was skipped is never a mystery.' },
];

const STEPS = [
  { n: '01', icon: KeyRound, title: 'Connect your accounts', text: 'Add your master and followers. Each one gets a token for its Expert Advisor. You never enter a trading password.' },
  { n: '02', icon: Link2, title: 'Link master to followers', text: 'Choose how each follower copies: lot mode, direction, slippage and which symbols are allowed.' },
  { n: '03', icon: Eye, title: 'Trade once, watch it mirror', text: 'Open a trade on the master. The mirror board shows each follower’s copy arrive, with live profit on both sides.' },
];

const LIMITS = [
  ['Biggest single trade', 'The largest lot size the EA will open.'],
  ['Open trades at once', 'The most trades the EA will hold.'],
  ['Daily loss limit', 'Halts new trades for the day once the loss is reached.'],
  ['Lowest margin level', 'New trades are only allowed above this level.'],
  ['Widest spread', 'Trades wait while the spread is wider than this.'],
];

const FAQ = [
  ['Do you need my broker password?', 'No. Each account has a token. The Expert Advisor running in your terminal signs in with that token, and you never type a trading password into the dashboard.'],
  ['Which platforms are supported?', 'MetaTrader 4 and MetaTrader 5. A master and its followers can be on different platforms and different brokers.'],
  ['What happens when I turn on a kill switch?', 'The EA on that account receives a kill signal and the dashboard stops sending it orders. Turn it off to resume. Other accounts keep copying.'],
  ['What if a follower is offline or paused?', 'The mirror board shows exactly why a trade was not copied, for example offline, paused or kill switch, so you always know which follower is out of step.'],
  ['Does removing an account close its trades?', 'No. Removing an account deletes its copy links and stops commands reaching the EA. Trades already open at the broker are not closed.'],
];

function Spark() {
  return (
    <svg className="spark" viewBox="0 0 300 70" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#2fdc9a" stopOpacity=".3" /><stop offset="1" stopColor="#2fdc9a" stopOpacity="0" /></linearGradient>
      </defs>
      <path d="M0 58 L20 52 L40 55 L62 44 L84 48 L106 36 L128 40 L150 28 L172 33 L194 20 L216 24 L240 12 L270 16 L300 5 L300 70 L0 70Z" fill="url(#spark-fill)" />
      <path d="M0 58 L20 52 L40 55 L62 44 L84 48 L106 36 L128 40 L150 28 L172 33 L194 20 L216 24 L240 12 L270 16 L300 5" fill="none" stroke="#2fdc9a" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export default function Landing() {
  // honour #hash links when arriving from another page
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (id) setTimeout(() => document.getElementById(id)?.scrollIntoView(), 50);
    else window.scrollTo(0, 0);
  }, []);

  return (
    <div className="site">
      <SiteNav onLanding />

      <section className="site-hero">
        <div className="site-hero-copy">
          <span className="eyebrow"><i className="pulse" /> MT4 &amp; MT5 trade copier</span>
          <h1>Trade once.<br /><em>Every account follows.</em></h1>
          <p className="lead">Mirrorline copies your master account to as many follower accounts as you like, each sized and protected the way you choose. Watch every copy land in real time.</p>
          <div className="site-cta">
            <Link to="/login" className="btn btn-primary btn-lg">Sign in to your dashboard <ArrowRight size={16} /></Link>
            <a href="#how" className="btn btn-lg">See how it works</a>
          </div>
          <ul className="site-facts">
            <li><strong>MT4 + MT5</strong><span>Any broker</span></li>
            <li><strong>4 lot modes</strong><span>Per follower</span></li>
            <li><strong>5 risk limits</strong><span>Per follower</span></li>
            <li><strong>Kill switch</strong><span>Per account</span></li>
          </ul>
        </div>
        <div className="site-hero-art">
          <div className="glow" aria-hidden="true" />
          <div className="float float-a" aria-hidden="true"><span className="muted small">Combined equity</span><strong className="num">$195,174</strong><Spark /></div>
          <SampleBoard />
        </div>
      </section>

      <section className="site-sec" id="features">
        <div className="sec-head"><span className="eyebrow">Features</span><h2 className="sec-title">Everything a copier needs, nothing it doesn’t</h2></div>
        <div className="feat-grid">
          {FEATURES.map(({ icon: Icon, title, text }) => (
            <article key={title} className="feat">
              <span className="feat-ico"><Icon size={20} /></span>
              <h3>{title}</h3>
              <p className="muted">{text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="site-sec" id="how">
        <div className="sec-head"><span className="eyebrow">How it works</span><h2 className="sec-title">Live in three steps</h2></div>
        <ol className="steps-row">
          {STEPS.map(({ n, icon: Icon, title, text }) => (
            <li key={n} className="step-card">
              <span className="step-n">{n}</span>
              <Icon size={22} className="step-ico" />
              <h3>{title}</h3>
              <p className="muted">{text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="site-sec" id="risk">
        <div className="risk-band">
          <div>
            <span className="eyebrow">Risk controls</span>
            <h2 className="sec-title">Every follower has its own limits</h2>
            <p className="lead">Limits are sent to each follower’s EA within seconds and replace the EA’s own inputs, so a runaway day on the master can’t drain a smaller account.</p>
            <Link to="/login" className="btn btn-primary">Set your limits <ArrowRight size={15} /></Link>
          </div>
          <ul className="limit-list">
            {LIMITS.map(([t, d], i) => (
              <li key={t}><span className="num limit-n">0{i + 1}</span><div><strong>{t}</strong><p className="muted small">{d}</p></div></li>
            ))}
          </ul>
        </div>
      </section>

      <section className="site-sec narrow" id="faq">
        <div className="sec-head"><span className="eyebrow">FAQ</span><h2 className="sec-title">Good questions</h2></div>
        <div className="faq">
          {FAQ.map(([q, a]) => (
            <details key={q}><summary>{q}</summary><p className="muted">{a}</p></details>
          ))}
        </div>
      </section>

      <section className="site-sec">
        <div className="cta-band">
          <h2 className="sec-title">Ready to trade once and let the rest follow?</h2>
          <Link to="/login" className="btn btn-primary btn-lg">Sign in <ArrowRight size={16} /></Link>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
