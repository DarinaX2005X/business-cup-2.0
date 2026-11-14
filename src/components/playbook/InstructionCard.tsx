'use client';

import { Check, Copy, Dumbbell, PencilLine } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/components/kit/Button';
import { CategoryChip } from '@/components/kit/Evidence';
import { Skeleton } from '@/components/kit/Skeleton';
import { sound } from '@/components/kit/sound';
import { Toast } from '@/components/kit/Toast';
import btn from '@/components/kit/controls.module.css';
import { useT } from '@/i18n/client';
import { useProfile } from '@/lib/client/profile';
import { clearEdit, copyText, errorCode, errorKey, recordCopy, saveEdit, slotsOf, startDelegate, type PlaybookCard, type PlaybookView } from './api';
import st from './playbook.module.css';

const EDIT_MAX = 2400;

/**
 * One playbook card: a two-part sheet. The upper part goes to the AI (hatched strip «To: ChatGPT,
 * Claude or Copilot»): the instruction with its source and the actions. Along a tear line, the lower
 * part stays with the person (apricot tag): the checks they run on the result, their own misses
 * marked as theirs.
 */
export function InstructionCard({
  card,
  view,
  onCard,
  onRetryStarter,
}: {
  card: PlaybookCard;
  view: PlaybookView;
  onCard: (card: PlaybookCard) => void;
  onRetryStarter: () => void;
}) {
  const { t, f, locale } = useT();
  const { applyAwards } = useProfile();
  const headId = useId();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState<'save' | 'reset' | 'practise' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; tone: 'neutral' | 'success' | 'error' } | null>(null);
  const [copied, setCopied] = useState(false);
  const copyRef = useRef<HTMLButtonElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const [ticked, setTicked] = useState<Set<string>>(new Set());

  // a different task resets the local state of the card
  useEffect(() => {
    setEditing(false);
    setError(null);
    setToast(null);
    setCopied(false);
    setTicked(new Set());
  }, [card.taskId]);

  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 2400);
    return () => window.clearTimeout(id);
  }, [copied]);

  useEffect(() => {
    if (!editing) return;
    const el = areaRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [editing]);

  // keep the editor as tall as its text
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [draft, editing]);

  const score = (x: number) => Math.round(x * 100);
  const ins = card.instruction;
  const pending = !ins && view.starter === 'pending';
  const unavailable = !ins && view.starter === 'unavailable';
  const hasSlots = !!ins && slotsOf(ins.text).some((p) => p.slot);
  const belowBar = card.practice && card.practice.score < view.practiceBar && ins?.source !== 'practice';

  const sourceLabel = ins
    ? ins.source === 'practice' && card.practice
      ? t('playbook.card.source.practice', { score: score(card.practice.score) })
      : t(`playbook.card.source.${ins.source}`)
    : null;

  const onCopy = async () => {
    if (!ins) return;
    const ok = await copyText(ins.text);
    if (!ok) {
      setToast({ message: t('playbook.card.copyFailed'), tone: 'error' });
      return;
    }
    sound.play('tap');
    setCopied(true);
    setToast({ message: t('playbook.card.copiedToast'), tone: 'success' });
    if (card.copiedToday) return;
    try {
      const res = await recordCopy(card.taskId);
      onCard({ ...card, copiedToday: true });
      applyAwards(res.pointsAwarded, copyRef.current);
    } catch {
      /* the copy itself worked; points are a bonus and can be earned on the next copy */
    }
  };

  const onSave = async () => {
    setBusy('save');
    setError(null);
    try {
      const next = await saveEdit(card.taskId, draft, locale);
      onCard(next);
      setEditing(false);
      setToast({ message: t('playbook.edit.saved'), tone: 'success' });
    } catch (err) {
      setError(t(errorKey(errorCode(err))));
    } finally {
      setBusy(null);
    }
  };

  const onReset = async () => {
    setBusy('reset');
    setError(null);
    try {
      onCard(await clearEdit(card.taskId, locale));
    } catch (err) {
      setError(t(errorKey(errorCode(err))));
    } finally {
      setBusy(null);
    }
  };

  const onPractise = async () => {
    setBusy('practise');
    setError(null);
    try {
      const id = await startDelegate(card.taskId);
      window.location.assign(`/today?rep=${encodeURIComponent(id)}`);
    } catch (err) {
      setError(t(errorKey(errorCode(err))));
      setBusy(null);
    }
  };

  const toggle = (id: string) => {
    setTicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else {
        next.add(id);
        sound.play('tap');
      }
      return next;
    });
  };

  const resetLabel = card.practice && card.practice.score >= view.practiceBar ? t('playbook.card.usePractice') : t('playbook.card.useStarter');
  const canReset = ins?.source === 'edited' && (card.starter || card.practice);

  return (
    <article className={st.card} aria-labelledby={headId}>
      {/* ---------- the part that goes to the AI ---------- */}
      <div className={st.top}>
        <div className={st.to}>
          <span className={st.toLine}>
            <i className={st.machineTag} aria-hidden="true" />
            {t('playbook.card.to')}
          </span>
          {sourceLabel ? (
            <span className={st.source} data-source={ins!.source}>
              {sourceLabel}
            </span>
          ) : null}
        </div>

        <header className={st.cardHead}>
          <h2 id={headId} className={st.cardTitle}>
            {card.short}
          </h2>
          <p className={st.taskText}>{card.text}</p>
          <div className={st.meta}>
            <CategoryChip category={card.category} />
            <span>{t('playbook.card.hours', { hours: f.number(card.hours, { maximumFractionDigits: 1 }) })}</span>
          </div>
        </header>

        {editing ? (
          <div className={st.editor}>
            <label htmlFor={`${headId}-edit`} className={st.editLabel}>
              {t('playbook.edit.label')}
            </label>
            <textarea
              id={`${headId}-edit`}
              ref={areaRef}
              className={st.area}
              value={draft}
              maxLength={EDIT_MAX}
              onChange={(e) => setDraft(e.target.value)}
              aria-describedby={`${headId}-edit-hint`}
            />
            <div className={st.editFoot}>
              <p id={`${headId}-edit-hint`} className={st.hint}>
                {t('playbook.edit.hint')}
              </p>
              <span className={st.count}>{t('playbook.edit.count', { n: f.integer(draft.length), max: f.integer(EDIT_MAX) })}</span>
            </div>
          </div>
        ) : pending ? (
          <div className={st.instrPending} role="status">
            <Skeleton width="96%" height={15} />
            <Skeleton width="88%" height={15} />
            <Skeleton width="92%" height={15} />
            <Skeleton width="64%" height={15} />
            <p className={st.pendingLine}>
              <span className={st.dotSpin} aria-hidden="true" />
              {t('playbook.card.writing')}
            </p>
          </div>
        ) : ins ? (
          <>
            <p className={st.instr}>
              {slotsOf(ins.text).map((p, i) =>
                p.slot ? (
                  <mark key={i} className={st.slot}>
                    {p.text}
                  </mark>
                ) : (
                  <span key={i}>{p.text}</span>
                ),
              )}
            </p>
            {hasSlots ? <p className={st.hint}>{t('playbook.card.slots')}</p> : null}
          </>
        ) : unavailable ? (
          <div className={st.unavailable}>
            <p>{t('playbook.card.unavailable')}</p>
            <Button variant="secondary" size="sm" onClick={onRetryStarter}>
              {t('playbook.card.retry')}
            </Button>
          </div>
        ) : (
          <p className={st.missing}>{t('playbook.card.missing')}</p>
        )}

        {belowBar && !editing ? (
          <p className={st.below}>{t('playbook.card.below', { score: score(card.practice!.score), bar: score(view.practiceBar) })}</p>
        ) : null}

        {error ? (
          <p className={st.inlineError} role="alert">
            {error}
          </p>
        ) : null}

        <div className={st.actions}>
          {editing ? (
            <>
              <Button loading={busy === 'save'} loadingLabel={t('playbook.edit.saving')} onClick={onSave}>
                {t('playbook.edit.save')}
              </Button>
              <Button variant="quiet" onClick={() => setEditing(false)}>
                {t('playbook.edit.cancel')}
              </Button>
            </>
          ) : (
            <>
              <Button ref={copyRef} icon={copied ? <Check strokeWidth={2} /> : <Copy strokeWidth={1.75} />} onClick={onCopy} disabled={!ins} className={st.copyBtn} data-copied={copied || undefined}>
                {copied ? t('playbook.card.copied') : t('playbook.card.copy')}
              </Button>
              <Button
                variant="secondary"
                icon={<PencilLine strokeWidth={1.75} />}
                disabled={pending}
                onClick={() => {
                  setDraft(ins?.text ?? card.practice?.text ?? '');
                  setError(null);
                  setEditing(true);
                }}
              >
                {t('playbook.card.edit')}
              </Button>
              {view.pro ? (
                <Button variant="quiet" icon={<Dumbbell strokeWidth={1.75} />} loading={busy === 'practise'} loadingLabel={t('playbook.card.practising')} onClick={onPractise}>
                  {t('playbook.card.practise')}
                </Button>
              ) : (
                <Link href="/today" className={`${btn.btn} ${btn.b_quiet} ${btn.s_md}`}>
                  <span className={btn.bIcon} aria-hidden="true">
                    <Dumbbell strokeWidth={1.75} />
                  </span>
                  <span>{t('playbook.card.practise')}</span>
                </Link>
              )}
              {canReset ? (
                <button type="button" className={st.textBtn} onClick={onReset} disabled={busy === 'reset'}>
                  {busy === 'reset' ? t('playbook.card.resetting') : resetLabel}
                </button>
              ) : null}
            </>
          )}
          {toast ? (
            <div className={st.toastSlot}>
              <Toast message={toast.message} tone={toast.tone} duration={4200} onClose={() => setToast(null)} />
            </div>
          ) : null}
        </div>
      </div>

      {/* ---------- the tear line ---------- */}
      <div className={st.perf} aria-hidden="true" />

      {/* ---------- the part that stays with the person ---------- */}
      <section className={st.bottom} aria-labelledby={`${headId}-checks`}>
        <h3 id={`${headId}-checks`} className={st.checksTitle}>
          <i className={st.humanTag} aria-hidden="true" />
          {t('playbook.checks.title')}
        </h3>
        {card.checks.length ? (
          <ul className={st.checks} role="list">
            {card.checks.map((c) => {
              const on = ticked.has(c.id);
              const mine = c.origin !== 'starter';
              return (
                <li key={c.id} className={st.check} data-mine={mine || undefined}>
                  <button type="button" role="checkbox" aria-checked={on} className={st.tick} onClick={() => toggle(c.id)}>
                    <span className={st.box} data-on={on || undefined} aria-hidden="true">
                      <svg viewBox="0 0 16 16">
                        <path d="M3.5 8.4l3 3 6-6.4" />
                      </svg>
                    </span>
                    <span className={st.checkText}>
                      {c.text}
                      {mine ? <span className={st.mineTag}>{c.origin === 'trap' ? t('playbook.checks.trap') : t('playbook.checks.slip')}</span> : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : pending ? (
          <div className={st.checksPending}>
            <Skeleton width="72%" height={14} />
            <Skeleton width="80%" height={14} />
            <Skeleton width="60%" height={14} />
          </div>
        ) : (
          <p className={st.missing}>{t('playbook.checks.none')}</p>
        )}
      </section>
    </article>
  );
}
