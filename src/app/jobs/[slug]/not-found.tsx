import Link from 'next/link';
import { getT } from '@/i18n/messages';
import ctl from '@/components/kit/controls.module.css';
import st from '@/components/public/jobs.module.css';

export default function JobNotFound() {
  const t = getT('en');
  return (
    <main lang="en" className={st.notFound}>
      <h1>{t('jobs.notFound.title')}</h1>
      <p>{t('jobs.notFound.body')}</p>
      <div className={st.closingActions}>
        <Link href="/jobs" className={`${ctl.btn} ${ctl.b_secondary} ${ctl.s_lg}`}>
          {t('jobs.notFound.list')}
        </Link>
        <Link href="/start" className={`${ctl.btn} ${ctl.b_primary} ${ctl.s_lg}`}>
          {t('jobs.closing.button')}
        </Link>
      </div>
    </main>
  );
}
