'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BookOpenText, FileText, Link2, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { Button, CATEGORY_ORDER, Skeleton, TaskRow, WeekBar, type WeekTask } from '@/components/kit';
import { normalizeShares, redistributeShares } from '@/domain/shares';
import { MAX_WEEK_TASKS } from '@/domain/constants';
import type { WeekShare } from '@/domain/types';
import { useT } from '@/i18n/client';
import { useBundle, useTaskTexts } from './data';
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

const DANGLING = new Set(['and', 'or', 'to', 'for', 'with', 'as', 'of', 'the', 'a', 'an', 'in', 'on', 'by', 'from', 'such', 'including', 'using', 'и', 'в', 'на', 'для', 'с', 'по', 'мен', 'және']);

/** Short label without the model, until /texts answers: the task up to its first clause, never ending on «and». */
export function quickLabel(text: string) {
  const words = text.replace(/[.;:]+\s*$/, '').split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (const w of words) {
    out.push(w);
    if (out.length >= 5 || (/[,;:]$/.test(w) && out.length >= 3)) break;
  }
  return tidyLabel(out.join(' '));
}

/** Drops a trailing comma or function word, which the heuristic labels of the server can end on. */
function tidyLabel(label: string) {
  const words = label.replace(/[,;:]+$/, '').split(/\s+/);
  while (words.length > 2 && DANGLING.has(words[words.length - 1].toLowerCase().replace(/[,;:]$/, ''))) words.pop();
  return words.join(' ').replace(/[,;:]+$/, '');
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

  return <WeekEditor key={chosen.code} {...props} bundle={bundle} week={week} texts={texts?.ready ? texts.tasks : null} />;
}

/* ---------- the editor ---------- */

/** Throttle for keeping the draft current while a slider moves (a reload keeps the last step). */
const DRAFT_THROTTLE_MS = 300;

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
  const byId = useMemo(() => new Map(bundle.tasks.map((x) => [x.id, x])), [bundle]);
  // One order for the bar and the list: the order the scan will paint (category, then the largest task),
  // fixed when the week appears so nothing jumps under the pointer. Added tasks go to the end.
  const [order, setOrder] = useState<string[]>(() => {
    const rank = (id: string) => CATEGORY_ORDER.indexOf(byId.get(id)?.evidence.category ?? 'no_data');
    return [...week.shares].sort((a, b) => rank(a.taskId) - rank(b.taskId) || b.share - a.share).map((s) => s.taskId);
  });
  const [active, setActive] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState<{ text: string; undo?: { shares: WeekShare[]; order: string[] } } | null>(null);
  const [picker, setPicker] = useState<{ mode: 'add' } | { mode: 'attach'; duty: string } | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const sharesRef = useRef(shares);
  useEffect(() => {
    sharesRef.current = shares;
  }, [shares]);

  // Every slider gesture starts from the week as it was when the slider got focus, so the time
  // freed or taken spreads over the other tasks in proportion, however many steps the gesture has.
  const base = useRef<{ id: string; shares: WeekShare[] } | null>(null);

  const publish = useCallback(
    (next: Partial<WeekProposal>) => onWeek({ shares: sharesRef.current, matches, unmappedDuties: unmapped, source: week.source, ...next }),
    [onWeek, matches, unmapped, week.source],
  );
  const draftTimer = useRef(0);
  const publishSoon = useCallback(() => {
    if (draftTimer.current) return;
    draftTimer.current = window.setTimeout(() => {
      draftTimer.current = 0;
      publish({});
    }, DRAFT_THROTTLE_MS);
  }, [publish]);
  useEffect(() => () => window.clearTimeout(draftTimer.current), []);

  const textOf = useCallback((id: string) => texts?.[id]?.text ?? byId.get(id)?.text ?? '', [texts, byId]);
  const labelOf = useCallback(
    (id: string) => {
      const short = texts?.[id]?.short ?? byId.get(id)?.short;
      return short ? tidyLabel(short) : quickLabel(byId.get(id)?.text ?? '');
    },
    [texts, byId],
  );

  const shareOf = useMemo(() => new Map(shares.map((s) => [s.taskId, s.share])), [shares]);
  const rows = useMemo(() => order.filter((id) => shareOf.has(id)), [order, shareOf]);

  const weekTasks: WeekTask[] = useMemo(
    () =>
      rows.flatMap((id) => {
        const task = byId.get(id);
        if (!task) return [];
        return [{ id, label: labelOf(id), text: textOf(id), share: shareOf.get(id)!, category: task.evidence.category, evidenceLevel: task.evidence.evidenceLevel }];
      }),
    [rows, byId, labelOf, textOf, shareOf],
  );

  const onEditFocus = useCallback((id: string, focused: boolean) => {
    if (focused) base.current = { id, shares: sharesRef.current };
    else if (base.current?.id === id) base.current = null;
    setActive(focused ? id : null);
  }, []);
  const onChange = useCallback(
    (id: string, v: number) => {
      if (base.current?.id !== id) base.current = { id, shares: sharesRef.current };
      const next = redistributeShares(base.current.shares, id, v);
      sharesRef.current = next;
      setShares(next);
      publishSoon();
    },
    [publishSoon],
  );

  const remove = (id: string) => {
    const prev = sharesRef.current;
    if (prev.length <= 2) return;
    base.current = null;
    const next = normalizeShares(
      prev.filter((s) => s.taskId !== id),
      bundle,
    );
    setShares(next);
    sharesRef.current = next;
    setNotice({ text: t('start.week.removed', { label: labelOf(id) }), undo: { shares: prev, order } });
    setActive(null);
    publish({ shares: next });
  };

  const addTask = (id: string) => {
    const prev = sharesRef.current;
    if (prev.some((s) => s.taskId === id) || prev.length >= MAX_WEEK_TASKS) return prev;
    base.current = null;
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

  // A tile on the bar takes the person to that task's slider.
  const focusRow = (id: string) => {
    setActive(id);
    const slider = document.querySelector<HTMLElement>(`[data-row="${id}"] [role="slider"]`);
    slider?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    slider?.focus({ preventScroll: true });
  };

  const described = chosen.inputSource === 'description';

  if (scanning) {
    return (
      <ScanStage
        chosen={chosen}
        bundle={bundle}
        shares={shares}
        tasks={weekTasks}
        shortLabels={Object.fromEntries(shares.map((s) => [s.taskId, labelOf(s.taskId)]))}
        from={from}
        onBack={() => onScan(false)}
      />
    );
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
        <WeekBar
          tasks={weekTasks}
          tone="neutral"
          orientation="horizontal"
          editable
          dragging={dragging}
          selectedId={active}
          onSelect={focusRow}
          ariaLabel={t('start.week.barLabel')}
        />
        <p className={st.source}>
          {week.source === 'resume' ? <FileText size={16} strokeWidth={1.75} aria-hidden="true" /> : <BookOpenText size={16} strokeWidth={1.75} aria-hidden="true" />}
          {week.source === 'resume' ? (described ? t('start.week.sourceDescription') : t('start.week.sourceResume')) : t('start.week.sourceOnet')}
        </p>
      </div>

      {fallback ? (
        <p className={st.fallback} role="status">
          {t('start.week.fallback')}
        </p>
      ) : null}

      <ol className={st.rows}>
        {rows.map((id) => {
          const task = byId.get(id)!;
          const label = labelOf(id);
          const text = textOf(id);
          const quotes = matches[id];
          const isOpen = !!open[id];
          const canOpen = text.length > label.length + 12 || (quotes?.length ?? 0) > 1;
          return (
            <li key={id} data-row={id} onPointerEnter={() => !dragging && setActive(id)} onPointerLeave={() => !dragging && setActive(null)}>
              <TaskRow
                id={id}
                text={text}
                short={label}
                useShort
                hideCategory
                showMeter={false}
                editing
                selected={active === id}
                share={shareOf.get(id)!}
                category={task.evidence.category}
                evidence={task.evidence}
                sliderMax={Math.min(60, 100 - (shares.length - 1))}
                onShareChange={onChange}
                onShareCommit={() => publishSoon()}
                onDragChange={setDragging}
                onEditFocus={onEditFocus}
                details={
                  canOpen || quotes?.length ? (
                    <>
                      {isOpen ? <p className={st.rowFull}>{text}</p> : null}
                      {quotes?.length ? (
                        <p className={st.quote} data-open={isOpen || undefined}>
                          <span>{described ? t('start.week.fromDescription') : t('start.week.fromResume')}</span>{' '}
                          {(isOpen ? quotes : quotes.slice(0, 1)).map((q) => `“${q}”`).join(' ')}
                        </p>
                      ) : null}
                      {canOpen ? (
                        <button type="button" className={st.rowToggle} aria-expanded={isOpen} onClick={() => setOpen((o) => ({ ...o, [id]: !o[id] }))}>
                          {isOpen ? t('start.week.hideTask') : t('start.week.fullTask')}
                        </button>
                      ) : null}
                    </>
                  ) : null
                }
                actions={
                  <button
                    type="button"
                    className={st.rowRemove}
                    onClick={() => remove(id)}
                    aria-label={t('start.week.removeTask', { label })}
                    aria-disabled={shares.length <= 2 || undefined}
                    title={shares.length <= 2 ? t('start.week.minTasks') : undefined}
                  >
                    <Trash2 size={18} strokeWidth={1.75} aria-hidden="true" />
                    <span>{t('start.week.remove')}</span>
                  </button>
                }
              />
            </li>
          );
        })}
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
                  base.current = null;
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
          <p className={st.unmatchedLead}>{described ? t('start.week.unmatchedLeadDescription') : t('start.week.unmatchedLead')}</p>
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
            window.clearTimeout(draftTimer.current);
            draftTimer.current = 0;
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
