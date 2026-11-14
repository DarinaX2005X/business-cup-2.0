'use client';

import { useMemo, type CSSProperties } from 'react';
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
                      data-selected={selected || undefined}
                      style={{ '--w': t.share, '--h': h, '--at': positions.get(t.id) ?? 0, '--grow': grow } as CSSProperties}
                    >
                      {onSelect ? (
                        <button
                          type="button"
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
                      <div className={st.tip} role="presentation" aria-hidden="true">
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
