'use client';

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BookOpenText, FileText, Link2, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { Button, Skeleton, Slider, useKit, hoursOf, type WeekTask } from '@/components/kit';
import { normalizeShares, redistributeShares } from '@/domain/shares';
import { MAX_WEEK_TASKS } from '@/domain/constants';
import type { WeekShare } from '@/domain/types';
import { useT } from '@/i18n/client';
import { useBundle, useTaskTexts } from './data';
import { NeutralWeek } from './NeutralWeek';
import { ScanStage } from './ScanStage';
import { TaskPicker, type PickerTask } from './TaskPicker';
import type { Bundle, Chosen, FromMap, WeekProposal } from './types';
import st from './week.module.css';

export interface StepWeekProps {
  chosen: Chosen;
  week: WeekProposal | null;
  weekFailed: boolean;
  /** The week came from the typical week because the model could not match the duties. */
  fallback: boolean;
  onRetry: () => void;
  onWeek: (w: WeekProposal) => void;
  onChangeOccupation: () => void;
  from: FromMap | null;
  scanning: boolean;
  onScan: (on: boolean) => void;
}

const ADD_SHARE = 4;

/** Short label without the model, until /texts answers: the task up to its first clause. */
function quickLabel(text: string) {
  const words = text.replace(/[.;:]+\s*$/, '').split(/\s+/);
  const out: string[] = [];
  for (const w of words) {
    out.push(w);
    if (out.length >= 5 || (/[,;:]$/.test(w) && out.length >= 3)) break;
  }
  return out.join(' ').replace(/[,;:]+$/, '');
}

export function StepWeek(props: StepWeekProps) {
  const { chosen, week, weekFailed, onRetry } = props;
  const { t, locale } = useT();
  const { bundle, error } = useBundle(chosen.code);
  const texts = useTaskTexts(chosen.code, locale);

  if (weekFailed || error) {
    return (
      <section className={st.week} aria-labelledby="week-title">
        <h1 id="week-title" className={st.h1}>
          {t('start.week.title')}
        </h1>
        <div className={st.problem} role="alert">
          <p>{t('start.week.loadError')}</p>
          <Button size="sm" icon={<RotateCcw />} onClick={onRetry}>
            {t('common.actions.retry')}
          </Button>
        </div>
      </section>
    );
  }

  if (!bundle || !week) {
    return (
      <section className={st.week} aria-labelledby="week-title" aria-busy="true">
        <h1 id="week-title" className={st.h1}>
          {t('start.week.title')}
        </h1>
        <p className={st.lead} role="status">
          {chosen.inputSource !== 'title' ? t('start.week.matching', { title: chosen.title }) : t('start.week.loading')}
        </p>
        <div className={st.skelBar} aria-hidden="true">
          {[16, 12, 11, 10, 9, 8, 8, 7, 7, 6, 6].map((w, i) => (
            <span key={i} className={st.skelTile} style={{ flexGrow: w }} />
          ))}
        </div>
        <div className={st.rows} aria-hidden="true">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className={st.skelRow}>
              <Skeleton height={18} width="48%" />
              <Skeleton height={10} width="100%" radius={6} />
            </div>
          ))}
        </div>
      </section>
    );
  }

  return <WeekEditor key={chosen.code} {...props} bundle={bundle} week={week} texts={texts?.tasks ?? null} />;
}

/* ---------- the editor ---------- */

function WeekEditor({
  chosen,
  week,
  bundle,
  texts,
  fallback,
  onWeek,
  onChangeOccupation,
  from,
  scanning,
  onScan,
}: StepWeekProps & { bundle: Bundle; week: WeekProposal; texts: Record<string, { text: string; short: string }> | null }) {
  const { t } = useT();
  const [shares, setShares] = useState<WeekShare[]>(week.shares);
  const [matches, setMatches] = useState(week.matches);
  const [unmapped, setUnmapped] = useState(week.unmappedDuties);
  // Rows keep the order they had when the week appeared, so nothing jumps under the pointer.
  const [order, setOrder] = useState<string[]>(() => [...week.shares].sort((a, b) => b.share - a.share).map((s) => s.taskId));
  const [active, setActive] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; undo?: { shares: WeekShare[]; order: string[] } } | null>(null);
  const [picker, setPicker] = useState<{ mode: 'add' } | { mode: 'attach'; duty: string } | null>(null);
  const sharesRef = useRef(shares);
  useEffect(() => {
    sharesRef.current = shares;
  }, [shares]);

  // Hand every settled change to the flow, which keeps the draft for reloads and the Back button.
  const publish = useCallback(
    (next: Partial<WeekProposal>) => onWeek({ shares: sharesRef.current, matches, unmappedDuties: unmapped, source: week.source, ...next }),
    [onWeek, matches, unmapped, week.source],
  );

  const byId = useMemo(() => new Map(bundle.tasks.map((x) => [x.id, x])), [bundle]);
  const textOf = useCallback((id: string) => texts?.[id]?.text ?? byId.get(id)?.text ?? '', [texts, byId]);
  const labelOf = useCallback((id: string) => texts?.[id]?.short ?? quickLabel(byId.get(id)?.text ?? ''), [texts, byId]);

  const weekTasks: WeekTask[] = useMemo(
    () =>
      shares.flatMap((s) => {
        const task = byId.get(s.taskId);
        if (!task) return [];
        return [{ id: s.taskId, label: labelOf(s.taskId), text: textOf(s.taskId), share: s.share, category: task.evidence.category, evidenceLevel: task.evidence.evidenceLevel }];
      }),
    [shares, byId, labelOf, textOf],
  );

  const shareOf = useMemo(() => new Map(shares.map((s) => [s.taskId, s.share])), [shares]);
  const rows = order.filter((id) => shareOf.has(id));

  const onChange = useCallback((id: string, v: number) => {
    setShares((prev) => redistributeShares(prev, id, v));
  }, []);
  const onCommit = useCallback(() => publish({}), [publish]);
  const onDrag = useCallback((id: string | null) => {
    setDragging(id);
    setActive(id);
  }, []);

  const remove = useCallback(
    (id: string) => {
      const prev = sharesRef.current;
      if (prev.length <= 2) return;
      const next = normalizeShares(
        prev.filter((s) => s.taskId !== id),
        bundle,
      );
      setShares(next);
      sharesRef.current = next;
      setNotice({ text: t('start.week.removed', { label: labelOf(id) }), undo: { shares: prev, order } });
      setActive(null);
      publish({ shares: next });
    },
    [bundle, labelOf, order, publish, t],
  );

  const addTask = (id: string) => {
    const prev = sharesRef.current;
    if (prev.some((s) => s.taskId === id) || prev.length >= MAX_WEEK_TASKS) return prev;
    const next = normalizeShares([...prev, { taskId: id, share: ADD_SHARE }], bundle);
    setShares(next);
    sharesRef.current = next;
    setOrder((o) => [...o.filter((x) => x !== id), id]);
    setActive(id);
    return next;
  };

  const full = shares.length >= MAX_WEEK_TASKS;
  const pickerTasks: PickerTask[] = useMemo(() => {
    const inWeek = new Set(shares.map((s) => s.taskId));
    const all = bundle.tasks.map((x) => ({ id: x.id, label: labelOf(x.id), text: textOf(x.id), inWeek: inWeek.has(x.id) }));
    if (picker?.mode === 'add') return all.filter((x) => !x.inWeek);
    return [...all.filter((x) => x.inWeek), ...(full ? [] : all.filter((x) => !x.inWeek))];
  }, [bundle, shares, labelOf, textOf, picker, full]);

  const closePicker = useCallback(() => setPicker(null), []);

  const onPick = (id: string) => {
    if (!picker) return;
    if (picker.mode === 'add') {
      const next = addTask(id);
      setNotice({ text: t('start.week.added', { label: labelOf(id) }) });
      publish({ shares: next });
    } else {
      const next = addTask(id);
      const m = { ...matches, [id]: [...(matches[id] ?? []), picker.duty] };
      const u = unmapped.filter((d) => d !== picker.duty);
      setMatches(m);
      setUnmapped(u);
      setNotice({ text: t('start.week.attached', { label: labelOf(id) }) });
      onWeek({ shares: next, matches: m, unmappedDuties: u, source: week.source });
    }
    setPicker(null);
  };

  if (scanning) {
    return <ScanStage chosen={chosen} bundle={bundle} shares={shares} tasks={weekTasks} shortLabels={Object.fromEntries(shares.map((s) => [s.taskId, labelOf(s.taskId)]))} from={from} onBack={() => onScan(false)} />;
  }

  return (
    <section className={st.week} aria-labelledby="week-title">
      <div className={st.weekHead}>
        <div>
          <h1 id="week-title" className={st.h1}>
            {t('start.week.title')}
          </h1>
          <p className={st.lead}>{t('start.week.lead')}</p>
        </div>
        <p className={st.occLine}>
          <span>{t('start.week.occupation', { title: chosen.title })}</span>
          <button type="button" className={st.linkBtn} onClick={onChangeOccupation}>
            {t('start.week.change')}
          </button>
        </p>
      </div>

      <div className={st.barDock}>
        <NeutralWeek tasks={weekTasks} activeId={active} dragging={!!dragging} label={t('start.week.barLabel')} onHover={dragging ? undefined : setActive} />
        <p className={st.source}>
          {week.source === 'resume' ? <FileText size={16} strokeWidth={1.75} aria-hidden="true" /> : <BookOpenText size={16} strokeWidth={1.75} aria-hidden="true" />}
          {week.source === 'resume' ? t('start.week.sourceResume') : t('start.week.sourceOnet')}
        </p>
      </div>

      {fallback ? (
        <p className={st.fallback} role="status">
          {t('start.week.fallback')}
        </p>
      ) : null}

      <ol className={st.rows}>
        {rows.map((id) => (
          <TaskEditRow
            key={id}
            id={id}
            label={labelOf(id)}
            text={textOf(id)}
            share={shareOf.get(id)!}
            count={shares.length}
            quotes={matches[id]}
            active={active === id}
            onChange={onChange}
            onCommit={onCommit}
            onDrag={onDrag}
            onHover={dragging ? undefined : setActive}
            onRemove={remove}
          />
        ))}
      </ol>

      <div className={st.listFoot}>
        <Button variant="secondary" icon={<Plus />} disabledReason={full ? t('start.week.addFull') : undefined} onClick={() => setPicker({ mode: 'add' })}>
          {t('start.week.add')}
        </Button>
        {notice ? (
          <p className={st.notice} role="status" key={notice.text}>
            <span>{notice.text}</span>
            {notice.undo ? (
              <button
                type="button"
                className={st.linkBtn}
                onClick={() => {
                  const u = notice.undo!;
                  setShares(u.shares);
                  sharesRef.current = u.shares;
                  setOrder(u.order);
                  setNotice(null);
                  publish({ shares: u.shares });
                }}
              >
                {t('start.week.undo')}
              </button>
            ) : null}
          </p>
        ) : null}
      </div>

      {unmapped.length ? (
        <section className={st.unmatched} aria-labelledby="unmatched-title">
          <h2 id="unmatched-title" className={st.h3}>
            {t('start.week.unmatchedTitle')}
          </h2>
          <p className={st.unmatchedLead}>{t('start.week.unmatchedLead')}</p>
          <ul>
            {unmapped.map((d) => (
              <li key={d}>
                <q>{d}</q>
                <Button variant="quiet" size="sm" icon={<Link2 />} onClick={() => setPicker({ mode: 'attach', duty: d })} aria-label={t('start.week.attachLabel', { duty: d })}>
                  {t('start.week.attach')}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className={st.submitDock}>
        <Button
          size="lg"
          className={st.submit}
          onClick={() => {
            publish({});
            onScan(true);
          }}
        >
          {t('start.week.submit')}
        </Button>
      </div>

      <TaskPicker
        open={!!picker}
        title={picker?.mode === 'attach' ? t('start.week.attachLabel', { duty: picker.duty }) : t('start.week.add')}
        tasks={pickerTasks}
        onPick={onPick}
        onClose={closePicker}
      />
    </section>
  );
}

/* ---------- one task of the week ---------- */

const TaskEditRow = memo(function TaskEditRow({
  id,
  label,
  text,
  share,
  count,
  quotes,
  active,
  onChange,
  onCommit,
  onDrag,
  onHover,
  onRemove,
}: {
  id: string;
  label: string;
  text: string;
  share: number;
  count: number;
  quotes?: string[];
  active: boolean;
  onChange: (id: string, v: number) => void;
  onCommit: () => void;
  onDrag: (id: string | null) => void;
  onHover?: (id: string | null) => void;
  onRemove: (id: string) => void;
}) {
  const { t } = useT();
  const { s, hours, num } = useKit();
  const [open, setOpen] = useState(false);
  const h = hoursOf(share);
  const showFullToggle = text.length > label.length + 12;
  return (
    <li className={st.row} data-active={active || undefined} onPointerEnter={() => onHover?.(id)} onPointerLeave={() => onHover?.(null)}>
      <div className={st.rowText}>
        <p className={st.rowLabel}>{label}</p>
        {showFullToggle ? (
          <>
            {open ? <p className={st.rowFull}>{text}</p> : null}
            <button type="button" className={st.rowToggle} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
              {open ? t('start.week.hideTask') : t('start.week.fullTask')}
            </button>
          </>
        ) : null}
        {quotes?.length ? (
          <p className={st.quote}>
            <span>{t('start.week.fromResume')}</span> {quotes.map((q) => `“${q}”`).join(' ')}
          </p>
        ) : null}
      </div>
      <div className={st.rowSlider}>
        <Slider
          label={`${t('start.week.share')}: ${label}`}
          value={share}
          min={1}
          max={Math.min(80, 100 - (count - 1))}
          format={(v) => `${num(v)}%, ${s.hoursShort(hours(hoursOf(v)))}`}
          onChange={(v) => onChange(id, v)}
          onCommit={onCommit}
          onDragChange={(d) => onDrag(d ? id : null)}
        />
      </div>
      <div className={st.rowAmount} aria-hidden="true">
        <b>{s.hoursShort(hours(h))}</b>
        <span>{num(share)}%</span>
      </div>
      <button
        type="button"
        className={st.rowRemove}
        onClick={() => onRemove(id)}
        aria-label={t('start.week.removeTask', { label })}
        aria-disabled={count <= 2 || undefined}
        title={count <= 2 ? t('start.week.minTasks') : undefined}
      >
        <Trash2 size={18} strokeWidth={1.75} aria-hidden="true" />
        <span>{t('start.week.remove')}</span>
      </button>
    </li>
  );
});
