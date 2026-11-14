import type { TFunction } from '@/i18n/core';
import { FieldArches } from '@/components/kit/Illustration';
import { JobForm } from './JobForm';
import { LogoMark } from './Logo';
import st from './landing.module.css';

/** The closing: the arch with its keystone, one line and the job title field again. */
export function Closing({ t }: { t: TFunction }) {
  return (
    <section className={`field ${st.closing}`} data-surface="field" aria-labelledby="closing-title">
      <FieldArches className={st.closingArches} />
      <div className={st.closingIn}>
        <LogoMark size={176} surface="field" className={st.closingMark} />
        <h2 id="closing-title" className={st.closingTitle}>
          {t('landing.closing.title')}
        </h2>
        <p className={st.closingLead}>{t('landing.closing.lead')}</p>
        <div className={st.closingForm}>
          <JobForm id="closing-job" surface="field" label={t('landing.form.label')} placeholder={t('landing.form.placeholder')} submit={t('landing.form.submit')} />
        </div>
      </div>
    </section>
  );
}
