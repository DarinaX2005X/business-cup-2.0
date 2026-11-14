'use client';

import { useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { RollingNumber } from './RollingNumber';
import { useKit } from './strings';
import type { Category, Surface, WeekTask } from './types';
import { groupWeek, hoursOf, WEEK_HOURS } from './week';
import { sound } from './sound';
import st from './WeekBar.module.css';

export interface WeekBarProps {
  tasks: WeekTask[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  /** `auto` turns vertical when the bar's container is narrower than 560 px. */
  orientation?: 'horizontal' | 'vertical' | 'auto';
  /** Plays the scan: a light beam crosses the bar in 1.8 s and each tile settles into its material as it passes. */
  scanning?: boolean;
  /** Widths follow share changes smoothly (220 ms). */
  editable?: boolean;
  /** While a share is being dragged, labels step aside so the widths read clearly. */
  dragging?: boolean;
  /** Practice growth per human-edge task, 0..1: the tile grows taller and gains layers. */
  growth?: Record<string, number>;
  variant?: Surface;
  /** Category totals over their part of the bar. */
  totals?: boolean;
  totalHours?: number;
  /** Text inside the empty bar before a week exists. */
  emptyLabel?: string;
  ariaLabel?: string;
  className?: string;
}

const tileClass: Record<Category, string> = {
  ai_does: st.tAi,
  ai_speeds: st.tSp,
  human_edge: st.tHu,
  no_data: st.tNd,
};

export function WeekBar({
  tasks,
  selectedId = null,
  onSelect,
  orientation = 'auto',
  scanning = false,
  editable = false,
  dragging = false,
  growth,
  variant = 'paper',
  totals = true,
  totalHours = WEEK_HOURS,
  emptyLabel,
  ariaLabel,
  className,
}: WeekBarProps) {
  const { s, hours, num, locale } = useKit();
  const groups = useMemo(() => groupWeek(tasks, totalHours), [tasks, totalHours]);

  // Where each tile sits along the bar (0..1), so the beam can hand it its material on time.
  const positions = useMemo(() => {
    const map = new Map<string, number>();
    let acc = 0;
    for (const g of groups)
      for (const t of g.tasks) {
        map.set(t.id, (acc + t.share / 2) / 100);
        acc += t.share;
      }
    return map;
  }, [groups]);

  const hasGrowth = !!growth && Object.values(growth).some((v) => v > 0);

  // One Tab stop for the whole bar; arrows move between tiles (roving tabindex), Enter selects.
  const order = useMemo(() => groups.flatMap((g) => g.tasks.map((t) => t.id)), [groups]);
  const [focusId, setFocusId] = useState<string | null>(null);
  const tabStop = focusId && order.includes(focusId) ? focusId : selectedId && order.includes(selectedId) ? selectedId : order[0];
  const btns = useRef(new Map<string, HTMLButtonElement>());
  const onTileKey = (e: KeyboardEvent<HTMLButtonElement>, id: string) => {
    const i = order.indexOf(id);
    const k = e.key;
    const next =
      k === 'ArrowRight' || k === 'ArrowDown' ? Math.min(order.length - 1, i + 1) : k === 'ArrowLeft' || k === 'ArrowUp' ? Math.max(0, i - 1) : k === 'Home' ? 0 : k === 'End' ? order.length - 1 : -1;
    if (next < 0) return;
    e.preventDefault();
    const nid = order[next];
    setFocusId(nid);
    btns.current.get(nid)?.focus();
  };

  // Keep the full-text tooltip inside the viewport.
  const placeTip = (li: HTMLElement) => {
    const tip = li.querySelector<HTMLElement>('[data-tip]');
    if (!tip) return;
    tip.style.setProperty('--dx', '0px');
    const r = tip.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const dx = r.right > vw - 12 ? vw - 12 - r.right : r.left < 12 ? 12 - r.left : 0;
    tip.style.setProperty('--dx', `${Math.round(dx)}px`);
  };

  if (tasks.length === 0) {
    return (
      <div className={`${st.wrap} ${className ?? ''}`} data-variant={variant}>
        <div className={st.empty} role="img" aria-label={emptyLabel ?? s.category.no_data}>
          <div className={st.emptyTile}>{emptyLabel ? <span>{emptyLabel}</span> : null}</div>
          <div className={st.ticks} aria-hidden="true">
            {[0, 10, 20, 30, 40].map((h) => (
              <span key={h} style={{ left: `${(h / 40) * 100}%` }}>
                {s.hoursShort(num(h))}
              </span>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`${st.wrap} ${className ?? ''}`} data-variant={variant} lang={locale}>
      <div
        className={st.root}
        data-orient={orientation}
        data-scanning={scanning || undefined}
        data-editable={editable || undefined}
        data-dragging={dragging || undefined}
        data-selecting={selectedId ? true : undefined}
        data-grown={hasGrowth || undefined}
        data-totals={totals || undefined}
      >
        <ul className={st.bar} role="list" aria-label={ariaLabel}>
          {groups.map((g) => (
            <li key={g.category} className={st.grp} data-cat={g.category} style={{ '--w': g.share } as CSSProperties}>
              {totals ? (
                <div className={st.head}>
                  {g.category !== 'no_data' ? (
                    <div className={st.hv}>
                      <RollingNumber value={g.hours} digits={1} from={scanning ? 0 : undefined} delay={scanning ? 1750 : 0} duration={900} />
                      <small>{s.hoursUnit}</small>
                    </div>
                  ) : null}
                  <div className={st.hk}>
                    <span>{s.category[g.category]}</span>
                    {g.category !== 'no_data' ? <em>{num(g.share)}%</em> : null}
                  </div>
                </div>
              ) : null}
              <ul className={st.segs} role="list">
                {g.tasks.map((t) => {
                  const h = hoursOf(t.share, totalHours);
                  const selected = t.id === selectedId;
                  const grow = g.category === 'human_edge' ? (growth?.[t.id] ?? 0) : 0;
                  const label = `${t.label}, ${s.perWeek(hours(h))}, ${s.category[t.category]}`;
                  return (
                    <li
                      key={t.id}
                      className={st.seg}
                      onMouseEnter={(e) => placeTip(e.currentTarget)}
                      onFocusCapture={(e) => placeTip(e.currentTarget)}
                      data-selected={selected || undefined}
                      style={{ '--w': t.share, '--h': h, '--at': positions.get(t.id) ?? 0, '--grow': grow } as CSSProperties}
                    >
                      {onSelect ? (
                        <button
                          type="button"
                          ref={(el) => {
                            if (el) btns.current.set(t.id, el);
                            else btns.current.delete(t.id);
                          }}
                          tabIndex={t.id === tabStop ? 0 : -1}
                          onKeyDown={(e) => onTileKey(e, t.id)}
                          onFocus={() => setFocusId(t.id)}
                          className={st.tile}
                          aria-label={label}
                          aria-pressed={selected}
                          onClick={() => {
                            sound.play('place');
                            onSelect(t.id);
                          }}
                        >
                          <span className={`${st.fill} ${tileClass[t.category]}`} aria-hidden="true" />
                          {grow > 0 ? <span className={st.layers} aria-hidden="true" /> : null}
                        </button>
                      ) : (
                        <span className={st.tile} role="img" aria-label={label}>
                          <span className={`${st.fill} ${tileClass[t.category]}`} aria-hidden="true" />
                          {grow > 0 ? <span className={st.layers} aria-hidden="true" /> : null}
                        </span>
                      )}
                      <div className={st.lab} aria-hidden="true">
                        <div className={st.lh}>{s.hoursShort(hours(h))}</div>
                        <div className={st.lt}>{t.label}</div>
                      </div>
                      <div className={st.tip} data-tip="" role="presentation" aria-hidden="true">
                        {t.text}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
        {scanning ? <span className={st.beam} aria-hidden="true" /> : null}
      </div>
    </div>
  );
}
