'use client';

import { forwardRef, useEffect, useMemo, useRef, useState } from 'react';
import { ClipboardPaste, FileText, PenLine, X } from 'lucide-react';
import { Button, Combobox, Dropzone, KitProvider, type ComboItem } from '@/components/kit';
import { kitStringsFor } from '@/components/kit/locales';
import { useT } from '@/i18n/client';
import { loadSample, searchOccupations } from './data';
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

const SEARCH_DEBOUNCE = 150;

export function StepWho(props: StepWhoProps) {
  const { query, onQuery, onPick, onAnalyze, panel, onPanel, problem, onClearProblem } = props;
  const { t, locale } = useT();
  const search = useSearch(query, locale);
  const comboRef = useRef<HTMLDivElement>(null);
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

  const items: ComboItem[] = useMemo(() => {
    const r = search.response;
    if (!r) return [];
    if (r.results.length) {
      return r.results.map((it) => ({
        value: it.code,
        label: it.title,
        hint: sameTitle(it.matched, it.title) ? undefined : t('start.who.matched', { term: matchedTerm(it.matched) }),
      }));
    }
    return r.suggestions.map((s) => ({ value: s.code, label: s.title, hint: t('start.who.closestHint') }));
  }, [search.response, t]);

  const noMatch = !!search.response && search.response.results.length === 0 && search.forQuery === query.trim() && query.trim().length >= 2;

  const pick = (item: ComboItem) => {
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

  const comboHelp =
    search.response?.hint === 'try_english'
      ? t('start.who.tryEnglish')
      : search.response?.translated && search.forQuery === query.trim()
        ? t('start.who.searchedAs', { term: search.response.translated })
        : undefined;

  const titleProblem = problem && ['ai_down', 'rate_limited', 'no_match'].includes(problem.kind) ? t(`start.who.problems.${problem.kind}`) : null;
  const textProblem = problem && !['ai_down', 'rate_limited', 'no_match'].includes(problem.kind) ? t(`start.who.problems.${problem.kind}`) : null;

  return (
    <section className={st.who} aria-labelledby="who-title">
      <h1 id="who-title" className={st.h1}>
        {t('start.who.title')}
      </h1>

      <div
        ref={comboRef}
        className={st.titleField}
        data-alert={titleProblem ? true : undefined}
        onKeyDownCapture={(e) => {
          // Enter with the list open and nothing highlighted takes the first suggestion.
          const input = e.target as HTMLInputElement;
          if (e.key !== 'Enter' || input.getAttribute('role') !== 'combobox' || input.getAttribute('aria-activedescendant')) return;
          const first = query.trim().length >= 2 ? items[0] : undefined;
          if (!first || input.getAttribute('aria-expanded') !== 'true') return;
          e.preventDefault();
          e.stopPropagation();
          pick(first);
        }}
      >
        <Combobox
          label={t('start.who.fieldLabel')}
          labelHidden
          size="lg"
          query={query}
          onQueryChange={(q) => {
            onQuery(q);
            if (problem && ['ai_down', 'rate_limited', 'no_match'].includes(problem.kind)) return;
            onClearProblem();
          }}
          items={query.trim().length >= 2 ? items : []}
          onPick={pick}
          loading={search.loading}
          emptyText={query.trim().length < 2 ? t('start.who.keepTyping') : t('start.who.noResults')}
          placeholder={t('start.who.placeholder')}
          help={comboHelp}
        />
        {titleProblem ? (
          <p className={st.notice} role="status">
            {titleProblem}
          </p>
        ) : null}
        {noMatch ? (
          <div className={st.noMatch} role="status">
            <p>
              {search.response!.suggestions.length
                ? t('start.who.noMatch', { query: query.trim() })
                : t('start.who.noMatchNoSuggestions', { query: query.trim() })}
            </p>
            {search.response!.suggestions.length ? (
              <ul className={st.suggestions}>
                {search.response!.suggestions.map((s) => (
                  <li key={s.code}>
                    <button
                      type="button"
                      className={st.suggestion}
                      onClick={() => onPick({ code: s.code, title: s.title, matched: s.title, kind: 'primary', localTitle: s.localTitle }, query.trim())}
                    >
                      {s.title}
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
              accept=".pdf,.txt,.md,.rtf,.doc,.docx,application/pdf,text/plain"
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
        <div className={st.samples}>
          <button type="button" className={st.textLink} onClick={() => runSample('nurse')} aria-busy={sampleLoading === 'nurse' || undefined}>
            <FileText size={18} strokeWidth={1.75} aria-hidden="true" />
            {t('start.who.sampleNurse')}
          </button>
          <button type="button" className={st.textLinkQuiet} onClick={() => runSample('electrician')} aria-busy={sampleLoading === 'electrician' || undefined}>
            {t('start.who.sampleElectrician')}
          </button>
        </div>
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
  const [state, setState] = useState<{ response: SearchResponse | null; forQuery: string; failedFor: string }>({ response: null, forQuery: '', failedFor: '' });
  const q = query.trim();
  useEffect(() => {
    if (q.length < 2) return;
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => {
      searchOccupations(q, locale as 'en', ctrl.signal)
        .then((response) => setState({ response, forQuery: q, failedFor: '' }))
        .catch((err) => {
          if ((err as Error).name !== 'AbortError') setState((s) => ({ ...s, failedFor: q }));
        });
    }, SEARCH_DEBOUNCE);
    return () => {
      window.clearTimeout(timer);
      ctrl.abort();
    };
  }, [q, locale]);
  if (q.length < 2) return { response: null, forQuery: '', loading: false };
  // The previous answer stays on screen while the next one loads, so the list never blinks.
  return { response: state.response, forQuery: state.forQuery, loading: state.forQuery !== q && state.failedFor !== q };
}

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

function sameTitle(a: string, b: string) {
  return fold(a) === fold(b);
}

/** «RN → Registered Nurses» keeps only the person's term. */
export function matchedTerm(matched: string) {
  return matched.split('→')[0].trim();
}
