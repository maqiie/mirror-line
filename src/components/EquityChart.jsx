import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Segmented } from './ui';
import { money, plClass } from '../lib/format';

const DAY = 86400000;
const PAD = { l: 14, r: 70, t: 22, b: 30 };
const MODES = [
  { value: 'equity', label: 'Equity' },
  { value: 'pnl', label: 'Daily P&L' },
  { value: 'dd', label: 'Drawdown' },
];
export const RANGES = [
  { value: 7, label: '7d' },
  { value: 30, label: '30d' },
  { value: 90, label: '90d' },
  { value: 0, label: 'All' },
];

const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
const kfmt = (n, sign) => `${n < 0 ? '−' : sign && n > 0 ? '+' : ''}$${compact.format(Math.abs(n))}`;
const pct = (n, dp = 2) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(dp)}%`;
const dShort = (t) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const dLong = (t) => new Date(t).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

// Round tick values that cover [lo, hi].
function niceTicks(lo, hi, count = 5) {
  const span = hi - lo || 1;
  const raw = span / (count - 1);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const start = Math.ceil(lo / step) * step;
  const out = [];
  for (let v = start; v <= hi + step * 1e-6; v += step) out.push(Math.abs(v) < step * 1e-6 ? 0 : v);
  return out;
}

// Smooth line through points that never overshoots between samples (monotone cubic).
function smooth(pts) {
  const n = pts.length;
  if (n < 3) return pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  const dx = [], m = [], t = new Array(n);
  for (let i = 0; i < n - 1; i++) { dx[i] = pts[i + 1][0] - pts[i][0] || 1; m[i] = (pts[i + 1][1] - pts[i][1]) / dx[i]; }
  t[0] = m[0]; t[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
    const a = t[i] / m[i], b = t[i + 1] / m[i], s = a * a + b * b;
    if (s > 9) { const k = 3 / Math.sqrt(s); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i]; }
  }
  let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += `C${(pts[i][0] + h).toFixed(1)} ${(pts[i][1] + t[i] * h).toFixed(1)} ${(pts[i + 1][0] - h).toFixed(1)} ${(pts[i + 1][1] - t[i + 1] * h).toFixed(1)} ${pts[i + 1][0].toFixed(1)} ${pts[i + 1][1].toFixed(1)}`;
  }
  return d;
}

function useWidth(ref) {
  const [w, setW] = useState(760);
  useEffect(() => {
    if (!ref.current) return undefined;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

export default function EquityChart({ points, days, onDays, live }) {
  const [mode, setMode] = useState('equity');
  const [hover, setHover] = useState(null);
  const [sel, setSel] = useState(null); // { a, b } indices being measured
  const [drag, setDrag] = useState(false);
  const [showPeak, setShowPeak] = useState(true);
  const wrap = useRef(null);
  const svg = useRef(null);
  const W = useWidth(wrap);
  const H = W < 520 ? 270 : 360;

  // ---- data for the chosen window, with running peak / drawdown / day change ----
  const data = useMemo(() => {
    const src = points.length ? points.map((p) => ({ ...p })) : [];
    if (live != null && src.length) src[src.length - 1].v = live;
    const cut = days ? Date.now() - days * DAY : 0;
    let first = src.findIndex((p) => p.t >= cut);
    if (first < 0) first = Math.max(0, src.length - 2);
    first = Math.min(first, Math.max(0, src.length - 2));
    const slice = src.slice(first);
    let peak = -Infinity;
    return slice.map((p, i) => {
      const prev = i ? slice[i - 1].v : first > 0 ? src[first - 1].v : p.v;
      peak = Math.max(peak, p.v);
      return { ...p, day: p.v - prev, dayPct: prev ? ((p.v - prev) / prev) * 100 : 0, peak, dd: p.v - peak, ddPct: ((p.v - peak) / peak) * 100 };
    });
  }, [points, days, live]);

  const stats = useMemo(() => {
    if (data.length < 2) return null;
    const start = data[0].v, end = data[data.length - 1].v;
    const days_ = data.slice(1);
    const best = days_.reduce((a, b) => (b.day > a.day ? b : a));
    const worst = days_.reduce((a, b) => (b.day < a.day ? b : a));
    const maxDD = data.reduce((a, b) => (b.ddPct < a.ddPct ? b : a));
    const peak = data.reduce((a, b) => (b.v > a.v ? b : a));
    const low = data.reduce((a, b) => (b.v < a.v ? b : a));
    const wins = days_.filter((d) => d.day > 0).length;
    return { start, end, change: end - start, pct: ((end - start) / start) * 100, best, worst, maxDD, peak, low, wins, total: days_.length };
  }, [data]);

  // ---- geometry ----
  const geo = useMemo(() => {
    if (!data.length) return null;
    const iw = W - PAD.l - PAD.r, ih = H - PAD.t - PAD.b;
    const t0 = data[0].t, t1 = data[data.length - 1].t;
    const n = data.length;
    const band = iw / n;
    const x = mode === 'pnl' ? (i) => PAD.l + band * (i + 0.5) : (i) => PAD.l + (i / Math.max(1, n - 1)) * iw;
    let lo, hi, val;
    if (mode === 'equity') {
      val = (d) => d.v;
      const vs = data.map((d) => d.v);
      lo = Math.min(...vs); hi = Math.max(...vs);
      if (hi === lo) { hi += 1; lo -= 1; }
      const s = hi - lo; lo -= s * 0.14; hi += s * 0.1;
    } else if (mode === 'pnl') {
      val = (d) => d.day;
      const ds = data.slice(1).map((d) => d.day);
      const m = Math.max(1, ...ds.map(Math.abs)) * 1.15;
      lo = -m; hi = m;
    } else {
      val = (d) => d.ddPct;
      lo = Math.min(-0.5, ...data.map((d) => d.ddPct)) * 1.18; hi = 0;
    }
    const y = (v) => PAD.t + (1 - (v - lo) / (hi - lo)) * ih;
    const ticks = niceTicks(lo, hi, H < 300 ? 4 : 5);
    const xt = [];
    const target = W < 520 ? 3 : 6;
    for (let k = 0; k < target; k++) xt.push(Math.round((k / (target - 1)) * (n - 1)));
    return { iw, ih, t0, t1, n, band, x, y, lo, hi, val, ticks, xt: [...new Set(xt)] };
  }, [data, mode, W, H]);

  // ---- paths ----
  const paths = useMemo(() => {
    if (!geo) return null;
    const { x, y, val } = geo;
    const base = H - PAD.b;
    const pts = data.map((d, i) => [x(i), y(val(d))]);
    const line = smooth(pts);
    const zero = mode === 'equity' ? base : y(0);
    const area = `${line} L${pts[pts.length - 1][0].toFixed(1)} ${zero} L${pts[0][0].toFixed(1)} ${zero} Z`;
    let shade = '';
    let peakLine = '';
    if (mode === 'equity') {
      const pk = data.map((d, i) => [x(i), y(d.peak)]);
      peakLine = pk.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
      shade = `${peakLine} ${pts.slice().reverse().map((p) => `L${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ')} Z`;
    }
    return { pts, line, area, shade, peakLine };
  }, [data, geo, mode, H]);

  const idxAt = useCallback((clientX) => {
    const r = svg.current.getBoundingClientRect();
    const px = ((clientX - r.left) / r.width) * W;
    const f = (px - PAD.l) / geo.iw;
    const i = mode === 'pnl' ? Math.floor(f * geo.n) : Math.round(f * (geo.n - 1));
    return Math.max(0, Math.min(geo.n - 1, i));
  }, [W, geo, mode]);

  const onDown = (e) => {
    if (e.button > 0) return;
    const i = idxAt(e.clientX);
    svg.current.setPointerCapture?.(e.pointerId);
    setDrag(true);
    setSel({ a: i, b: i });
    setHover(i);
  };
  const onMove = (e) => {
    const i = idxAt(e.clientX);
    setHover(i);
    if (drag) setSel((s) => (s ? { ...s, b: i } : s));
  };
  const onUp = () => {
    setDrag(false);
    setSel((s) => (s && s.a === s.b ? null : s));
  };
  const onKey = (e) => {
    const n = data.length;
    if (e.key === 'ArrowLeft') setHover((h) => Math.max(0, (h ?? n) - 1));
    else if (e.key === 'ArrowRight') setHover((h) => Math.min(n - 1, (h ?? -1) + 1));
    else if (e.key === 'Home') setHover(0);
    else if (e.key === 'End') setHover(n - 1);
    else if (e.key === 'Escape') { setSel(null); setHover(null); return; }
    else return;
    e.preventDefault();
  };
  useEffect(() => { setHover(null); setSel(null); }, [days, mode]);

  if (!geo || !stats) return <div className="chart chart-empty muted">Equity history will appear after the first sync.</div>;

  const { x, y } = geo;
  const up = stats.change >= 0;
  const hd = hover != null ? data[hover] : null;
  const selR = sel && sel.a !== sel.b ? [Math.min(sel.a, sel.b), Math.max(sel.a, sel.b)] : null;
  const selInfo = selR && {
    from: data[selR[0]], to: data[selR[1]],
    change: data[selR[1]].v - data[selR[0]].v,
    pct: ((data[selR[1]].v - data[selR[0]].v) / data[selR[0]].v) * 100,
    n: selR[1] - selR[0],
  };

  const fmtY = (v) => (mode === 'dd' ? `${v.toFixed(v > -10 ? 1 : 0)}%` : mode === 'pnl' ? kfmt(v, true) : kfmt(v));
  const tipLeft = hd ? Math.min(Math.max(x(hover), 96), W - PAD.r - 8) : 0;
  const tipFlip = hd ? x(hover) > W * 0.58 : false;
  const col = mode === 'dd' || !up ? 'var(--loss)' : 'var(--gain)';
  const lastX = x(data.length - 1);
  const lastY = y(geo.val(data[data.length - 1]));

  return (
    <figure className="chart" ref={wrap}>
      <div className="chart-bar">
        <Segmented label="Chart view" value={mode} onChange={setMode} options={MODES} />
        <div className="chart-bar-r">
          {mode === 'equity' && (
            <button type="button" className={`chip ${showPeak ? 'on' : ''}`} aria-pressed={showPeak} onClick={() => setShowPeak((s) => !s)}>
              <i aria-hidden="true" />Drawdown from peak
            </button>
          )}
          <Segmented label="Range" value={days} onChange={onDays} options={RANGES} />
        </div>
      </div>

      <div className="chart-stage">
        <svg
          ref={svg} width={W} height={H} viewBox={`0 0 ${W} ${H}`} tabIndex={0} role="application"
          aria-label={`Combined equity, ${money(stats.start, { whole: true })} to ${money(stats.end, { whole: true })}. Use arrow keys to inspect days, drag to measure a period.`}
          onMouseDown={(e) => e.preventDefault()} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
          onPointerLeave={() => !drag && setHover(null)} onKeyDown={onKey} onBlur={() => setHover(null)}
        >
          <defs>
            <linearGradient id="eq-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={col} stopOpacity=".30" />
              <stop offset="1" stopColor={col} stopOpacity="0" />
            </linearGradient>
            <linearGradient id="dd-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="var(--loss)" stopOpacity="0" />
              <stop offset="1" stopColor="var(--loss)" stopOpacity=".38" />
            </linearGradient>
            <clipPath id="plot"><rect x={PAD.l} y={PAD.t - 6} width={geo.iw} height={geo.ih + 12} /></clipPath>
          </defs>

          {geo.ticks.map((v) => (
            <g key={v} className={mode !== 'pnl' && Math.abs(y(v) - y(geo.val(data[data.length - 1]))) < 14 ? 'tick-hide' : ''}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} className={`grid ${v === 0 && mode !== 'equity' ? 'zero' : ''}`} />
              <text x={W - PAD.r + 10} y={y(v)} dy="0.32em" className="ytick">{fmtY(v)}</text>
            </g>
          ))}
          {geo.xt.map((i) => (
            <text key={i} x={x(i)} y={H - 8} textAnchor={i === 0 ? 'start' : i === geo.n - 1 ? 'end' : 'middle'} className="xtick">{dShort(data[i].t)}</text>
          ))}

          <g key={`${mode}-${days}`} clipPath="url(#plot)">
            {mode === 'equity' && (
              <>
                {showPeak && <path d={paths.shade} className="dd-shade" />}
                {showPeak && <path d={paths.peakLine} className="peak-line" />}
                <line x1={PAD.l} x2={W - PAD.r} y1={y(stats.start)} y2={y(stats.start)} className="start-line" />
                <path d={paths.area} fill="url(#eq-fill)" className="area-in" />
                <path d={paths.line} className={`line ${up ? 'up' : 'down'}`} pathLength="1" />
              </>
            )}
            {mode === 'pnl' && data.slice(1).map((d, k) => {
              const i = k + 1;
              const bw = Math.max(2, geo.band * 0.66);
              const y0 = y(0), y1 = y(d.day);
              return <rect key={d.t} x={x(i) - bw / 2} y={Math.min(y0, y1)} width={bw} height={Math.max(1.5, Math.abs(y1 - y0))} rx={Math.min(3, bw / 2)} className={`bar ${d.day >= 0 ? 'gain' : 'loss'} ${hover === i ? 'hot' : ''}`} />;
            })}
            {mode === 'dd' && (
              <>
                <path d={paths.area} fill="url(#dd-fill)" className="area-in" />
                <path d={paths.line} className="line down" pathLength="1" />
              </>
            )}

            {selR && (
              <rect x={x(selR[0])} y={PAD.t - 6} width={Math.max(1, x(selR[1]) - x(selR[0]))} height={geo.ih + 12} className="sel" />
            )}
          </g>

          {/* selective direct labels: peak, low, now */}
          {mode === 'equity' && !hd && (
            <>
              <g className="mark" transform={`translate(${x(data.indexOf(stats.peak))} ${y(stats.peak.v)})`}>
                <circle r="4" className="pt" />
                <text y="-11" textAnchor={x(data.indexOf(stats.peak)) > W - 130 ? 'end' : x(data.indexOf(stats.peak)) < 90 ? 'start' : 'middle'} className="mk">High {kfmt(stats.peak.v)}</text>
              </g>
              {stats.low !== data[0] && stats.low.v < stats.start && (
                <g className="mark" transform={`translate(${x(data.indexOf(stats.low))} ${y(stats.low.v)})`}>
                  <circle r="4" className="pt" />
                  <text y="19" textAnchor={x(data.indexOf(stats.low)) > W - 130 ? 'end' : x(data.indexOf(stats.low)) < 90 ? 'start' : 'middle'} className="mk">Low {kfmt(stats.low.v)}</text>
                </g>
              )}
            </>
          )}

          {mode === 'equity' && <text x={PAD.l + 2} y={y(stats.start) - 6} className="start-lbl">Start</text>}

          {/* end-of-line tag on the value axis */}
          {mode !== 'pnl' && (
            <g transform={`translate(${W - PAD.r + 4} ${lastY})`} className="tag">
              <rect y="-10" width={PAD.r - 6} height="20" rx="6" fill={col} />
              <text x={(PAD.r - 6) / 2} dy="0.34em" textAnchor="middle">{fmtY(geo.val(data[data.length - 1]))}</text>
            </g>
          )}
          {mode === 'equity' && (
            <g transform={`translate(${lastX} ${lastY})`}>
              <circle r="9" fill={col} opacity=".2" className="live-ring" />
              <circle r="4.5" fill={col} stroke="var(--pane)" strokeWidth="2" />
            </g>
          )}

          {hd && (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={PAD.t - 6} y2={H - PAD.b} className="cursor" />
              {mode !== 'pnl' && <circle cx={x(hover)} cy={y(geo.val(hd))} r="5.5" fill={col} stroke="var(--pane)" strokeWidth="2.5" />}
              <g transform={`translate(${x(hover)} ${H - PAD.b})`}>
                <rect x="-27" y="4" width="54" height="18" rx="5" className="xpill" />
                <text y="13" dy="0.34em" textAnchor="middle" className="xpill-t">{dShort(hd.t)}</text>
              </g>
            </g>
          )}
        </svg>

        {selInfo && (
          <div className={`measure ${plClass(selInfo.change)}`} style={{ left: `${Math.min(Math.max(((x(selR[0]) + x(selR[1])) / 2), 120), W - PAD.r - 120)}px` }}>
            <span className="num">{money(selInfo.change, { sign: true })}</span>
            <span className="num">{pct(selInfo.pct)}</span>
            <small>{dShort(selInfo.from.t)} to {dShort(selInfo.to.t)} · {selInfo.n} day{selInfo.n === 1 ? '' : 's'}</small>
            <button type="button" aria-label="Clear measurement" onPointerDown={(e) => e.stopPropagation()} onClick={() => setSel(null)}>×</button>
          </div>
        )}

        {hd && !drag && !selInfo && (
          <div className={`tip ${tipFlip ? 'flip' : ''}`} style={{ left: `${tipLeft}px` }} role="status">
            <div className="tip-date">{dLong(hd.t)}{hover === data.length - 1 && <em>Now</em>}</div>
            <div className="tip-main num">{money(hd.v)}</div>
            <dl>
              <dt>Day</dt><dd className={`num ${plClass(hd.day)}`}>{hover === 0 ? '—' : `${money(hd.day, { sign: true })} · ${pct(hd.dayPct)}`}</dd>
              <dt>Since start</dt><dd className={`num ${plClass(hd.v - stats.start)}`}>{money(hd.v - stats.start, { sign: true })} · {pct(((hd.v - stats.start) / stats.start) * 100)}</dd>
              <dt>From peak</dt><dd className={`num ${hd.dd < 0 ? 'loss' : 'gain'}`}>{hd.dd < 0 ? `${money(hd.dd)} · ${pct(hd.ddPct)}` : 'At a new high'}</dd>
            </dl>
          </div>
        )}
      </div>
      <p className="chart-hint" aria-hidden="true">Hover or use arrow keys to inspect a day. Drag across the chart to measure a period.</p>

      <dl className="kpis">
        <div><dt>Return</dt><dd className={`num ${plClass(stats.change)}`}>{pct(stats.pct)}</dd><small className="num">{money(stats.change, { sign: true, whole: true })}</small></div>
        <div><dt>Max drawdown</dt><dd className="num loss">{stats.maxDD.ddPct < 0 ? pct(stats.maxDD.ddPct) : '0.00%'}</dd><small className="num">{stats.maxDD.ddPct < 0 ? dShort(stats.maxDD.t) : 'none'}</small></div>
        <div><dt>Best day</dt><dd className="num gain">{money(stats.best.day, { sign: true, whole: true })}</dd><small className="num">{dShort(stats.best.t)}</small></div>
        <div><dt>Worst day</dt><dd className="num loss">{money(stats.worst.day, { sign: true, whole: true })}</dd><small className="num">{dShort(stats.worst.t)}</small></div>
        <div>
          <dt>Winning days</dt>
          <dd className="num">{stats.wins}<em>/{stats.total}</em></dd>
          <div className="winbar" aria-hidden="true"><i style={{ width: `${(stats.wins / stats.total) * 100}%` }} /></div>
        </div>
      </dl>

      <table className="sr">
        <caption>Combined equity by day</caption>
        <thead><tr><th>Date</th><th>Equity</th><th>Day change</th><th>From peak</th></tr></thead>
        <tbody>{data.map((d) => <tr key={d.t}><td>{dLong(d.t)}</td><td>{money(d.v)}</td><td>{money(d.day, { sign: true })}</td><td>{money(d.dd)}</td></tr>)}</tbody>
      </table>
    </figure>
  );
}
