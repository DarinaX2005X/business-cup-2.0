'use client';

import type { CSSProperties } from 'react';
import { groupWeek, type WeekTask } from '@/components/kit';
import st from './start.module.css';

/**
 * A small Week Bar for occupation cards: the typical week of a job in the same tile materials,
 * no labels. It shows that the product reads a job as tasks before the person sees any numbers.
 */
export function WeekStrip({ tasks, label, active }: { tasks: WeekTask[]; label: string; active?: boolean }) {
  const groups = groupWeek(tasks);
  return (
    <div className={st.strip} role="img" aria-label={label} data-active={active || undefined}>
      {groups.map((g) => (
        <div key={g.category} className={st.stripGrp} style={{ '--w': g.share } as CSSProperties}>
          {g.tasks.map((task, i) => (
            <span
              key={task.id}
              className={st.stripTile}
              data-cat={g.category}
              style={{ '--w': task.share, '--i': i } as CSSProperties}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export function WeekStripSkeleton() {
  return <div className={st.strip} data-skeleton aria-hidden="true" />;
}
