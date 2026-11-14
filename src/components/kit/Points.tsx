'use client';

import { useEffect, useRef, useState } from 'react';
import { RollingNumber } from './RollingNumber';
import { sound } from './sound';
import { useKit } from './strings';
import type { Surface } from './types';
import st from './rewards.module.css';

const LANDED = 'irr:points-landed';

export function Coin({ size = 18 }: { size?: number }) {
  return <span className={st.coin} style={{ width: size, height: size }} aria-hidden="true" />;
}

/** Header balance. Marked as the landing target for flyPoints; bumps when coins arrive. */
export function PointsCounter({ value, surface = 'paper', label }: { value: number; surface?: Surface; label?: string }) {
  const { s } = useKit();
  const ref = useRef<HTMLSpanElement>(null);
  const [bump, setBump] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const on = () => setBump((b) => b + 1);
    el.addEventListener(LANDED, on);
    return () => el.removeEventListener(LANDED, on);
  }, []);
  return (
    <span ref={ref} className={st.points} data-surface={surface} data-points-target="" data-bump={bump % 2 ? 'a' : bump ? 'b' : undefined} aria-live="polite">
      <Coin />
      <RollingNumber value={value} className={st.pointsV} />
      <span className={st.pointsK}>{label ?? s.points}</span>
    </span>
  );
}

/**
 * Coins fly from the control that earned them to the header counter along an arc (600 ms),
 * then the counter bumps. Resolves when they land, so the screen can update the balance then.
 */
export function flyPoints(fromEl: Element | null, amount: number): Promise<void> {
  if (typeof window === 'undefined' || !fromEl) return Promise.resolve();
  const targets = Array.from(document.querySelectorAll<HTMLElement>('[data-points-target]'));
  const target = targets.find((t) => {
    const r = t.getBoundingClientRect();
    return r.width > 0 && r.bottom > 0 && r.top < window.innerHeight;
  }) ?? targets[0];
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!target || reduce) {
    target?.dispatchEvent(new CustomEvent(LANDED, { detail: { amount } }));
    sound.play('points');
    return Promise.resolve();
  }
  const a = fromEl.getBoundingClientRect();
  const coinEl = target.querySelector(`.${st.coin}`) ?? target;
  const b = coinEl.getBoundingClientRect();
  const x0 = a.left + a.width / 2;
  const y0 = a.top + a.height / 2;
  const x1 = b.left + b.width / 2;
  const y1 = b.top + b.height / 2;
  const n = Math.min(7, Math.max(3, Math.round(amount / 12)));
  const lift = Math.min(220, 80 + Math.abs(x1 - x0) * 0.25);

  const flights = Array.from({ length: n }, (_, i) => {
    const el = document.createElement('span');
    el.className = st.coin;
    el.style.cssText = `position:fixed;left:0;top:0;width:18px;height:18px;z-index:1000;pointer-events:none;margin:-9px 0 0 -9px`;
    document.body.appendChild(el);
    const spread = (i - (n - 1) / 2) * 14;
    const cx = (x0 + x1) / 2 + spread;
    const cy = Math.min(y0, y1) - lift - Math.abs(spread);
    const frames: Keyframe[] = [];
    for (let k = 0; k <= 10; k++) {
      const t = k / 10;
      const x = (1 - t) ** 2 * (x0 + spread * 0.4) + 2 * (1 - t) * t * cx + t * t * x1;
      const y = (1 - t) ** 2 * y0 + 2 * (1 - t) * t * cy + t * t * y1;
      const sc = k === 0 ? 0.4 : k === 10 ? 0.6 : 1 + Math.sin(t * Math.PI) * 0.25;
      frames.push({ transform: `translate(${x}px, ${y}px) scale(${sc})`, opacity: k === 0 ? 0 : 1 });
    }
    const anim = el.animate(frames, { duration: 600, delay: i * 45, easing: 'cubic-bezier(.45,0,.4,1)', fill: 'both' });
    return anim.finished.then(() => el.remove());
  });

  return new Promise((resolve) => {
    window.setTimeout(() => sound.play('points'), 560);
    Promise.all(flights).then(() => {
      target.dispatchEvent(new CustomEvent(LANDED, { detail: { amount } }));
      resolve();
    });
  });
}

/** Seven days of the week; practised days are apricot tiles, today has a ring. */
export function StreakWeek({ done, today = 6, surface = 'paper', count }: { done: boolean[]; today?: number; surface?: Surface; count?: number }) {
  const { s, num } = useKit();
  const n = count ?? done.filter(Boolean).length;
  return (
    <div className={st.streak} data-surface={surface} role="img" aria-label={`${num(n)} / 7`}>
      <div className={st.streakN}>
        <span>{num(n)}</span>
        <small>/ 7</small>
      </div>
      <ol className={st.days}>
        {s.streakDays.map((d, i) => (
          <li key={i} data-done={done[i] || undefined} data-today={i === today || undefined} style={{ animationDelay: `${i * 60}ms` }}>
            <i />
            <span title={i === today ? s.today : undefined}>{d}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
