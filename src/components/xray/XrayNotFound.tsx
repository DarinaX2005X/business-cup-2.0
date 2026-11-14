'use client';

import Link from 'next/link';
import { SheetStack } from '@/components/kit/Illustration';
import btn from '@/components/kit/controls.module.css';
import { useT } from '@/i18n/client';
import st from './xray.module.css';

export function XrayNotFound() {
  const { t } = useT();
  return (
    <div className={st.page}>
      <section className={st.missing} aria-labelledby="missing-title">
        <div>
          <h1 id="missing-title" className={st.missingTitle}>
            {t('xray.notFound.title')}
          </h1>
          <p className={st.aBody}>{t('xray.notFound.body')}</p>
          <Link href="/start" className={`${btn.btn} ${btn.b_primary} ${btn.s_lg}`}>
            {t('xray.action.mapOwn')}
          </Link>
        </div>
        <SheetStack className={st.missingArt} />
      </section>
    </div>
  );
}
