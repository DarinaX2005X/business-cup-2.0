'use client';

import { memo, type CSSProperties } from 'react';
import { groupWeek, hoursOf, useKit, type WeekTask } from '@/components/kit';
import st from './week.module.css';

/**
 * The person's week while they edit it: the same tiles as the Week Bar, in the same order, but still
 * unpainted paper. Categories stay hidden so people set their real hours instead of steering the
 * result; the scan paints these very tiles in step 4.
 */
export const NeutralWeek = memo(function NeutralWeek({
  tasks,
  activeId,
  dragging,
  label,
  onHover,
}: {
  tasks: WeekTask[];
  activeId: string | null;
  dragging: boolean;
  label: string;
  onHover?: (id: string | null) => void;
}) {
  const { s, hours } = useKit();
  // Category order, so step 4 only has to paint the tiles where they already stand.
  const groups = groupWeek(tasks);
  return (
    <div className={st.nw} data-active={activeId ? true : undefined} data-dragging={dragging || undefined}>
      <ul className={st.nwBar} aria-label={label}>
        {groups.flatMap((g, gi) =>
          g.tasks.map((task, i) => {
            const h = hoursOf(task.share);
            return (
              <li
                key={task.id}
                className={st.nwSeg}
                data-active={task.id === activeId || undefined}
                data-gap={gi > 0 && i === 0 ? true : undefined}
                style={{ '--w': task.share } as CSSProperties}
                onPointerEnter={() => onHover?.(task.id)}
                onPointerLeave={() => onHover?.(null)}
              >
                <span className={st.nwTile} aria-hidden="true" />
                <span className={st.nwLab}>
                  <b>{s.hoursShort(hours(h))}</b>
                  <span>{task.label}</span>
                </span>
              </li>
            );
          }),
        )}
      </ul>
    </div>
  );
});
