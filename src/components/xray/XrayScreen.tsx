'use client';

import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Sheet } from '@/components/kit/Overlay';
import { Toast } from '@/components/kit/Toast';
import type { WeekTask } from '@/components/kit/types';
import { normalizeShares, redistributeShares } from '@/domain/shares';
import type { WeekShare } from '@/domain/types';
import { computeXray } from '@/domain/xray';
import { useT } from '@/i18n/client';
import { useProfile } from '@/lib/client/profile';
import { ActionCard } from './ActionCard';
import { MIN_TASKS } from './lib';
import { Conclusion } from './Conclusion';
import { Further } from './Further';
import { Inspector, inspectorTitle } from './Inspector';
import { TaskList } from './TaskList';
import { focusParam, parseFocus, type Focus, type XrayData, type XrayPageProps } from './types';
import { useTaskTexts, useTips } from './useTaskTexts';
import { useWeekSave } from './useWeekSave';
import { WeekSection } from './WeekSection';
import st from './xray.module.css';

const NARROW = '(max-width: 960px)';
const subscribeNarrow = (cb: () => void) => {
  const m = window.matchMedia(NARROW);
  m.addEventListener('change', cb);
  return () => m.removeEventListener('change', cb);
};
function useNarrow() {
  return useSyncExternalStore(subscribeNarrow, () => window.matchMedia(NARROW).matches, () => false);
}



export function XrayScreen(props: XrayPageProps) {
  const { xray: initial, isOwner, isPro, bundle, trialAvailable } = props;
  const { t, locale } = useT();
  const profile = useProfile();
  const narrow = useNarrow();

  /* ---------- the week and its live recompute ---------- */
  const [shares, setShares] = useState<WeekShare[]>(initial.shares);
  const [salary, setSalary] = useState<number | null>(initial.salary.source === 'user' ? initial.salary.annual : null);
  const practice = initial.practice;
  const { result, breakdown } = useMemo(() => computeXray(bundle, shares, { salary, practice }), [bundle, shares, salary, practice]);

  const [editing, setEditing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [baseline, setBaseline] = useState<{ shares: WeekShare[]; score: number } | null>(null);
  const [notice, setNotice] = useState<{ text: string; key: number } | null>(null);

  // The server keeps the shares as sent (they are already whole numbers summing to 100).
  const onServer = useCallback(() => undefined, []);
  const onConflict = useCallback(
    (x: XrayData) => {
      setShares(x.shares);
      setNotice({ text: t('xray.edit.conflict'), key: Date.now() });
    },
    [t],
  );
  const save = useWeekSave({ id: initial.id, initialVersion: initial.version, onServer, onConflict });

  const change = useCallback(
    (next: WeekShare[]) => {
      setShares(next);
      save.schedule(next);
    },
    [save],
  );

  const startEdit = () => {
    setBaseline({ shares, score: result.score });
    setEditing(true);
  };

  /* ---------- texts, tips ---------- */
  const texts = useTaskTexts(bundle.code, locale, { texts: props.texts, ready: props.textsReady, locale: props.textsLocale });
  const tips = useTips(bundle.code, locale);
  const byId = useMemo(() => new Map(bundle.tasks.map((x) => [x.id, x])), [bundle.tasks]);
  const label = useCallback((id: string) => texts[id]?.short ?? byId.get(id)?.text ?? id, [texts, byId]);
  const fullText = useCallback((id: string) => texts[id]?.text ?? byId.get(id)?.text ?? '', [texts, byId]);

  const weekTasks: WeekTask[] = useMemo(
    () =>
      result.shares.flatMap((s) => {
        const task = byId.get(s.taskId);
        if (!task) return [];
        return [{ id: s.taskId, label: label(s.taskId), text: fullText(s.taskId), share: s.share, category: task.evidence.category, evidenceLevel: task.evidence.evidenceLevel }];
      }),
    [result.shares, byId, label, fullText],
  );

  /* ---------- focus: what the inspector shows, kept in the URL ---------- */
  const largest = useMemo(() => [...result.shares].sort((a, b) => b.share - a.share)[0]?.taskId ?? null, [result.shares]);
  const [focus, setFocusState] = useState<Focus | null>(() => parseFocus(props.initialFocus));
  const [sheetOpen, setSheetOpen] = useState(false);
  const shownFocus: Focus | null =
    focus && (focus.kind === 'metric' || result.shares.some((s) => s.taskId === focus.id)) ? focus : narrow || !largest ? null : { kind: 'task', id: largest };
  const inspectorRef = useRef<HTMLDivElement>(null);

  const setFocus = useCallback(
    (f: Focus, opts: { reveal?: boolean } = {}) => {
      setFocusState(f);
      const url = new URL(window.location.href);
      url.searchParams.set('focus', focusParam(f));
      window.history.replaceState(window.history.state, '', url.toString());
      if (window.matchMedia(NARROW).matches) setSheetOpen(true);
      else if (opts.reveal) {
        const el = inspectorRef.current;
        if (el) {
          const r = el.getBoundingClientRect();
          if (r.top < 64 || r.top > window.innerHeight * 0.6) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
    },
    [],
  );

  const selectedTask = shownFocus?.kind === 'task' ? shownFocus.id : null;

  /* ---------- editing operations ---------- */
  const onShare = useCallback((id: string, v: number) => change(redistributeShares(shares, id, v)), [change, shares]);
  const onRemove = useCallback(
    (id: string) => {
      if (shares.length <= MIN_TASKS) return;
      change(normalizeShares(shares.filter((s) => s.taskId !== id), bundle));
    },
    [change, shares, bundle],
  );
  const onReset = useCallback(() => {
    if (baseline) change(baseline.shares);
  }, [baseline, change]);
  const dirty = !!baseline && JSON.stringify(baseline.shares) !== JSON.stringify(shares);
  const delta = editing && baseline ? result.score - baseline.score : 0;


  const hasProfile = profile.status === 'ready';
  const repHref = '/today?trial=1';

  const inspector = (inSheet = false) =>
    shownFocus ? (
    <Inspector
      inSheet={inSheet}
      focus={shownFocus}
      result={result}
      breakdown={breakdown}
      bundle={bundle}
      label={label}
      fullText={fullText}
      tips={tips}
      isOwner={isOwner}
      onFocus={(f) => setFocus(f)}
    />
    ) : null;

  return (
    <div className={st.page}>
      {!isOwner ? (
        <div className={st.guestBar}>
          <p>{t('xray.guest.banner', { jobTitle: initial.jobTitle })}</p>
        </div>
      ) : null}
      <Conclusion
        xray={initial}
        result={result}
        delta={Math.abs(delta) >= 1 ? delta : 0}
        isOwner={isOwner}
        occupationTitle={props.occupationTitle}
        label={label}
        onMetric={(id) => setFocus({ kind: 'metric', id }, { reveal: true })}
      />
      <ActionCard
        isOwner={isOwner}
        isPro={isPro}
        trialAvailable={trialAvailable || !hasProfile}
        taskLabel={result.handToAi[0] ? label(result.handToAi[0]) : null}
        href={repHref}
      />
      <WeekSection
        tasks={weekTasks}
        result={result}
        selectedId={selectedTask}
        editing={editing}
        dragging={dragging}
        isOwner={isOwner}
        salary={salary}
        onSalary={setSalary}
        onSelect={(id) => setFocus({ kind: 'task', id }, { reveal: true })}
        onMetric={(id) => setFocus({ kind: 'metric', id }, { reveal: true })}
      />
      <section className={st.work} aria-labelledby="tasks-title">
        <TaskList
          tasks={weekTasks}
          bundle={bundle}
          selectedId={selectedTask}
          editing={editing}
          isOwner={isOwner}
          saveState={save.state}
          dirty={dirty}
          xrayId={initial.id}
          label={label}
          fullText={fullText}
          onSelect={(id) => setFocus({ kind: 'task', id })}
          onEdit={startEdit}
          onDone={() => {
            setEditing(false);
            setDragging(false);
          }}
          onShare={onShare}
          onRemove={onRemove}
          onReset={onReset}
          onRetry={save.retry}
          onDrag={setDragging}
        />
        <aside className={st.inspectorCol} aria-label={t('xray.inspector.label')}>
          <div ref={inspectorRef} className={st.inspectorSticky}>
            {!narrow ? inspector() : null}
          </div>
        </aside>
      </section>
      <Further
        result={result}
        bundle={bundle}
        isPro={isPro}
        isOwner={isOwner}
        label={label}
        tips={tips}
        onSelect={(id) => setFocus({ kind: 'task', id }, { reveal: true })}
      />
      {narrow && shownFocus ? (
        <Sheet open={sheetOpen} onClose={() => setSheetOpen(false)} title={inspectorTitle(shownFocus, t, label)}>
          <div className={st.sheetInsp}>{inspector(true)}</div>
        </Sheet>
      ) : null}
      {notice ? (
        <div className={st.noticeDock}>
          <Toast key={notice.key} message={notice.text} tone="neutral" onClose={() => setNotice(null)} duration={5000} />
        </div>
      ) : null}
      <span className="sr-only" aria-live="polite">
        {editing ? t('xray.live', { score: result.score, hours: result.hours.human_edge }) : ''}
      </span>
    </div>
  );
}
