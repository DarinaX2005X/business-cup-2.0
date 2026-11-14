'use client';

import { Check, Copy, Printer } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/kit/Button';
import { KeystoneMark } from '@/components/kit/Mark';
import { LockedPanel } from '@/components/kit/Shop';
import { Skeleton } from '@/components/kit/Skeleton';
import btn from '@/components/kit/controls.module.css';
import { useT } from '@/i18n/client';
import { ApiError } from '@/lib/client/api';
import { useProfile } from '@/lib/client/profile';
import type { ReviewKitResponse } from '@/server/progress/types';
import { buildReviewKit } from './api';
import { ProActions } from './ReviewKitCard';
import st from './kit.module.css';

type State =
  | { s: 'waiting' }
  | { s: 'writing' }
  | { s: 'ready'; kit: ReviewKitResponse }
  | { s: 'locked' }
  | { s: 'noMap' }
  | { s: 'noProof' }
  | { s: 'error'; code: string };

/**
 * Printing shows only the sheet: A4, 18 mm margins, no site header. Global on purpose (the header is
 * outside this component); mounted only while the brief is on screen.
 */
const PRINT_CSS = `
@page { size: A4; margin: 18mm; }
@media print {
  html, body { background: #fff !important; }
  body *:not(:has([data-print-sheet])):not([data-print-sheet]):not([data-print-sheet] *) { display: none !important; }
  body *:has([data-print-sheet]) { display: block !important; position: static !important; margin: 0 !important; padding: 0 !important; border: 0 !important; box-shadow: none !important; background: none !important; max-width: none !important; min-height: 0 !important; }
}
`;

/** The Review kit: a one-page brief for a talk with one's manager, written from the person's own reps. */
export function ReviewKitScreen() {
  const { t, locale } = useT();
  const { status, applyAwards } = useProfile();
  const search = useSearchParams();
  const forceFree = process.env.NODE_ENV !== 'production' && search.get('plan') === 'free';
  const [written, setState] = useState<State>({ s: 'writing' });
  const [copied, setCopied] = useState(false);
  const started = useRef(false);

  const write = useCallback(async () => {
    try {
      const kit = await buildReviewKit(locale);
      setState({ s: 'ready', kit });
      applyAwards(kit.pointsAwarded);
    } catch (err) {
      const code = err instanceof ApiError ? err.code : 'network';
      if (code === 'pro_required') setState({ s: 'locked' });
      else if (code === 'no_xray') setState({ s: 'noMap' });
      else if (code === 'no_proof') setState({ s: 'noProof' });
      else setState({ s: 'error', code });
    }
  }, [locale, applyAwards]);

  useEffect(() => {
    if (status !== 'ready' || forceFree || started.current) return;
    started.current = true;
    void write();
  }, [status, forceFree, write]);

  const retry = () => {
    setState({ s: 'writing' });
    void write();
  };

  const state: State = status === 'loading' ? { s: 'waiting' } : status !== 'ready' ? { s: 'noMap' } : forceFree ? { s: 'locked' } : written;

  const copy = async (markdown: string) => {
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const back = (
    <Link href="/progress" className={st.back}>
      {t('progress.kit.back')}
    </Link>
  );

  if (state.s === 'locked') {
    return (
      <div className={st.page}>
        <div className={st.bar}>{back}</div>
        <LockedPanel shape="list" title={t('progress.kit.lockedTitle')} reason={t('progress.kit.lockedReason')} action={<ProActions />} />
      </div>
    );
  }

  if (state.s === 'noMap' || state.s === 'noProof') {
    const noMap = state.s === 'noMap';
    return (
      <div className={st.page}>
        <div className={st.bar}>{back}</div>
        <section className={st.notice}>
          <h1 className={st.noticeTitle}>{t('progress.kit.noProofTitle')}</h1>
          <p>{noMap ? t('progress.kit.noMapBody') : t('progress.kit.noProofBody')}</p>
          <Link href={noMap ? '/start' : '/today'} className={`${btn.btn} ${btn.b_primary}`}>
            {noMap ? t('progress.empty.noMapAction') : t('progress.empty.action')}
          </Link>
        </section>
      </div>
    );
  }

  const kit = state.s === 'ready' ? state.kit : null;
  return (
    <div className={st.page}>
      {kit ? <style>{PRINT_CSS}</style> : null}
      <div className={st.bar}>
        {back}
        {kit ? (
          <div className={st.tools}>
            <Button variant="secondary" size="sm" icon={copied ? <Check size={18} /> : <Copy size={18} strokeWidth={1.75} />} onClick={() => copy(kit.markdown)}>
              {copied ? t('progress.kit.copied') : t('progress.kit.copy')}
            </Button>
            <Button size="sm" icon={<Printer size={18} strokeWidth={1.75} />} onClick={() => window.print()}>
              {t('progress.kit.print')}
            </Button>
          </div>
        ) : null}
      </div>

      {state.s === 'error' ? (
        <div className={st.notice} role="alert">
          <p>{t('progress.kit.error')}</p>
          <Button variant="secondary" size="sm" onClick={retry}>
            {t('progress.kit.retry')}
          </Button>
        </div>
      ) : null}

      {kit ? (
        <article className={st.sheet} data-print-sheet>
          <header className={st.docHead}>
            <div>
              <h1 className={st.docTitle}>{kit.title}</h1>
              <p className={st.docSub}>{kit.subtitle}</p>
            </div>
            <span className={st.docMark}>
              <KeystoneMark size={18} />
              {t('progress.kit.madeWith')}
            </span>
          </header>
          {kit.sections.map((s) => (
            <section key={s.key} className={st.docSection} data-key={s.key}>
              <h2 className={st.docH2}>{s.title}</h2>
              <ul className={st.docList}>
                {s.items.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </section>
          ))}
        </article>
      ) : state.s !== 'error' ? (
        <article className={st.sheet} aria-busy="true">
          <p className={st.writing} role="status">
            {t('progress.kit.writing')}
            <span className={st.dots} aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          </p>
          <Skeleton width="62%" height={30} radius={8} />
          <Skeleton width="40%" height={14} style={{ marginTop: 12 }} />
          {[0, 1, 2].map((k) => (
            <div key={k} className={st.skelSection}>
              <Skeleton width="34%" height={18} />
              <Skeleton width="96%" height={12} />
              <Skeleton width="88%" height={12} />
              <Skeleton width="72%" height={12} />
            </div>
          ))}
        </article>
      ) : null}

      {kit ? <p className={st.note}>{t('progress.kit.note')}</p> : null}
    </div>
  );
}
