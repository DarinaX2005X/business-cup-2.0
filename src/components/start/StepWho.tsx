'use client';

import { forwardRef, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ClipboardPaste, FileText, PenLine, X } from 'lucide-react';
import { Button, Combobox, Dropzone, KitProvider, type ComboItem } from '@/components/kit';
import { kitStringsFor } from '@/components/kit/locales';
import { useT } from '@/i18n/client';
import { loadSample, searchOccupations } from './data';
import { ExampleWeek } from './ExampleWeek';
import { readResumeFile, ReadFileError } from './readFile';
import type { SampleName, SearchItem, SearchResponse, TextOrigin, WhoProblem } from './types';
import st from './start.module.css';

export type WhoPanel = 'drop' | 'paste' | 'describe';

export interface StepWhoProps {
  query: string;
  onQuery: (q: string) => void;
  onPick: (item: SearchItem, typed: string) => void;
  onAnalyze: (text: string, origin: TextOrigin) => void;
  panel: WhoPanel;
  onPanel: (p: WhoPanel) => void;
  pasteText: string;
  onPasteText: (v: string) => void;
  describeText: string;
  onDescribeText: (v: string) => void;
  problem: WhoProblem | null;
  onClearProblem: () => void;
}

/** Local index search while typing; the model translation only after a pause, for 4+ letters. */
const SAMPLE_LABEL: Record<SampleName, string> = {
  nurse: 'start.who.sampleNurse',
  software: 'start.who.sampleSoftware',
  accountant: 'start.who.sampleAccountant',
  electrician: 'start.who.sampleElectrician',
};

const SEARCH_DEBOUNCE = 250;
const TRANSLATE_PAUSE = 700;
const TRANSLATE_MIN_LETTERS = 4;

export function StepWho(props: StepWhoProps) {
  const { query, onQuery, onPick, onAnalyze, panel, onPanel, problem, onClearProblem } = props;
  const { t, locale } = useT();
  const search = useSearch(query, locale);
  const narrow = useNarrow();
  const [emptyEnter, setEmptyEnter] = useState(false);
  const comboRef = useRef<HTMLDivElement>(null);

  // Arriving with the title already typed (the landing sends /start?q=): show its suggestions at once.
  const arrivedWith = useRef(query.trim());
  useEffect(() => {
    if (arrivedWith.current.length >= 2) comboRef.current?.querySelector('input')?.focus();
  }, []);
  const describeRef = useRef<HTMLTextAreaElement>(null);
  const pasteRef = useRef<HTMLTextAreaElement>(null);

  // Read failures that only concern the file, shown inside the dropzone.
  const [file, setFile] = useState<{ state: 'idle' | 'reading' | 'error'; name: string; page: number; total: number; error: string | null }>({
    state: 'idle',
    name: '',
    page: 0,
    total: 0,
    error: null,
  });
  const [sampleLoading, setSampleLoading] = useState<SampleName | null>(null);
  const [sampleFailed, setSampleFailed] = useState(false);

  // When the model is down, the title field is the way forward: put the cursor there.
  useEffect(() => {
    if (problem?.kind === 'ai_down' || problem?.kind === 'rate_limited' || problem?.kind === 'no_match') {
      comboRef.current?.querySelector('input')?.focus();
    }
    if (problem && ['not_resume', 'not_work', 'too_short', 'unclear'].includes(problem.kind)) describeRef.current?.focus();
  }, [problem]);

  useEffect(() => {
    if (panel === 'paste') pasteRef.current?.focus();
    if (panel === 'describe') describeRef.current?.focus();
  }, [panel]);

  // Weak results: the server says so (lowConfidence), or a word the person typed appears in none of them
  // («chief happiness officer»). Then «No exact match» is said and each option is marked as only close.
  const weak = !!search.response && search.forQuery === query.trim() && search.response.results.length > 0 && isWeak(search.response, query);
  const items: ComboItem[] = useMemo(() => {
    const r = search.response;
    if (!r) return [];
    // In Russian or Kazakh the local title leads and the English O*NET title sits small beneath it.
    const local = (title: string, localTitle: string | null) => (locale !== 'en' && localTitle ? localTitle : title);
    const under = (title: string, localTitle: string | null) => (locale !== 'en' && localTitle && !sameTitle(localTitle, title) ? title : undefined);
    const list: ComboItem[] = r.results.length
      ? r.results.map((it) => ({
          value: it.code,
          label: local(it.title, it.localTitle),
          hint: under(it.title, it.localTitle) ?? (weak ? t('start.who.closestHint') : undefined),
          matched: under(it.title, it.localTitle) || weak || sameTitle(it.matched, it.title) ? undefined : matchedTerm(it.matched),
        }))
      : r.suggestions.map((s) => ({ value: s.code, label: local(s.title, s.localTitle), hint: under(s.title, s.localTitle) ?? t('start.who.closestHint') }));
    // The way out is always in the list, last.
    return [...list, { value: DESCRIBE, label: t('start.who.describeInstead'), hint: t('start.who.describeHint') }];
  }, [search.response, t, locale, weak]);

  const noMatch =
    !!search.response &&
    !search.translating &&
    search.forQuery === query.trim() &&
    query.trim().length >= 2 &&
    (search.response.results.length === 0 || weak);

  const pick = (item: ComboItem) => {
    if (item.value === DESCRIBE) {
      onPanel('describe');
      return;
    }
    const r = search.response;
    const hit = r?.results.find((x) => x.code === item.value);
    const sug = r?.suggestions.find((x) => x.code === item.value);
    const chosen: SearchItem | null = hit ?? (sug ? { code: sug.code, title: sug.title, matched: sug.title, kind: 'primary', localTitle: sug.localTitle } : null);
    if (chosen) onPick(chosen, query.trim());
  };

  const onFile = async (f: File) => {
    onClearProblem();
    setFile({ state: 'reading', name: f.name, page: 0, total: 0, error: null });
    try {
      const text = await readResumeFile(f, (page, total) => setFile((s) => ({ ...s, page, total })));
      setFile({ state: 'idle', name: f.name, page: 0, total: 0, error: null });
      onAnalyze(text, { mode: 'resume', sample: null, fileName: f.name });
    } catch (err) {
      const reason = err instanceof ReadFileError ? err.reason : 'pdf_broken';
      setFile({ state: 'error', name: f.name, page: 0, total: 0, error: t(`start.who.fileErrors.${reason}`) });
      // A scan or a Word file: the text has to come another way, so open that way right here.
      if (reason === 'pdf_no_text') onPanel('describe');
      if (reason === 'word' || reason === 'pdf_unavailable') onPanel('paste');
    }
  };

  const runSample = async (name: SampleName) => {
    onClearProblem();
    setSampleFailed(false);
    setSampleLoading(name);
    try {
      const text = await loadSample(name);
      onAnalyze(text, { mode: 'resume', sample: name, fileName: null });
    } catch {
      setSampleFailed(true);
    } finally {
      setSampleLoading(null);
    }
  };

  const dropStrings = useMemo(
    () => ({
      ...kitStringsFor(locale),
      dropTitle: t('start.who.dropTitle'),
      dropHint: t('start.who.dropHint'),
      dropActive: t('start.who.dropActive'),
      dropRetry: t('start.who.chooseAnother'),
      dropReading: (name: string) =>
        file.total > 0 ? t('start.who.readingPage', { page: file.page, total: file.total }) : t('start.who.readingFile', { file: name }),
      dropDone: (name: string) => t('start.who.fileReady', { file: name }),
    }),
    [locale, t, file.page, file.total],
  );

  const comboHelp = search.translating
    ? t('start.who.translating')
    : search.response?.hint === 'try_english'
      ? t('start.who.tryEnglish')
      : search.response?.translated && search.forQuery === query.trim()
        ? t('start.who.searchedAs', { term: search.response.translated })
        : undefined;

  const titleProblem = problem && ['ai_down', 'rate_limited', 'no_match'].includes(problem.kind) ? t(`start.who.problems.${problem.kind}`) : null;
  const textProblem = problem && !['ai_down', 'rate_limited', 'no_match'].includes(problem.kind) ? t(`start.who.problems.${problem.kind}`) : null;

  return (
    <section className={st.who} aria-labelledby="who-title">
      <div className={st.whoMain}>
      <h1 id="who-title" className={st.h1}>
        {t('start.who.title')}
      </h1>
      <p className={st.whoLead}>{t('start.who.lead')}</p>

      <div
        ref={comboRef}
        className={st.titleField}
        data-alert={titleProblem ? true : undefined}
        onKeyDownCapture={(e) => {
          if (e.key !== 'Enter' || (e.target as HTMLElement).getAttribute('role') !== 'combobox') return;
          // Enter on an empty field says what to type instead of doing nothing.
          if (!query.trim()) {
            e.preventDefault();
            setEmptyEnter(true);
            return;
          }
          // Enter on a Cyrillic title nothing matched yet: ask for the translation now.
          if (search.translatable) search.translateNow();
        }}
      >
        <Combobox
          label={t('start.who.fieldLabel')}
          labelHidden
          size="lg"
          query={query}
          onQueryChange={(q) => {
            onQuery(q);
            setEmptyEnter(false);
            if (problem && ['ai_down', 'rate_limited', 'no_match'].includes(problem.kind)) return;
            onClearProblem();
          }}
          items={query.trim().length >= 2 ? items : []}
          onPick={pick}
          loading={search.loading}
          emptyText={query.trim().length < 2 ? t('start.who.keepTyping') : search.translating ? t('start.who.translating') : t('start.who.noResults')}
          placeholder={narrow ? t('start.who.placeholderShort') : t('start.who.placeholder')}
          help={comboHelp}
        />
        {emptyEnter ? (
          <p className={st.notice} role="status">
            {t('start.who.emptyEnter')}
          </p>
        ) : null}
        {titleProblem ? (
          <p className={st.notice} role="status">
            {titleProblem}
          </p>
        ) : null}
        {noMatch ? (
          <div className={st.noMatch} role="status">
            <p>
              {weak || search.response!.suggestions.length
                ? t('start.who.noMatch', { query: query.trim() })
                : t('start.who.noMatchNoSuggestions', { query: query.trim() })}
            </p>
            {!weak && search.response!.suggestions.length ? (
              <ul className={st.suggestions}>
                {search.response!.suggestions.map((s) => (
                  <li key={s.code}>
                    <button
                      type="button"
                      className={st.suggestion}
                      onClick={() => onPick({ code: s.code, title: s.title, matched: s.title, kind: 'primary', localTitle: s.localTitle }, query.trim())}
                    >
                      {locale !== 'en' && s.localTitle ? s.localTitle : s.title}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <Button variant="secondary" size="sm" icon={<PenLine />} onClick={() => onPanel('describe')}>
              {t('start.who.describeInstead')}
            </Button>
          </div>
        ) : null}
      </div>

      <div className={st.or} aria-hidden="true">
        <span>{t('start.who.or')}</span>
      </div>

      <div className={st.textSlot}>
        {panel === 'drop' ? (
          <KitProvider locale={locale} strings={dropStrings}>
            <Dropzone
              onFile={onFile}
              state={file.state}
              fileName={file.name}
              error={file.error ?? undefined}
              accept=".pdf,.txt,.md,.rtf,application/pdf,text/plain"
            />
          </KitProvider>
        ) : (
          <TextPanel
            ref={panel === 'paste' ? pasteRef : describeRef}
            kind={panel}
            value={panel === 'paste' ? props.pasteText : props.describeText}
            onChange={panel === 'paste' ? props.onPasteText : props.onDescribeText}
            reason={
              problem && ['not_resume', 'not_work'].includes(problem.kind)
                ? textProblem
                : file.state === 'error'
                  ? file.error
                  : null
            }
            problem={problem && ['too_short', 'unclear', 'network'].includes(problem.kind) ? textProblem : null}
            onClose={() => {
              onClearProblem();
              setFile((s) => ({ ...s, state: 'idle', error: null }));
              onPanel('drop');
            }}
            onSubmit={(text) => {
              onClearProblem();
              onAnalyze(text, { mode: panel === 'paste' ? 'resume' : 'description', sample: null, fileName: null });
            }}
          />
        )}
        {panel === 'drop' && textProblem ? (
          <div className={st.problem} role="alert">
            <p>{textProblem}</p>
            <Button variant="secondary" size="sm" icon={<PenLine />} onClick={() => onPanel('describe')}>
              {t('start.who.describeInstead')}
            </Button>
          </div>
        ) : null}
      </div>

      <div className={st.altRow}>
        <p className={st.samples}>
          <span className={st.samplesLead}>{t('start.who.samplesLead')}</span>
          {(['nurse', 'software', 'accountant', 'electrician'] as const).map((name) => (
            <button
              key={name}
              type="button"
              className={st.sampleLink}
              onClick={() => runSample(name)}
              aria-busy={sampleLoading === name || undefined}
              disabled={!!sampleLoading}
            >
              <FileText size={17} strokeWidth={1.75} aria-hidden="true" />
              {t(SAMPLE_LABEL[name])}
            </button>
          ))}
        </p>
        {panel !== 'paste' ? (
          <Button variant="quiet" size="sm" icon={<ClipboardPaste />} onClick={() => onPanel('paste')}>
            {t('start.who.pasteInstead')}
          </Button>
        ) : null}
      </div>
      {sampleFailed ? (
        <p className={st.inlineError} role="alert">
          {t('common.errors.network')}
        </p>
      ) : null}
      </div>
      <ExampleWeek />
    </section>
  );
}

/* ---------- paste and describe ---------- */

const TextPanel = forwardRef<
  HTMLTextAreaElement,
  {
    kind: 'paste' | 'describe';
    value: string;
    onChange: (v: string) => void;
    onSubmit: (text: string) => void;
    onClose: () => void;
    /** Why this box opened (the file or text before could not be used); not a fault of what is typed here. */
    reason: string | null;
    problem: string | null;
  }
>(function TextPanel({ kind, value, onChange, onSubmit, onClose, reason, problem }, ref) {
  const { t } = useT();
  const id = `start-${kind}`;
  const ok = value.trim().length > 0;
  return (
    <form
      className={st.sheetPanel}
      data-kind={kind}
      onSubmit={(e) => {
        e.preventDefault();
        if (ok) onSubmit(value.trim());
      }}
    >
      <div className={st.sheetHead}>
        <label htmlFor={id} className={st.sheetLabel}>
          {kind === 'paste' ? t('start.who.pasteLabel') : t('start.who.describeLabel')}
        </label>
        <button type="button" className={st.iconBtn} onClick={onClose} aria-label={t('start.who.close')}>
          <X size={20} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>
      {reason ? (
        <p className={st.panelReason} role="alert">
          {reason}
        </p>
      ) : null}
      <textarea
        ref={ref}
        id={id}
        className={st.textarea}
        data-kind={kind}
        value={value}
        rows={kind === 'paste' ? 9 : 4}
        placeholder={kind === 'paste' ? t('start.who.pastePlaceholder') : t('start.who.describePlaceholder')}
        aria-invalid={problem ? true : undefined}
        aria-describedby={problem ? `${id}-err` : undefined}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && ok) {
            e.preventDefault();
            onSubmit(value.trim());
          }
        }}
      />
      {problem ? (
        <p id={`${id}-err`} className={st.inlineError} role="alert">
          {problem}
        </p>
      ) : null}
      <div className={st.sheetFoot}>
        <Button type="submit" disabled={!ok}>
          {kind === 'paste' ? t('start.who.pasteSubmit') : t('start.who.describeSubmit')}
        </Button>
      </div>
    </form>
  );
});

/* ---------- search ---------- */

function useSearch(query: string, locale: string) {
  const [state, setState] = useState<{ response: SearchResponse | null; forQuery: string; translated: boolean; failedFor: string }>({
    response: null,
    forQuery: '',
    translated: false,
    failedFor: '',
  });
  const [force, setForce] = useState('');
  const q = query.trim();
  const letters = (q.match(/\p{L}/gu) ?? []).length;

  // While typing: the local index only (translate=0), never a model call per keystroke.
  useEffect(() => {
    if (q.length < 2) return;
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => {
      searchOccupations(q, locale as 'en', { signal: ctrl.signal, translate: false })
        .then((response) => setState({ response, forQuery: q, translated: false, failedFor: '' }))
        .catch((err) => {
          if ((err as Error).name !== 'AbortError') setState((s) => ({ ...s, failedFor: q }));
        });
    }, SEARCH_DEBOUNCE);
    return () => {
      window.clearTimeout(timer);
      ctrl.abort();
    };
  }, [q, locale]);

  // A Cyrillic title nothing matched yet: once typing pauses (or on Enter), ask for its translation.
  const translatable = state.forQuery === q && !state.translated && !!state.response?.translatable && !state.response.results.length;
  const wantTranslation = translatable && letters >= TRANSLATE_MIN_LETTERS;
  useEffect(() => {
    if (!wantTranslation) return;
    const ctrl = new AbortController();
    const timer = window.setTimeout(
      () => {
        searchOccupations(q, locale as 'en', { signal: ctrl.signal, translate: true })
          .then((response) => setState({ response, forQuery: q, translated: true, failedFor: '' }))
          .catch((err) => {
            if ((err as Error).name !== 'AbortError') setState((s) => ({ ...s, translated: true, failedFor: q }));
          });
      },
      force === q ? 0 : TRANSLATE_PAUSE - SEARCH_DEBOUNCE,
    );
    return () => {
      window.clearTimeout(timer);
      ctrl.abort();
    };
  }, [wantTranslation, q, locale, force]);

  if (q.length < 2) return { response: null, forQuery: '', loading: false, translating: false, translatable: false, translateNow: () => undefined };
  return {
    // The previous answer stays on screen while the next one loads, so the list never blinks.
    response: state.response,
    forQuery: state.forQuery,
    loading: state.forQuery !== q && state.failedFor !== q,
    translating: wantTranslation,
    translatable: wantTranslation,
    translateNow: () => setForce(q),
  };
}

const NARROW = '(max-width: 480px)';
/** Narrow phones get the short placeholder, so it is never cut off. */
function useNarrow() {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(NARROW);
      m.addEventListener('change', cb);
      return () => m.removeEventListener('change', cb);
    },
    () => window.matchMedia(NARROW).matches,
    () => false,
  );
}

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

const DESCRIBE = '__describe';

/**
 * Low confidence: the server flag when it sends one, else a word of 3+ letters the person typed that
 * starts no word of any result (title, matched title or local title).
 */
function isWeak(r: SearchResponse & { lowConfidence?: boolean; confident?: boolean }, query: string) {
  if (typeof r.lowConfidence === 'boolean') return r.lowConfidence;
  // The search route sends `confident` (src/server/xray/search.ts): false means the top hit is weak.
  if (typeof r.confident === 'boolean' && r.results.length) return !r.confident;
  const words = fold(query).split(' ').filter((w) => w.length >= 3);
  if (!words.length) return false;
  const have = new Set(r.results.flatMap((it) => fold(`${it.title} ${it.matched} ${it.localTitle ?? ''}`).split(' ')));
  return words.some((w) => ![...have].some((h) => h.startsWith(w)));
}

function sameTitle(a: string, b: string) {
  return fold(a) === fold(b);
}

/** «RN → Registered Nurses» keeps only the person's term. */
export function matchedTerm(matched: string) {
  return matched.split('→')[0].trim();
}
