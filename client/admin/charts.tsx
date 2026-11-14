// Revenue & profit charts (#17). One shared y-axis (both series are money), thin rounded
// bars anchored to the baseline, a 2px profit line with ringed markers, a crosshair tooltip,
// a legend, a direct label on the latest value, and a table view for accessibility.
import { useEffect, useRef, useState } from 'preact/hooks';
import { money } from '../lib/ui';

export interface Point { key: string; label: string; revenue: number; costs: number; profit: number; jobs: number }

function niceMax(v: number): number {
  if (v <= 0) return 10000;
  const exp = 10 ** Math.floor(Math.log10(v));
  const f = v / exp;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * exp;
}

export function ComboChart({ data, currency, showProfit = true, height = 240, title }: { data: Point[]; currency: string; showProfit?: boolean; height?: number; title: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  // Draw at the container's real pixel width so text stays a constant size.
  const [W, setW] = useState(640);
  useEffect(() => {
    if (!wrap.current) return;
    const ro = new ResizeObserver(([entry]) => entry && setW(Math.max(280, Math.round(entry.contentRect.width))));
    ro.observe(wrap.current);
    return () => ro.disconnect();
  }, [table]);
  const H = height;
  const pad = { l: 46, r: 14, t: 14, b: 26 };
  const values = data.flatMap((d) => (showProfit ? [d.revenue, d.profit] : [d.revenue]));
  const max = niceMax(Math.max(0, ...values));
  const minRaw = Math.min(0, ...values);
  const min = minRaw < 0 ? -niceMax(-minRaw) : 0;
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const y = (v: number) => pad.t + ih - ((v - min) / (max - min)) * ih;
  const band = iw / Math.max(1, data.length);
  const bw = Math.max(4, Math.min(28, band * 0.5));
  const x = (i: number) => pad.l + band * i + band / 2;
  const ticks = Array.from({ length: 5 }, (_, i) => min + ((max - min) * i) / 4);
  const short = (v: number) => (Math.abs(v) >= 100000 ? `${Math.round(v / 100000) / 10}k` : `${Math.round(v / 100)}`);
  const linePath = data.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d.profit).toFixed(1)}`).join(' ');
  const last = data.length - 1;
  const hasData = data.some((d) => d.revenue || d.costs);

  if (table) {
    return (
      <div>
        <div class="spread" style="margin-bottom:8px"><span class="faint mono" style="font-size:.72rem">{title.toUpperCase()}</span><button class="btn btn-sm btn-ghost" type="button" onClick={() => setTable(false)}>View chart</button></div>
        <div class="dtable-wrap" style="max-height:300px"><table class="dtable"><thead><tr><th>Period</th><th class="num">Revenue</th><th class="num">Costs</th><th class="num">Profit</th><th class="num">Jobs</th></tr></thead>
          <tbody>{data.map((d) => <tr style="cursor:default"><td>{d.label}</td><td class="num">{money(d.revenue, currency)}</td><td class="num">{money(d.costs, currency)}</td><td class="num">{money(d.profit, currency)}</td><td class="num">{d.jobs}</td></tr>)}</tbody></table></div>
      </div>
    );
  }

  return (
    <div class="chart" ref={wrap}>
      <div class="spread" style="align-items:flex-start">
        {showProfit ? <div class="chart-legend"><span><i style="background:var(--series-1)" />Revenue (completed jobs)</span><span><i class="line" style="background:var(--series-2)" />Profit after costs</span></div> : <div class="chart-legend"><span class="faint">Revenue from completed jobs</span></div>}
        <button class="btn btn-sm btn-ghost" type="button" onClick={() => setTable(true)}>Table</button>
      </div>
      {!hasData && <p class="faint" style="font-size:.84rem;margin:4px 0 0">No completed jobs in this period yet — bars appear as jobs are completed.</p>}
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title} onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g>
            <line class="grid-line" x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} style={t === 0 ? 'stroke:var(--line-3)' : ''} />
            <text class="axis-label" x={pad.l - 8} y={y(t) + 3.5} text-anchor="end">{short(t)}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const top = y(Math.max(0, d.revenue));
          const h = Math.max(0, y(0) - top);
          const r = Math.min(4, h / 2, bw / 2);
          // Bar with 4px rounded top, square at the baseline.
          const path = h > 0 ? `M${x(i) - bw / 2},${y(0)} V${top + r} Q${x(i) - bw / 2},${top} ${x(i) - bw / 2 + r},${top} H${x(i) + bw / 2 - r} Q${x(i) + bw / 2},${top} ${x(i) + bw / 2},${top + r} V${y(0)} Z` : '';
          return <path class="bar-1" d={path} opacity={hover == null || hover === i ? 1 : 0.55} />;
        })}
        {showProfit && data.length > 1 && <path class="line-2" d={linePath} />}
        {showProfit && data.map((d, i) => (hover === i || i === last) && <circle class="dot-2" cx={x(i)} cy={y(d.profit)} r={4.5} />)}
        {showProfit && data.length > 0 && hover == null && <text class="value-label" x={x(last) - 8} y={y(data[last]!.profit) - 10} text-anchor="end">{money(data[last]!.profit, currency)}</text>}
        {data.map((d, i) => (data.length <= 14 || i % Math.ceil(data.length / 12) === 0) && <text class="axis-label" x={x(i)} y={H - 8} text-anchor="middle">{d.label}</text>)}
        {hover != null && <line class="crosshair" x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + ih} />}
        {data.map((_, i) => <rect class="hit" x={pad.l + band * i} y={pad.t} width={band} height={ih} onMouseEnter={() => setHover(i)} onTouchStart={() => setHover(i)} />)}
      </svg>
      {hover != null && data[hover] && (
        <div class="chart-tip" style={{ left: `${(x(hover) / W) * 100}%`, top: `${(Math.min(y(data[hover]!.revenue), y(Math.max(0, data[hover]!.profit))) / H) * 100}%` }}>
          <b>{data[hover]!.label}</b>
          <div class="row"><span><i style="display:inline-block;width:9px;height:9px;border-radius:2px;background:var(--series-1);margin-right:6px" />Revenue</span><span>{money(data[hover]!.revenue, currency)}</span></div>
          {showProfit && <div class="row"><span class="muted">Costs</span><span>{money(data[hover]!.costs, currency)}</span></div>}
          {showProfit && <div class="row"><span><i style="display:inline-block;width:12px;height:2px;background:var(--series-2);margin-right:6px;vertical-align:3px" />Profit</span><span>{money(data[hover]!.profit, currency)}</span></div>}
          <div class="row"><span class="muted">Jobs</span><span>{data[hover]!.jobs}</span></div>
        </div>
      )}
    </div>
  );
}

/** Ranked horizontal bars with the value as text (single series, no legend needed). */
export function HBars({ rows, currency, format }: { rows: { label: string; value: number; sub?: string }[]; currency?: string; format?: (v: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  const fmt = format ?? ((v: number) => money(v, currency ?? 'GBP'));
  if (!rows.length) return <p class="faint" style="font-size:.86rem">Nothing to show yet.</p>;
  return (
    <div>
      {rows.map((r) => (
        <div class="hbar" title={`${r.label}: ${fmt(r.value)}`}>
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{r.label}{r.sub && <span class="faint"> · {r.sub}</span>}</span>
          <span class="val">{fmt(r.value)}</span>
          <div class="track"><div class="fill" style={{ width: `${(r.value / max) * 100}%` }} /></div>
        </div>
      ))}
    </div>
  );
}
