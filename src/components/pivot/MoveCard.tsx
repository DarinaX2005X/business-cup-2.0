'use client';

import Link from 'next/link';
import { CategorySwatch } from '@/components/kit/Evidence';
import btn from '@/components/kit/controls.module.css';
import { useT } from '@/i18n/client';
import { MiniWeek } from './MiniWeek';
import type { MoveView } from './types';
import st from './pivot.module.css';

/** Pay line of a move: «+$34,750 a year», «About the same pay», «No separate pay figure» … */
export function payText(m: Pick<MoveView, 'pay' | 'wageDelta'>, t: ReturnType<typeof useT>['t'], f: ReturnType<typeof useT>['f']) {
  if (m.pay === 'more' || m.pay === 'less') return t(`pivot.pay.${m.pay}`, { delta: f.currency(Math.abs(m.wageDelta ?? 0)) });
  return t(`pivot.pay.${m.pay}`);
}

export const hoursNum = (h: number, f: ReturnType<typeof useT>['f']) => f.number(h, { maximumFractionDigits: 1 });

/** The skills a move asks for, as chips, or a calm line when there is no clear gap. */
export function SkillChips({ move }: { move: Pick<MoveView, 'skills'> }) {
  const { t } = useT();
  if (!move.skills.length) return <p className={st.noSkills}>{t('pivot.card.noSkills')}</p>;
  return (
    <div className={st.skills}>
      <span className={st.skillsK}>{t('pivot.card.skills')}</span>
      <ul className={st.chips} role="list">
        {move.skills.map((s) => (
          <li key={s.key} className={st.chip}>
            {s.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * One neighbouring job: its typical week as the art band, the title, three plain facts (how much of the
 * week stays human, skill match, pay), the skills to add, and two ways on: the person's own week moved into
 * this job, or the job's public week page.
 */
export function MoveCard({ move, index }: { move: MoveView; index: number }) {
  const { t, f } = useT();
  const h = move.hours;
  return (
    <article className={st.card} style={{ '--k': index } as React.CSSProperties} aria-labelledby={`move-${move.code}`}>
      <div className={st.band}>
        <MiniWeek
          tiles={move.tiles}
          label={t('pivot.card.weekLabel', { title: move.title, ai_does: hoursNum(h.ai_does, f), ai_speeds: hoursNum(h.ai_speeds, f), human: hoursNum(h.human_edge, f) })}
        />
      </div>
      <div className={st.cardBody}>
        <h3 id={`move-${move.code}`} className={st.cardTitle} lang={move.titleEn ? 'en' : undefined}>
          {move.title}
        </h3>
        <ul className={st.facts} role="list">
          <li className={st.factHuman}>
            <CategorySwatch category="human_edge" />
            <span>{t('pivot.card.human', { hours: hoursNum(h.human_edge, f) })}</span>
          </li>
          <li>{t('pivot.card.match', { value: f.percent(move.similarity) })}</li>
          <li className={st.factPay} data-pay={move.pay}>
            {payText(move, t, f)}
          </li>
        </ul>
        <SkillChips move={move} />
      </div>
      <div className={st.cardActions}>
        <Link href={`/pivot/${move.slug}`} className={`${btn.btn} ${btn.b_secondary} ${st.asMe}`}>
          {t('pivot.card.asMe')}
        </Link>
        <Link href={`/jobs/${move.slug}`} className={`${btn.btn} ${btn.b_quiet} ${btn.s_sm}`}>
          {t('pivot.card.jobWeek')}
        </Link>
      </div>
    </article>
  );
}
