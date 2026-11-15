'use client';

import { CheckCheck, ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { MaxActions } from '@/components/cup/MaxActions';
import { errorCode, loadSecondLook, runSecondLook, type SecondLookResult, type SecondLookState } from '@/components/playbook/api';
import { Button } from '@/components/kit/Button';
import { RepCard } from '@/components/kit/RepCard';
import { LockedPanel } from '@/components/kit/Shop';
import { Skeleton } from '@/components/kit/Skeleton';
import { sound } from '@/components/kit/sound';
import type { ReviewMark } from '@/components/kit/types';
import btn from '@/components/kit/controls.module.css';
import { normalizeDocument, toLightMarkup } from '@/domain/reps';
import { useT } from '@/i18n/client';
import { useProfile } from '@/lib/client/profile';
import st from './second-look.module.css';

const MAX_CHARS = 4000;
const MIN_WORDS = 12;

type Phase = { p: 'edit' } | { p: 'reading'; doc: string } | { p: 'done'; result: SecondLookResult };

/** The same light form the server checks, for the sheet shown while it reads. */
function previewDoc(raw: string): string {
  return normalizeDocument(toLightMarkup(raw)).replace(/^( {0,2})# /gm, '$1## ');
}

const words = (s: string) => s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

/**
 * /second-look: paste a real AI draft from work, pick the task it is for, and get up to six «Check
 * this» places on the margin of the same sheet. The text lives only in this page: the server reads it
 * once and keeps a counter. Without Max there is one; after it the form becomes the Max offer.
 */
export function SecondLookScreen() {
  const { t, f, locale } = useT();
  const { status, profile, ensure, applyAwards } = useProfile();
  const fieldId = useId();
  const [state, setState] = useState<SecondLookState | null>(null);
  const [text, setText] = useState('');
  const [taskId, setTaskId] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ p: 'edit' });
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const summaryRef = useRef<HTMLHeadingElement>(null);

  const reload = useCallback(async () => {
    try {
      setState(await loadSecondLook(locale));
    } catch {
      // the form still works without the task list; the server decides the plan on submit
      setState({ pro: false, freeLeft: 1, jobTitle: profile?.jobTitle ?? null, tasks: [] });
    }
  }, [locale, profile?.jobTitle]);

  useEffect(() => {
    if (status === 'loading') return;
    void reload();
  }, [status, profile?.id, reload]);

  const job = state?.jobTitle ? state.jobTitle.toLowerCase() : null;
  const locked = !!state && !state.pro && state.freeLeft === 0 && phase.p === 'edit';

  const submit = async () => {
    setFieldError(null);
    setFailure(null);
    if (words(text) < MIN_WORDS) {
      setFieldError(t('playbook.errors.text_too_short'));
      areaRef.current?.focus();
      return;
    }
    if (text.length > MAX_CHARS) {
      setFieldError(t('playbook.errors.text_too_long'));
      areaRef.current?.focus();
      return;
    }
    setPhase({ p: 'reading', doc: previewDoc(text) });
    try {
      if (status !== 'ready') await ensure();
      const res = await runSecondLook(text, taskId, locale);
      setPhase({ p: 'done', result: res });
      setState((s) => (s ? { ...s, freeLeft: res.freeLeft } : s));
      sound.play('place');
      window.requestAnimationFrame(() => {
        summaryRef.current?.focus({ preventScroll: true });
        applyAwards(res.pointsAwarded, summaryRef.current);
      });
    } catch (err) {
      const code = errorCode(err);
      setPhase({ p: 'edit' });
      if (code === 'pro_required' || code === 'max_required') {
        setState((s) => (s ? { ...s, pro: false, freeLeft: 0 } : s));
        return;
      }
      if (code === 'text_too_short' || code === 'text_too_long') setFieldError(t(`playbook.errors.${code}`));
      else if (code === 'rate_limited' || code === 'network') setFailure(t(`common.errors.${code}`));
      else setFailure(t('playbook.secondLook.failed'));
      window.requestAnimationFrame(() => areaRef.current?.focus());
    }
  };

  const backToText = () => {
    setPhase({ p: 'edit' });
    window.requestAnimationFrame(() => areaRef.current?.focus());
  };

  const another = () => {
    setText('');
    setTaskId(null);
    setPhase({ p: 'edit' });
    window.requestAnimationFrame(() => areaRef.current?.focus());
  };

  return (
    <div className={st.page}>
      <header className={st.head}>
        <h1 className={st.h1}>{t('playbook.secondLook.title')}</h1>
        <p className={st.lead}>{job ? t('playbook.secondLook.lead', { job }) : t('playbook.secondLook.leadNoJob')}</p>
      </header>

      {!state ? (
        <LoadingView />
      ) : phase.p === 'done' ? (
        <ResultView result={phase.result} summaryRef={summaryRef} onEdit={backToText} onAnother={another} />
      ) : phase.p === 'reading' ? (
        <ReadingView doc={phase.doc} job={job} />
      ) : locked ? (
        <LockedView onUnlocked={() => void reload()} />
      ) : (
        <div className={st.layout}>
          <div className={st.sheetWrap}>
            <div className={st.sheet}>
              <div className={st.sheetHead}>
                <label htmlFor={fieldId} className={st.fieldLabel}>
                  {t('playbook.secondLook.field')}
                </label>
                <span className={st.aiTag}>
                  <i aria-hidden="true" />
                  {t('playbook.secondLook.drafted')}
                </span>
              </div>
              <textarea
                id={fieldId}
                ref={areaRef}
                className={st.area}
                value={text}
                placeholder={t('playbook.secondLook.placeholder')}
                onChange={(e) => {
                  setText(e.target.value);
                  if (fieldError) setFieldError(null);
                }}
                maxLength={MAX_CHARS + 200}
                aria-invalid={fieldError ? true : undefined}
                aria-describedby={`${fieldId}-privacy ${fieldError ? `${fieldId}-err` : ''}`}
                spellCheck={false}
              />
              <div className={st.sheetFoot}>
                <p id={`${fieldId}-privacy`} className={st.privacy}>
                  <ShieldAlert strokeWidth={1.75} aria-hidden="true" />
                  <b>{t('playbook.secondLook.privacy')}</b>
                </p>
                <span className={st.count} data-over={text.length > MAX_CHARS || undefined}>
                  {t('playbook.secondLook.count', { n: f.integer(text.length), max: f.integer(MAX_CHARS) })}
                </span>
              </div>
              {fieldError ? (
                <p id={`${fieldId}-err`} className={st.fieldError} role="alert">
                  {fieldError}
                </p>
              ) : null}
            </div>
          </div>

          <aside className={st.side}>
            <TaskPicker tasks={state.tasks} value={taskId} onChange={setTaskId} />
            {failure ? (
              <p className={st.failure} role="alert">
                {failure}
              </p>
            ) : null}
            <Button size="lg" block onClick={submit}>
              {t('playbook.secondLook.run')}
            </Button>
            {!state.pro && state.freeLeft ? <p className={st.free}>{t('playbook.secondLook.freeOne')}</p> : null}
            <p className={st.kept}>{t('playbook.secondLook.kept')}</p>
            <p className={st.lookFor}>{t('playbook.secondLook.lookFor')}</p>
          </aside>
        </div>
      )}
    </div>
  );
}

/* ---------- task picker: the week's tasks as a radio group of chips ---------- */

function TaskPicker({ tasks, value, onChange }: { tasks: SecondLookState['tasks']; value: string | null; onChange: (id: string | null) => void }) {
  const { t } = useT();
  const labelId = useId();
  const options = useMemo(() => [...tasks.map((x) => ({ id: x.taskId as string | null, label: x.short })), { id: null, label: t('playbook.secondLook.other') }], [tasks, t]);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent, i: number) => {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const n = (i + d + options.length) % options.length;
    onChange(options[n].id);
    refs.current[n]?.focus();
  };
  return (
    <div className={st.picker}>
      <p id={labelId} className={st.pickerLabel}>
        {t('playbook.secondLook.task')}
      </p>
      <div role="radiogroup" aria-labelledby={labelId} className={st.chips}>
        {options.map((o, i) => {
          const on = o.id === value;
          return (
            <button
              key={o.id ?? 'other'}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={on}
              tabIndex={on ? 0 : -1}
              className={st.chip}
              data-on={on || undefined}
              onClick={() => onChange(o.id)}
              onKeyDown={(e) => onKey(e, i)}
            >
              {o.label}
            </button>
          );
        })}
      </div>
      {!tasks.length ? <p className={st.pickerHint}>{t('playbook.secondLook.noMapTasks')}</p> : null}
    </div>
  );
}

/* ---------- reading: the same sheet, a slow band passing over it ---------- */

function ReadingView({ doc, job }: { doc: string; job: string | null }) {
  const { t } = useT();
  const title = t('playbook.secondLook.result.sheet');
  return (
    <div className={st.result}>
      <p className={st.readingLine} role="status">
        <span className={st.dotSpin} aria-hidden="true" />
        {job ? t('playbook.secondLook.reading', { job }) : t('playbook.secondLook.readingNoJob')}
      </p>
      <div className={st.reading}>
        <RepCard document={`# ${title}\n\n${doc}`} mode="review" ranges={[]} marks={[]} />
        <span className={st.beam} aria-hidden="true" />
      </div>
    </div>
  );
}

/* ---------- result: «Check this» notes on the margin ---------- */

function ResultView({
  result,
  summaryRef,
  onEdit,
  onAnother,
}: {
  result: SecondLookResult;
  summaryRef: RefObject<HTMLHeadingElement | null>;
  onEdit: () => void;
  onAnother: () => void;
}) {
  const { t } = useT();
  const title = t('playbook.secondLook.result.sheet');
  const head = `# ${title}\n\n`;
  const marks: ReviewMark[] = result.marks.map((m, i) => ({
    id: m.id,
    // the kit's outlined mark, recoloured below to the quiet «Check this» violet: a hint, not an error
    kind: 'missed',
    start: m.start + head.length,
    end: m.end + head.length,
    n: i + 1,
    title: t(`playbook.secondLook.type.${m.type}`),
    body: `${m.why} ${m.check}`,
  }));
  const clean = marks.length === 0;
  return (
    <div className={st.result}>
      <div className={st.summary}>
        <div className={st.summaryText}>
          <h2 ref={summaryRef} tabIndex={-1} className={st.summaryTitle} data-clean={clean || undefined}>
            {clean ? (
              <>
                <CheckCheck strokeWidth={1.75} aria-hidden="true" />
                {t('playbook.secondLook.result.cleanTitle')}
              </>
            ) : (
              t('playbook.secondLook.result.count', { count: marks.length })
            )}
          </h2>
          {clean ? <p className={st.summaryBody}>{t('playbook.secondLook.result.cleanBody')}</p> : null}
        </div>
        <div className={st.summaryActions}>
          <Button variant="secondary" onClick={onEdit}>
            {t('playbook.secondLook.result.edit')}
          </Button>
          <Button variant="quiet" onClick={onAnother}>
            {t('playbook.secondLook.result.another')}
          </Button>
        </div>
      </div>
      <div className={st.checked}>
        <RepCard
          document={head + result.document}
          mode="review"
          ranges={[]}
          marks={marks}
          footer={<p className={st.honest}>{t('playbook.secondLook.result.honest')}</p>}
        />
      </div>
      <p className={st.toPlaybook}>
        {t('playbook.secondLook.toPlaybook')}{' '}
        <Link href="/playbook" className={st.link}>
          {t('playbook.meta.title')}
        </Link>
      </p>
    </div>
  );
}

/* ---------- without Max, after the free one ---------- */

function LockedView({ onUnlocked }: { onUnlocked: () => void }) {
  const { t } = useT();
  return (
    <div className={st.lockedWrap}>
      <LockedPanel
        title={t('playbook.secondLook.locked.title')}
        reason={t('playbook.secondLook.locked.reason')}
        shape="list"
        action={<MaxActions onUnlocked={onUnlocked} />}
      />
    </div>
  );
}

function LoadingView() {
  return (
    <div className={st.layout} aria-hidden="true">
      <div className={st.sheetSkel}>
        <Skeleton width="50%" height={20} />
        <Skeleton height={300} radius={14} />
      </div>
      <div className={st.side}>
        <Skeleton width="60%" height={16} />
        <Skeleton height={44} radius={12} />
        <Skeleton height={60} radius={16} />
      </div>
    </div>
  );
}
