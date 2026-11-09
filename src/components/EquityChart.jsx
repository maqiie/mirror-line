import { useMemo, useRef, useState } from 'react';
import { money } from '../lib/format';

const W = 760;
const H = 220;
const PAD = { l: 8, r: 8, t: 14, b: 26 };

export default function EquityChart({ points, days }) {
  const [hover, setHover] = useState(null);
  const svg = useRef(null);

  const data = useMemo(() => {
    const cut = days ? Date.now() - days * 86400000 : 0;
    const d = points.filter((p) => p.t >= cut);
    return d.length >= 2 ? d : points.slice(-2);
  }, [points, days]);

  const geo = useMemo(() => {
    const ts = data.map((p) => p.t);
    const vs = data.map((p) => p.v);
    const [t0, t1] = [Math.min(...ts), Math.max(...ts)];
    let [lo, hi] = [Math.min(...vs), Math.max(...vs)];
    if (hi === lo) { hi += 1; lo -= 1; }
    const span = hi - lo;
    lo -= span * 0.12; hi += span * 0.08;
    const x = (t) => PAD.l + ((t - t0) / Math.max(1, t1 - t0)) * (W - PAD.l - PAD.r);
    const y = (v) => PAD.t + (1 - (v - lo) / (hi - lo)) * (H - PAD.t - PAD.b);
    const line = data.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)} ${y(p.v).toFixed(1)}`).join(' ');
    const area = `${line} L${x(t1).toFixed(1)} ${H - PAD.b} L${x(t0).toFixed(1)} ${H - PAD.b} Z`;
    const ticks = [0, 0.5, 1].map((f) => t0 + (t1 - t0) * f);
    return { x, y, line, area, ticks, lo, hi };
  }, [data]);

  const up = data[data.length - 1].v >= data[0].v;
  const move = (e) => {
    const r = svg.current.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    let best = 0;
    data.forEach((p, i) => { if (Math.abs(geo.x(p.t) - px) < Math.abs(geo.x(data[best].t) - px)) best = i; });
    setHover(best);
  };
  const h = hover != null ? data[hover] : null;
  const fmtDate = (t) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

  return (
    <figure className="chart" aria-label={`Combined equity, ${money(data[0].v, { whole: true })} to ${money(data[data.length - 1].v, { whole: true })}`}>
      <svg ref={svg} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" onPointerMove={move} onPointerLeave={() => setHover(null)} role="img">
        <defs>
          <linearGradient id="eq-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={up ? 'var(--gain)' : 'var(--loss)'} stopOpacity=".22" />
            <stop offset="1" stopColor={up ? 'var(--gain)' : 'var(--loss)'} stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((f) => <line key={f} x1={PAD.l} x2={W - PAD.r} y1={PAD.t + f * (H - PAD.t - PAD.b)} y2={PAD.t + f * (H - PAD.t - PAD.b)} className="grid" />)}
        <path d={geo.area} fill="url(#eq-fill)" />
        <path d={geo.line} className={`line ${up ? 'up' : 'down'}`} vectorEffect="non-scaling-stroke" />
        {h && <line x1={geo.x(h.t)} x2={geo.x(h.t)} y1={PAD.t} y2={H - PAD.b} className="cursor" vectorEffect="non-scaling-stroke" />}
      </svg>
      {h && (
        <div className="tip" style={{ left: `${(geo.x(h.t) / W) * 100}%`, top: `${(geo.y(h.v) / H) * 100}%` }}>
          <strong className="num">{money(h.v)}</strong>
          <span>{fmtDate(h.t)}</span>
        </div>
      )}
      <figcaption className="axis">
        {geo.ticks.map((t) => <span key={t}>{fmtDate(t)}</span>)}
      </figcaption>
    </figure>
  );
}
