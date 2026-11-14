'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { defaultShares } from '@/domain/shares';
import { hasCyrillic } from '@/domain/text';
import type { XrayResult } from '@/domain/types';
import { useT } from '@/i18n/client';
import { ApiError, apiFetch } from '@/lib/client/api';
import { analyzeText, loadBundle, loadSample, proposeWeek, readDraft, readScan, writeDraft } from './data';
import { FlowHeader } from './FlowHeader';
import { CONFIDENT, StepOccupation } from './StepOccupation';
import { StepWeek } from './StepWeek';
import { matchedTerm, StepWho, type WhoPanel } from './StepWho';
import type { Analysis, Chosen, Draft, FromMap, RankedOccupation, SampleName, SearchItem, Step, TextOrigin, WeekProposal, WhoProblem } from './types';
import st from './start.module.css';

export interface StartInitial {
  step?: string;
  q?: string;
  code?: string;
  sample?: string;
  from?: string;
}

const isStep = (v: unknown): v is Step => v === 'who' || v === 'occupation' || v === 'week' || v === 'scan';

/**
 * /start: four screens from «what do you do» to the scanned week. One main step per screen; the
 * draft lives in sessionStorage so a reload or the browser Back button keeps the person's work.
 */
export function StartFlow({ initial }: { initial: StartInitial }) {
  const { locale } = useT();
  const [step, setStep] = useState<Step>('who');
  const [query, setQuery] = useState(initial.q ?? '');
  const [panel, setPanel] = useState<WhoPanel>('drop');
  const [pasteText, setPasteText] = useState('');
  const [describeText, setDescribeText] = useState('');
  const [problem, setProblem] = useState<WhoProblem | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [pendingOrigin, setPendingOrigin] = useState<TextOrigin | null>(null);
  const [analysisFailed, setAnalysisFailed] = useState(false);
  const [pendingText, setPendingText] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Chosen | null>(null);
  const [week, setWeek] = useState<WeekProposal | null>(null);
  const [weekFailed, setWeekFailed] = useState(false);
  const [fallback, setFallback] = useState(false);
  const [from, setFrom] = useState<FromMap | null>(null);
  const [ready, setReady] = useState(false);

  const lastText = useRef<{ text: string; origin: TextOrigin } | null>(null);
  const lastWeekReq = useRef<{ code: string; duties: { original: string; en: string }[] | null } | null>(null);
  const seq = useRef(0);

  /* ---------- steps and the browser history ---------- */

  const go = useCallback((next: Step, replace = false) => {
    setStep(next);
    const url = `${window.location.pathname}?step=${next}`;
    if (replace) window.history.replaceState(window.history.state, '', url);
    else window.history.pushState(window.history.state, '', url);
    window.scrollTo({ top: 0 });
  }, []);

  const state = useRef({ analysis, pendingOrigin, chosen });
  useEffect(() => {
    state.current = { analysis, pendingOrigin, chosen };
  }, [analysis, pendingOrigin, chosen]);
  useEffect(() => {
    const onPop = () => {
      const s = new URLSearchParams(window.location.search).get('step');
      const { analysis: a, pendingOrigin: p, chosen: c } = state.current;
      let next: Step = isStep(s) ? s : 'who';
      if (next === 'scan') next = 'week';
      if (next === 'week' && !c) next = a ? 'occupation' : 'who';
      if (next === 'occupation' && !a && !p) next = 'who';
      setStep(next);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  /* ---------- week ---------- */

  const loadWeek = useCallback(
    async (code: string, duties: { original: string; en: string }[] | null) => {
      lastWeekReq.current = { code, duties };
      const my = ++seq.current;
      setWeek(null);
      setWeekFailed(false);
      setFallback(false);
      try {
        if (duties?.length) {
          const w = await proposeWeek(code, duties, locale);
          if (my === seq.current) setWeek(w);
        } else {
          const bundle = await loadBundle(code);
          if (my === seq.current) setWeek({ shares: defaultShares(bundle), matches: {}, unmappedDuties: [], source: 'onet' });
        }
      } catch (err) {
        if (my !== seq.current) return;
        const fb = err instanceof ApiError ? (err.body as { fallback?: WeekProposal } | null)?.fallback : null;
        if (fb) {
          setWeek(fb);
          setFallback(true);
        } else setWeekFailed(true);
      }
    },
    [locale],
  );

  const choose = useCallback(
    (c: Chosen, duties: { original: string; en: string }[] | null) => {
      setChosen(c);
      setFrom((f) => (f && f.occupationCode === c.code ? f : f ? { ...f, isOwner: false } : null));
      go('week');
      void loadWeek(c.code, duties);
    },
    [go, loadWeek],
  );

  /* ---------- step 1 ---------- */

  const onPick = useCallback(
    (item: SearchItem, typed: string) => {
      setProblem(null);
      choose({ code: item.code, title: item.title, jobTitle: jobTitleFrom(item, typed), inputSource: 'title' }, null);
    },
    [choose],
  );

  const runAnalysis = useCallback(
    async (text: string, origin: TextOrigin, replace = false) => {
      lastText.current = { text, origin };
      // Keep the text before the request, so a reload while it is read starts the read again.
      writeDraft({ ...(readDraft<Draft>() ?? { query: '', analysis: null, selected: null, chosen: null, week: null, from: null }), step: 'occupation', pending: { text, origin } });
      const my = ++seq.current;
      setAnalysis(null);
      setPendingOrigin(origin);
      setPendingText(text);
      setAnalysisFailed(false);
      setSelected(null);
      setProblem(null);
      if (origin.mode === 'description') setDescribeText(text);
      else if (!origin.sample && !origin.fileName) setPasteText(text);
      go('occupation', replace);
      try {
        const res = await analyzeText(text, origin.mode, locale);
        if (my !== seq.current) return;
        setAnalysis({ ...res, origin });
        setPendingText(null);
        setSelected(res.confidence >= CONFIDENT && res.ranked[0] ? res.ranked[0].code : null);
      } catch (err) {
        if (my !== seq.current) return;
        const p = problemFrom(err);
        if (!p) {
          setAnalysisFailed(true);
          return;
        }
        setProblem(p);
        setPendingOrigin(null);
        setPendingText(null);
        if (['not_resume', 'not_work', 'too_short', 'unclear'].includes(p.kind)) setPanel('describe');
        go('who', true);
      }
    },
    [go, locale],
  );

  const runSample = useCallback(
    async (name: SampleName) => {
      try {
        const text = await loadSample(name);
        await runAnalysis(text, { mode: 'resume', sample: name, fileName: null });
      } catch {
        setProblem({ kind: 'network' });
      }
    },
    [runAnalysis],
  );

  /* ---------- step 2 ---------- */

  const onConfirm = useCallback(
    (r: RankedOccupation) => {
      if (!analysis) return;
      const own = analysis.facts.title?.trim();
      choose(
        {
          code: r.code,
          title: r.title,
          jobTitle: own && own.length >= 2 ? own : r.title,
          inputSource: analysis.origin.mode === 'description' ? 'description' : 'resume',
        },
        analysis.facts.duties,
      );
    },
    [analysis, choose],
  );

  /* ---------- start: links from the map, public pages and the landing; or the saved draft ---------- */

  useEffect(() => {
    let live = true;
    const start = async () => {
      if (initial.from) {
        try {
          const { xray, isOwner } = await apiFetch<{ xray: XrayResult; isOwner: boolean }>(`/api/xray/${encodeURIComponent(initial.from)}`);
          const bundle = await loadBundle(xray.occupationCode);
          if (!live) return;
          const f: FromMap = {
            id: xray.id,
            version: xray.version,
            isOwner,
            occupationCode: xray.occupationCode,
            jobTitle: xray.jobTitle,
            shares: xray.shares,
            inputSource: xray.inputSource,
          };
          setFrom(f);
          setChosen({ code: xray.occupationCode, title: bundle.title, jobTitle: xray.jobTitle, inputSource: xray.inputSource });
          if (initial.step === 'occupation') {
            setQuery(xray.jobTitle);
            go('who', true);
          } else {
            setWeek({ shares: xray.shares, matches: {}, unmappedDuties: [], source: xray.inputSource === 'title' ? 'onet' : 'resume' });
            go('week', true);
          }
        } catch {
          go('who', true);
        }
        setReady(true);
        return;
      }
      if (initial.code) {
        try {
          const bundle = await loadBundle(initial.code);
          if (!live) return;
          setChosen({ code: bundle.code, title: bundle.title, jobTitle: bundle.title, inputSource: 'title' });
          setWeek({ shares: defaultShares(bundle), matches: {}, unmappedDuties: [], source: 'onet' });
          go('week', true);
        } catch {
          go('who', true);
        }
        setReady(true);
        return;
      }
      if (initial.sample === 'nurse' || initial.sample === 'electrician' || initial.sample === 'software' || initial.sample === 'accountant') {
        setReady(true);
        void runSample(initial.sample);
        return;
      }
      const draft = initial.step ? readDraft<Draft>() : null;
      // A reload during the scan after the map was saved: the map exists, open it instead of saving again.
      if (initial.step === 'scan' && draft?.chosen && draft.week) {
        const rec = readScan();
        if (rec?.savedId && rec.key.startsWith(`${draft.chosen.code}|${draft.chosen.jobTitle}|`)) {
          window.location.replace(`/x/${rec.savedId}`);
          return;
        }
      }
      if (draft && isStep(initial.step)) {
        setQuery(draft.query ?? '');
        setAnalysis(draft.analysis);
        setSelected(draft.selected);
        setChosen(draft.chosen);
        setWeek(draft.week);
        setFrom(draft.from);
        if (initial.step === 'occupation' && !draft.analysis && draft.pending?.text) {
          // The page was reloaded while the text was being read: read it again.
          setReady(true);
          void runAnalysis(draft.pending.text, draft.pending.origin, true);
          return;
        }
        let s: Step = initial.step === 'scan' ? 'week' : initial.step;
        if (s === 'week' && (!draft.chosen || !draft.week)) s = draft.analysis ? 'occupation' : 'who';
        if (s === 'occupation' && !draft.analysis) s = 'who';
        go(s, true);
      } else if (initial.step && initial.step !== 'who') {
        go('who', true);
      }
      setReady(true);
    };
    void start();
    return () => {
      live = false;
    };
    // Runs once for the URL the person arrived with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!ready) return;
    const pending = !analysis && pendingText && pendingOrigin ? { text: pendingText, origin: pendingOrigin } : null;
    const draft: Draft = { step, query, analysis, selected, chosen, week, from, pending };
    writeDraft(draft);
  }, [ready, step, query, analysis, selected, chosen, week, from, pendingText, pendingOrigin]);

  /* ---------- render ---------- */

  return (
    <div className={st.flow} data-step={step}>
      <FlowHeader step={step} />
      <main className={st.main} id="main">
        {step === 'who' ? (
          <StepWho
            query={query}
            onQuery={setQuery}
            onPick={onPick}
            onAnalyze={(text, origin) => void runAnalysis(text, origin)}
            panel={panel}
            onPanel={setPanel}
            pasteText={pasteText}
            onPasteText={setPasteText}
            describeText={describeText}
            onDescribeText={setDescribeText}
            problem={problem}
            onClearProblem={() => setProblem(null)}
          />
        ) : null}
        {step === 'occupation' ? (
          <StepOccupation
            analysis={analysis}
            pendingOrigin={pendingOrigin}
            pendingText={pendingText}
            failed={analysisFailed}
            onRetry={() => lastText.current && void runAnalysis(lastText.current.text, lastText.current.origin, true)}
            selected={selected}
            onSelect={setSelected}
            onConfirm={onConfirm}
            onBack={() => {
              seq.current++;
              go('who');
            }}
          />
        ) : null}
        {(step === 'week' || step === 'scan') && chosen ? (
          <StepWeek
            chosen={chosen}
            week={week}
            weekFailed={weekFailed}
            fallback={fallback}
            onRetry={() => lastWeekReq.current && void loadWeek(lastWeekReq.current.code, lastWeekReq.current.duties)}
            onWeek={setWeek}
            onChangeOccupation={() => {
              if (analysis) go('occupation');
              else {
                if (chosen.inputSource === 'title' && !query) setQuery(chosen.jobTitle);
                go('who');
              }
            }}
            from={from}
            scanning={step === 'scan'}
            onScan={(on) => go(on ? 'scan' : 'week', !on)}
          />
        ) : null}
      </main>
    </div>
  );
}

/* ---------- helpers ---------- */

function problemFrom(err: unknown): WhoProblem | null {
  if (!(err instanceof ApiError)) return null;
  const body = err.body as { reason?: string; signals?: { dates: boolean; titles: boolean; verbs: boolean } } | null;
  if (err.status === 422) {
    switch (err.code) {
      case 'not_a_resume':
        return body?.reason === 'not_work_text' ? { kind: 'not_work' } : { kind: 'not_resume', signals: body?.signals ?? null };
      case 'unclear_description':
        return { kind: 'unclear' };
      case 'too_short':
        return { kind: 'too_short' };
      case 'no_match':
        return { kind: 'no_match' };
      default:
        return { kind: 'not_work' };
    }
  }
  if (err.status === 503 || err.code === 'ai_unavailable') return { kind: 'ai_down' };
  if (err.status === 429) return { kind: 'rate_limited' };
  if (err.status === 400) return { kind: 'too_short' };
  return null;
}

const cap = (s: string) => (s ? s[0].toLocaleUpperCase() + s.slice(1) : s);

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/** Every word the person typed is a whole word of the matched title (not half a word still being typed). */
function wholeWords(typed: string, matched: string) {
  const have = new Set(fold(matched).split(' '));
  const words = fold(typed).split(' ').filter(Boolean);
  return words.length > 0 && words.every((w) => have.has(w));
}

/**
 * The words the map calls the person's job. Never a title they did not say, and never an altered one:
 * - 3 or more letters typed as whole words of the picked title (or a Cyrillic title found through
 *   translation): what they typed, tidied, first letter capitalised;
 * - an abbreviation typed in lower case keeps its catalogue spelling: «rn» → «RN»;
 * - otherwise the O*NET title exactly as published (no singular, no lower case).
 * (Résumé input keeps the résumé's own title, see onConfirm.)
 */
function jobTitleFrom(item: SearchItem, typed: string): string {
  const t = typed.replace(/\s+/g, ' ').trim().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}).]+$/gu, '');
  if (t.length < 3) return item.title.slice(0, 120);
  const m = matchedTerm(item.matched);
  if (t.length <= 5 && fold(m) === fold(t)) return m.slice(0, 120);
  const translated = hasCyrillic(t) && !hasCyrillic(m);
  if (translated || wholeWords(t, m) || wholeWords(t, item.title)) return cap(t).slice(0, 120);
  return item.title.slice(0, 120);
}

