'use client';

import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { Dialog } from '@/components/kit';
import { useT } from '@/i18n/client';
import st from './week.module.css';

export interface PickerTask {
  id: string;
  label: string;
  text: string;
  /** Already part of the person's week. */
  inWeek: boolean;
}

/**
 * Chooses one task of the occupation: for «Add a task» (tasks not yet in the week) and for attaching
 * a résumé duty (tasks of the week first, then the rest). Filter by any word of the task.
 */
export function TaskPicker({
  open,
  title,
  lead,
  tasks,
  onPick,
  onClose,
}: {
  open: boolean;
  title: string;
  lead?: string;
  tasks: PickerTask[];
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const { t } = useT();
  const [q, setQ] = useState('');
  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return tasks.filter((x) => words.every((w) => `${x.label} ${x.text}`.toLowerCase().includes(w)));
  }, [q, tasks]);

  return (
    <Dialog open={open} onClose={onClose} title={title}>
      {lead ? <p className={st.pickLead}>{lead}</p> : null}
      <label className={st.pickSearch}>
        <Search size={18} strokeWidth={1.75} aria-hidden="true" />
        <input
          data-autofocus
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('start.week.addPlaceholder')}
          aria-label={t('start.week.addLabel')}
        />
      </label>
      {shown.length ? (
        <ul className={st.pickList}>
          {shown.map((x) => (
            <li key={x.id}>
              <button
                type="button"
                className={st.pickItem}
                data-in-week={x.inWeek || undefined}
                onClick={() => {
                  onPick(x.id);
                  setQ('');
                }}
              >
                <b>{x.label}</b>
                <span>{x.text}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className={st.pickEmpty}>{t('start.week.addEmpty')}</p>
      )}
    </Dialog>
  );
}
