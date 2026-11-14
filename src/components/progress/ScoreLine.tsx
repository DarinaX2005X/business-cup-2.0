'use client';

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useT } from '@/i18n/client';
import type { ScorePoint } from '@/server/progress/types';
import { dayDate, say, shortDay } from './api';
import st from './progress.module.css';

const PAD = { l: 36, r: 16, t: 20, b: 30 };

/** Lower and upper bound of the value axis: the data with a margin, at least 10 points tall, inside 0–100. */
function range(values: number[]): [number, number] {
  let lo = Math.floor(Math.min(...values) - 3);
  let hi = Math.ceil(Math.max(...values) + 3);
  if (hi - lo < 10) {
    const mid = (hi + lo) / 2;
    lo = Math.floor(mid - 5);
    hi = Math.ceil(mid + 5);
  }
  if (lo < 0) [lo, hi] = [0, Math.max(hi - lo, 10)];
  if (hi > 100) [lo, hi] = [Math.max(0, lo - (hi - 100)), 100];
  return [lo, hi];
}

/**
 * The score line on the violet field: one point per week map, per finished rep and for the latest change
 * of the week, at even spacing in time order. The value axis is cut to the data (its two labelled guides
 * say where), the line draws itself once, and the selected point's reason reads out under the chart.
 * Pointer, touch and arrow keys move the selection; the newest point is selected at first.
 */
export function ScoreLine({ points, height = 210 }: { points: ScorePoint[]; height?: number }) {
  const { t, f, locale } = useT();
  const box = useRef<HTMLDivElement>(null);
  const strips = useRef<(HTMLButtonElement | null)[]>([]);
  const [w, setW] = useState(0);
  const [sel, setSel] = useState(points.length - 1);
  const uid = useId().replace(/:/g, '');

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // A new point (a rep finished in another tab) selects itself.
  useEffect(() => setSel(points.length - 1), [points.length]);

  const geo = useMemo(() => {
    if (!w || !points.length) return null;
    const [lo, hi] = range(points.map((p) => p.exact));
    const plotW = Math.max(10, w - PAD.l - PAD.r);
    const plotH = height - PAD.t - PAD.b;
    const n = points.length;
    const x = (i: number) => (n === 1 ? PAD.l + plotW / 2 : PAD.l + (i / (n - 1)) * plotW);
    const y = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo)) * plotH;
    const xy = points.map((p, i) => ({ x: x(i), y: y(p.exact) }));
    const d = xy.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    const guides = [lo, Math.round((lo + hi) / 2), hi];
    const strip = n === 1 ? plotW : plotW / (n - 1);
    // date ticks: first, last and a middle one when there is room, never two for the same day
    const ticks = [0, n - 1, ...(n >= 5 && plotW > 360 ? [Math.round((n - 1) / 2)] : [])].filter((i, k, a) => a.indexOf(i) === k);
    const tickDays = new Set<string>();
    const shownTicks = ticks
      .sort((a, b) => a - b)
      .filter((i) => {
        if (tickDays.has(points[i].day)) return false;
        tickDays.add(points[i].day);
        return true;
      });
    return { lo, hi, plotW, xy, d, guides, y, strip, shownTicks };
  }, [w, points, height]);

  const s = Math.max(0, Math.min(sel, points.length - 1));
  const cur = points[s];

  const onKey = (e: KeyboardEvent) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : e.key === 'Home' ? -Infinity : e.key === 'End' ? Infinity : 0;
    if (!step) return;
    e.preventDefault();
    const next = Math.max(0, Math.min(points.length - 1, Number.isFinite(step) ? s + step : step > 0 ? points.length - 1 : 0));
    setSel(next);
    strips.current[next]?.focus();
  };

  const label = (p: ScorePoint) => t('progress.score.pointLabel', { date: dayDate(f, p.day), score: p.score, reason: say(t, p.reason) });

  return (
    <figure className={st.line}>
      <figcaption className="sr-only">{t('progress.score.chart')}</figcaption>
      <div ref={box} className={st.lineBox} style={{ height }}>
        {geo ? (
          <>
            <svg width={w} height={height} className={st.lineSvg} aria-hidden="true">
              <defs>
                <radialGradient id={`${uid}pt`} cx="35%" cy="30%" r="75%">
                  <stop offset="0" style={{ stopColor: 'var(--apricot-hi)' }} />
                  <stop offset="0.55" style={{ stopColor: 'var(--apricot)' }} />
                  <stop offset="1" style={{ stopColor: 'var(--apricot-low)' }} />
                </radialGradient>
              </defs>
              {geo.guides.map((v) => (
                <g key={v}>
                  <line x1={PAD.l} x2={PAD.l + geo.plotW} y1={geo.y(v)} y2={geo.y(v)} className={st.lineGuide} />
                  <text x={PAD.l - 10} y={geo.y(v) + 4} textAnchor="end" className={st.lineTick}>
                    {f.integer(v)}
                  </text>
                </g>
              ))}
              {cur ? <line x1={geo.xy[s].x} x2={geo.xy[s].x} y1={geo.xy[s].y} y2={height - PAD.b + 4} className={st.lineCursor} /> : null}
              <path d={geo.d} pathLength={1} className={st.linePath} />
              {points.map((p, i) => {
                const { x, y } = geo.xy[i];
                const on = i === s;
                const delay = `${Math.round((i / Math.max(1, points.length - 1)) * 700) + 150}ms`;
                if (p.kind !== 'rep') {
                  return <circle key={p.id} cx={x} cy={y} r={on ? 7.5 : 6} className={st.lineMap} data-edit={p.kind === 'edit' || undefined} style={{ animationDelay: delay }} />;
                }
                return (
                  <g key={p.id} className={st.lineDot} data-on={on || undefined} style={{ animationDelay: delay, transformOrigin: `${x}px ${y}px` }}>
                    <circle cx={x} cy={y} r={on ? 9 : 7} className={st.lineDotRing} />
                    <circle cx={x} cy={y} r={on ? 6.5 : 5} fill={`url(#${uid}pt)`} />
                  </g>
                );
              })}
              {geo.shownTicks.map((i) => (
                <text
                  key={i}
                  x={geo.xy[i].x}
                  y={height - 8}
                  textAnchor={points.length === 1 ? 'middle' : i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'}
                  className={st.lineTick}
                >
                  {shortDay(locale, points[i].day)}
                </text>
              ))}
            </svg>
            <div className={st.lineStrips} role="group" aria-label={t('progress.score.chart')} onKeyDown={onKey}>
              {points.map((p, i) => (
                <button
                  key={p.id}
                  ref={(el) => {
                    strips.current[i] = el;
                  }}
                  type="button"
                  className={st.lineStrip}
                  style={{ left: geo.xy[i].x - geo.strip / 2, width: geo.strip, top: PAD.t - 12, bottom: PAD.b - 8 }}
                  tabIndex={i === s ? 0 : -1}
                  aria-pressed={i === s}
                  aria-label={label(p)}
                  onPointerEnter={(e) => e.pointerType === 'mouse' && setSel(i)}
                  onFocus={() => setSel(i)}
                  onClick={() => setSel(i)}
                />
              ))}
            </div>
          </>
        ) : null}
      </div>
      {cur ? <Readout point={cur} /> : null}
    </figure>
  );
}

/** What the selected point means, under the chart. */
function Readout({ point }: { point: ScorePoint }) {
  const { t, f } = useT();
  const title =
    point.kind === 'rep'
      ? `${t(`progress.type.${point.type}`)}${point.taskShort ? `, ${point.taskShort}` : ''}`
      : point.kind === 'map'
        ? t('progress.score.start')
        : t('progress.score.edit');
  const move = point.kind === 'rep' && point.before !== undefined ? t('progress.score.move', { from: point.before, to: point.score }) : f.integer(point.score);
  return (
    <div className={st.readout} aria-live="polite">
      <span className={st.readDate}>{dayDate(f, point.day)}</span>
      <span className={st.readMain}>
        <b>{title}</b>
        <span>{say(t, point.reason)}</span>
      </span>
      <span className={st.readMove}>{move}</span>
    </div>
  );
}

/** Before the first rep: the outline of the line that will grow here. */
export function ScoreLineEmpty({ height = 210 }: { height?: number }) {
  const { t } = useT();
  return (
    <div className={st.lineEmpty} style={{ height }}>
      <svg viewBox="0 0 600 200" preserveAspectRatio="none" aria-hidden="true">
        <line x1="0" x2="600" y1="170" y2="170" className={st.lineGuide} />
        <path d="M18 160 C 120 150, 170 128, 250 118 S 400 70, 470 58 S 560 34, 590 26" className={st.emptyPath} vectorEffect="non-scaling-stroke" />
      </svg>
      <span>{t('progress.empty.chart')}</span>
    </div>
  );
}
