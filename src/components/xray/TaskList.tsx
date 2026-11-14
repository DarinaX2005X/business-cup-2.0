'use client';

import { Check, Pencil, Plus, RotateCcw, X } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Button } from '@/components/kit/Button';
import { Segmented } from '@/components/kit/Segmented';
import { useKit } from '@/components/kit/strings';
import { TaskRow } from '@/components/kit/TaskRow';
import type { WeekTask } from '@/components/kit/types';
import type { Category } from '@/domain/types';
import { useT } from '@/i18n/client';
import type { ClientBundle } from './types';
import type { SaveState } from './useWeekSave';
import { MIN_TASKS } from './lib';
import st from './xray.module.css';

type Filter = 'all' | Exclude<Category, 'no_data'>;

export function TaskList({
  tasks,
  bundle,
  selectedId,
  editing,
  isOwner,
  saveState,
  dirty,
  xrayId,
  label,
  fullText,
  onSelect,
  onEdit,
  onDone,
  onShare,
  onRemove,
  onReset,
  onRetry,
  onDrag,
}: {
  tasks: WeekTask[];
  bundle: ClientBundle;
  selectedId: string | null;
  editing: boolean;
  isOwner: boolean;
  saveState: SaveState;
  dirty: boolean;
  xrayId: string;
  label: (id: string) => string;
  fullText: (id: string) => string;
  onSelect: (id: string) => void;
  onEdit: () => void;
  onDone: () => void;
  onShare: (id: string, v: number) => void;
  onRemove: (id: string) => void;
  onReset: () => void;
  onRetry: () => void;
  onDrag: (d: boolean) => void;
}) {
  const { t } = useT();
  const { s } = useKit();
  const [filter, setFilter] = useState<Filter>('all');
  const byId = useMemo(() => new Map(bundle.tasks.map((x) => [x.id, x])), [bundle.tasks]);
  const present = new Set(tasks.map((x) => x.category));
  const options: { value: Filter; label: string }[] = [
    { value: 'all', label: t('xray.tasks.all') },
    ...(['ai_does', 'ai_speeds', 'human_edge'] as const).filter((c) => present.has(c)).map((c) => ({ value: c as Filter, label: s.category[c] })),
  ];
  const active = options.some((o) => o.value === filter) ? filter : 'all';
  // Rows keep their order while a slider moves, so the row under the pointer never jumps away.
  const [order, setOrder] = useState<string[] | null>(null);
  const sorted = useMemo(() => {
    const list = [...tasks].sort((a, b) => b.share - a.share);
    if (!order) return list;
    const pos = new Map(order.map((id, i) => [id, i]));
    return [...tasks].sort((a, b) => (pos.get(a.id) ?? 99) - (pos.get(b.id) ?? 99));
  }, [tasks, order]);
  const shown = active === 'all' ? sorted : sorted.filter((x) => x.category === active);
  const canRemove = tasks.length > MIN_TASKS;

  const status =
    saveState === 'saving' ? (
      <span className={st.saveState}>{t('xray.edit.saving')}</span>
    ) : saveState === 'saved' ? (
      <span className={st.saveState} data-ok="">
        <Check size={16} strokeWidth={2.2} aria-hidden="true" />
        {t('xray.edit.saved')}
      </span>
    ) : saveState === 'error' ? (
      <span className={st.saveState} data-err="">
        {t('xray.edit.error')}{' '}
        <button type="button" className={st.inlineBtn} onClick={onRetry}>
          {t('xray.edit.retry')}
        </button>
      </span>
    ) : null;

  return (
    <div className={st.listCol}>
      <div className={st.listHead}>
        <h2 id="tasks-title" className={st.h2}>
          {t('xray.tasks.title')}
        </h2>
        {isOwner ? (
          <div className={st.editCtl}>
            <span aria-live="polite" className={st.saveSlot}>
              {status}
            </span>
            {editing ? (
              <Button
                size="sm"
                icon={<Check />}
                onClick={() => {
                  setOrder(null);
                  onDone();
                }}
              >
                {t('xray.edit.done')}
              </Button>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                icon={<Pencil />}
                onClick={() => {
                  setOrder(sorted.map((x) => x.id));
                  setFilter('all');
                  onEdit();
                }}
              >
                {t('xray.edit.start')}
              </Button>
            )}
          </div>
        ) : null}
      </div>
      {editing ? (
        <div className={st.editBar}>
          <p className={st.editHint}>{t('xray.edit.hint')}</p>
          <div className={st.editLinks}>
            {dirty ? (
              <Button variant="quiet" size="sm" icon={<RotateCcw />} onClick={onReset}>
                {t('xray.edit.reset')}
              </Button>
            ) : null}
            <Link href={`/start?step=week&from=${xrayId}`} className={st.textLink}>
              <Plus size={16} strokeWidth={2} aria-hidden="true" />
              {t('xray.edit.add')}
            </Link>
          </div>
        </div>
      ) : (
        <div className={st.filterRow}>
          <Segmented options={options} value={active} onChange={setFilter} label={t('xray.tasks.filter')} />
        </div>
      )}
      <ul className={st.rows} role="list">
        {shown.map((x) => {
          const task = byId.get(x.id);
          if (!task) return null;
          const selected = x.id === selectedId;
          return (
            <li key={x.id} className={st.rowItem} data-editing={editing || undefined}>
              <TaskRow
                id={x.id}
                text={fullText(x.id)}
                short={label(x.id)}
                useShort={!selected}
                share={x.share}
                category={task.evidence.category}
                evidence={task.evidence}
                selected={selected}
                editing={editing}
                showMeter={!editing}
                onSelect={onSelect}
                onShareChange={onShare}
                onDragChange={onDrag}
              />
              {editing ? (
                <button
                  type="button"
                  className={st.removeBtn}
                  aria-label={t('xray.edit.removeLabel', { task: label(x.id) })}
                  aria-disabled={!canRemove || undefined}
                  title={canRemove ? undefined : t('xray.edit.minTasks', { count: MIN_TASKS })}
                  onClick={() => canRemove && onRemove(x.id)}
                >
                  <X size={16} strokeWidth={2} aria-hidden="true" />
                  {t('xray.edit.remove')}
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
      {editing && !canRemove ? <p className={st.minNote}>{t('xray.edit.minTasks', { count: MIN_TASKS })}</p> : null}
    </div>
  );
}
