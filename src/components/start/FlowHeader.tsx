'use client';

import Link from 'next/link';
import { House, X } from 'lucide-react';
import { KeystoneMark } from '@/components/kit';
import { DemoMark, HeaderAccount, useAccount } from '@/components/shell/HeaderAccount';
import { useT } from '@/i18n/client';
import { STEPS, type Step } from './types';
import st from './start.module.css';
import fh from './FlowHeader.module.css';

/**
 * The focused header of the flow: the same logo and the same right side as the app shell (points,
 * streak, level, account menu), the four steps drawn as small week tiles in the middle, and the way out:
 * «Go to Home» for a person who already has a week map, Exit for everyone else.
 */
export function FlowHeader({ step }: { step: Step }) {
  const { t } = useT();
  const account = useAccount();
  const at = STEPS.indexOf(step);
  const hasMap = !!account?.lastXrayId;

  return (
    <header className={st.header}>
      <div className={st.headerIn}>
        <div className={fh.start}>
          <Link href={account ? '/home' : '/'} className={st.homeLink} aria-label={account ? t('shell.home') : t('start.header.home')}>
            <KeystoneMark size={32} />
            <span className={st.wordmark}>Irreplaceable</span>
          </Link>
          {account?.demo ? <DemoMark /> : null}
        </div>

        <ol className={st.progress} aria-label={t('start.header.progress', { n: at + 1 })}>
          {STEPS.map((s, i) => (
            <li key={s} data-state={i < at ? 'done' : i === at ? 'now' : 'next'} aria-current={i === at ? 'step' : undefined} />
          ))}
        </ol>

        <div className={`${st.headerEnd} ${fh.end}`}>
          {account ? <HeaderAccount snapshot={account} /> : null}
          {hasMap ? (
            <Link href="/home" className={st.exit} aria-label={t('shell.goHome')}>
              <House size={18} strokeWidth={1.75} aria-hidden="true" />
              <span className={fh.label}>{t('shell.goHome')}</span>
            </Link>
          ) : (
            <Link href={account ? '/home' : '/'} className={st.exit}>
              <X size={18} strokeWidth={2} aria-hidden="true" />
              <span>{t('start.header.exit')}</span>
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
