'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Sheet } from '@/components/kit/Overlay';
import { Toast } from '@/components/kit/Toast';
import type { WeekTask } from '@/components/kit/types';
import { normalizeShares, redistributeShares } from '@/domain/shares';
import type { WeekShare } from '@/domain/types';
import { computeXray } from '@/domain/xray';
import { useT } from '@/i18n/client';
import { useProfile } from '@/lib/client/profile';
import { ActionCard } from './ActionCard';
import { distinctLabels, isForeignLabel, MIN_TASKS, taskLabel } from './lib';
import { Conclusion } from './Conclusion';
import { Further } from './Further';
import { Inspector, inspectorTitle } from './Inspector';
import { TaskList } from './TaskList';
import { focusParam, parseFocus, type Focus, type XrayData, type XrayPageProps } from './types';
import { useTaskTexts, useTips } from './useTaskTexts';
import { useWeekSave } from './useWeekSave';
import { PayLine, WeekSection } from './WeekSection';
import { isMapTab, MapTabs, TabPanel, type MapTab } from './MapTabs';
import { Overview } from './Overview';
import { PlanView, SkillsView } from './growthSlots';
import { FIRST_FRAME_KEY } from './XraySkeleton';
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

  // The scan's first frame has served its purpose once the map itself is on screen.
  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(FIRST_FRAME_KEY);
      if (raw && (JSON.parse(raw) as { id?: string }).id === initial.id) window.sessionStorage.removeItem(FIRST_FRAME_KEY);
    } catch {
      /* storage blocked or malformed: nothing to clean */
    }
  }, [initial.id]);

  /* ---------- texts, tips ---------- */
  const { texts, ready: textsReady } = useTaskTexts(bundle.code, locale, { texts: props.texts, ready: props.textsReady, locale: props.textsLocale });
  const tips = useTips(bundle.code, locale);
  const byId = useMemo(() => new Map(bundle.tasks.map((x) => [x.id, x])), [bundle.tasks]);
  const fullText = useCallback((id: string) => texts[id]?.text ?? byId.get(id)?.text ?? '', [texts, byId]);
  // Same label source as step 3 of /start: generated labels once ready, else the build's label, else the
  // first clause. Two tasks of this week never show the same words.
  const labels = useMemo(
    () => distinctLabels(result.shares.map((x) => x.taskId), (id) => taskLabel(textsReady ? texts[id]?.short : null, byId.get(id)), fullText),
    [result.shares, texts, textsReady, byId, fullText],
  );
  const label = useCallback((id: string) => labels.get(id) ?? taskLabel(textsReady ? texts[id]?.short : null, byId.get(id)), [labels, byId, texts, textsReady]);
  /** The label was written as a label (generated, or by the data build), not cut from the task sentence. */
  const written = useCallback((id: string) => !!((textsReady && texts[id]?.short) || byId.get(id)?.short), [textsReady, texts, byId]);

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

  /* ---------- tabs under the top block, kept in the URL as ?tab= ---------- */
  const [tab, setTabState] = useState<MapTab>(() => (isMapTab(props.initialTab) ? props.initialTab : 'overview'));
  const tabsRef = useRef<HTMLDivElement>(null);
  const setTab = useCallback((next: MapTab, opts: { scroll?: boolean } = {}) => {
    setTabState(next);
    const url = new URL(window.location.href);
    url.searchParams.set('tab', next);
    window.history.replaceState(window.history.state, '', url.toString());
    // Opening a tab from below (a card, a step) brings its start under the sticky bar.
    if (opts.scroll) requestAnimationFrame(() => tabsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }, []);

  // Every number and task is explained in the inspector, which lives on the Tasks tab.
  const setFocus = useCallback(
    (f: Focus, opts: { reveal?: boolean } = {}) => {
      setFocusState(f);
      const url = new URL(window.location.href);
      url.searchParams.set('focus', focusParam(f));
      url.searchParams.set('tab', 'tasks');
      window.history.replaceState(window.history.state, '', url.toString());
      setTabState('tasks');
      if (window.matchMedia(NARROW).matches) setSheetOpen(true);
      else if (opts.reveal) {
        requestAnimationFrame(() => {
          const el = inspectorRef.current;
          if (!el) return;
          const r = el.getBoundingClientRect();
          if (r.top < 120 || r.top > window.innerHeight * 0.6) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
      }
    },
    [],
  );

  const selectedTask = shownFocus?.kind === 'task' ? shownFocus.id : null;

  /* ---------- editing operations ---------- */
  // One slider gesture (a drag, or key presses while the slider has focus) reapportions from the shares
  // captured when it started, so the points it frees spread over the other tasks in proportion instead of
  // piling onto the largest one through repeated integer rounding.
  const gesture = useRef<{ id: string; base: WeekShare[] } | null>(null);
  const startGesture = useCallback(
    (id: string, force: boolean) => {
      if (force || gesture.current?.id !== id) gesture.current = { id, base: shares };
    },
    [shares],
  );
  const endGesture = useCallback(() => {
    gesture.current = null;
  }, []);
  const onShare = useCallback(
    (id: string, v: number) => {
      const base = gesture.current?.id === id ? gesture.current.base : shares;
      change(redistributeShares(base, id, v));
    },
    [change, shares],
  );
  const onRemove = useCallback(
    (id: string) => {
      if (shares.length <= MIN_TASKS) return;
      gesture.current = null;
      change(normalizeShares(shares.filter((s) => s.taskId !== id), bundle));
    },
    [change, shares, bundle],
  );
  const onReset = useCallback(() => {
    gesture.current = null;
    if (baseline) change(baseline.shares);
  }, [baseline, change]);
  const dirty = !!baseline && JSON.stringify(baseline.shares) !== JSON.stringify(shares);
  const delta = editing && baseline ? result.score - baseline.score : 0;


  const hasProfile = profile.status === 'ready';
  // The teaser names the task only with a generated label in this language, never a raw fragment of the
  // O*NET sentence or an English label inside a Russian or Kazakh title.
  const topTask = result.handToAi[0];
  const teaserLabel = topTask && written(topTask) && !isForeignLabel(label(topTask), locale) ? label(topTask) : null;
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
        byCategory={(id) => byId.get(id)?.evidence.category}
        labelsReady={result.humanEdge.every(written)}
        cardPath={props.cardPath}
        onMetric={(id) => setFocus({ kind: 'metric', id }, { reveal: true })}
      />
      <ActionCard
        isOwner={isOwner}
        isPro={isPro}
        trialAvailable={trialAvailable || !hasProfile}
        taskLabel={teaserLabel}
        href={repHref}
      />
      <div ref={tabsRef} className={st.tabsAnchor} />
      <MapTabs tab={tab} onTab={(next) => setTab(next)} />

      {tab === 'overview' ? (
        <TabPanel id="overview" lead={t(isOwner ? 'xray.tabs.lead.overview' : 'xray.tabs.lead.overviewGuest')}>
          <Overview
            result={result}
            byId={byId}
            label={label}
            isOwner={isOwner}
            pay={<PayLine result={result} isOwner={isOwner} salary={salary} onSalary={setSalary} onMetric={(id) => setFocus({ kind: 'metric', id }, { reveal: true })} />}
            onTask={(id) => setFocus({ kind: 'task', id }, { reveal: true })}
            onTab={(next) => setTab(next, { scroll: true })}
          />
        </TabPanel>
      ) : null}

      {tab === 'tasks' ? (
        <TabPanel id="tasks" lead={t('xray.tabs.lead.tasks')}>
          <WeekSection
            tasks={weekTasks}
            result={result}
            selectedId={selectedTask}
            editing={editing}
            dragging={dragging}
            isOwner={isOwner}
            salary={salary}
            onSalary={setSalary}
            showPay={false}
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
              onGestureStart={startGesture}
              onGestureEnd={endGesture}
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
          <Further result={result} bundle={bundle} isPro={isPro} isOwner={isOwner} label={label} tips={tips} xrayId={initial.id} only="pairs" onSelect={(id) => setFocus({ kind: 'task', id }, { reveal: true })} />
        </TabPanel>
      ) : null}

      {tab === 'plan' ? (
        <TabPanel id="plan" lead={t('xray.tabs.lead.plan')}>
          {isOwner ? <PlanView xrayId={initial.id} /> : <OwnerOnly />}
        </TabPanel>
      ) : null}

      {tab === 'skills' ? (
        <TabPanel id="skills" lead={t('xray.tabs.lead.skills')}>
          {isOwner ? <SkillsView xrayId={initial.id} /> : <OwnerOnly />}
        </TabPanel>
      ) : null}

      {tab === 'next' ? (
        <TabPanel id="next" lead={t('xray.tabs.lead.next')}>
          <Further result={result} bundle={bundle} isPro={isPro} isOwner={isOwner} label={label} tips={tips} xrayId={initial.id} only="next" onSelect={(id) => setFocus({ kind: 'task', id }, { reveal: true })} />
          <p className={st.pivotLink}>
            <Link href="/pivot" className={st.textLink}>
              {t('xray.tabs.pivot')}
            </Link>
          </p>
        </TabPanel>
      ) : null}
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

/** Plan and Skills belong to the person who made the map: someone opening a shared link gets a way to their own. */
function OwnerOnly() {
  const { t } = useT();
  return (
    <div className={st.emptyTab}>
      <p>{t('xray.tabs.ownerOnly')}</p>
      <Link href="/start" className={st.textLink}>
        {t('xray.tabs.ownerOnlyCta')}
      </Link>
    </div>
  );
}
