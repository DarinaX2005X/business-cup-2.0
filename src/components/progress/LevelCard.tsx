'use client';

import { useT } from '@/i18n/client';
import type { LevelView } from './api';
import st from './progress.module.css';

/**
 * The level beside the calendar: its name in words and how far the next one is. XP is earned with every
 * award and never spent. The bar is drawn only when the server says where this level started, so it
 * always measures real progress.
 */
export function LevelCard({ level }: { level: LevelView }) {
  const { t, f } = useT();
  const left = level.nextAt !== null ? Math.max(0, level.nextAt - level.xp) : null;
  const frac =
    level.nextAt !== null && level.levelAt !== null && level.nextAt > level.levelAt
      ? Math.min(1, Math.max(0, (level.xp - level.levelAt) / (level.nextAt - level.levelAt)))
      : null;
  return (
    <section className={st.levelCard} aria-labelledby="level-title">
      <span className={st.levelBadge} aria-hidden="true">
        {f.integer(level.level)}
      </span>
      <div className={st.levelText}>
        <h2 id="level-title" className={st.levelName}>
          {level.label ?? (level.levelName ? t('progress.level.named', { level: level.level, name: level.levelName }) : t('progress.level.plain', { level: level.level }))}
        </h2>
        <p className={st.levelNext}>{left !== null ? t('progress.level.next', { xp: left, level: level.level + 1 }) : t('progress.level.total', { xp: level.xp })}</p>
        {frac !== null ? (
          <span className={st.levelBar} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(frac * 100)} aria-label={t('progress.level.bar')}>
            <i style={{ width: `${frac * 100}%` }} />
          </span>
        ) : null}
      </div>
    </section>
  );
}
