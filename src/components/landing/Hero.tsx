import Link from 'next/link';
import type { TFunction } from '@/i18n/core';
import { HeroBackdrop } from './HeroBackdrop';
import { JobForm } from './JobForm';
import { fill } from './rich';
import st from './landing.module.css';

/** «AI» as a hatched machine tile with the letters cut out: they show the flat field through. */
function AiPlate({ word }: { word: string }) {
  return <span className={st.aiPlate}>{word}</span>;
}

/** The word under an apricot marker stroke, the way a caught mistake is marked in a rep. */
function Marked({ word }: { word: string }) {
  return (
    <span className={st.marked}>
      <svg className={st.stroke} viewBox="0 0 300 100" preserveAspectRatio="none" focusable="false">
        <path d="M4 8C62 3 121 9 182 5c48-3 87 2 114-1l-4 88c-51 5-101-2-160 4-50 4-91-2-128 2Z" className={st.strokeBody} />
        <path d="M9 12c70-7 190-6 282-10l-1 13C200 19 92 20 10 27Z" className={st.strokeLight} />
      </svg>
      <span className={st.markedWord}>{word}</span>
    </span>
  );
}

/** A question mark whose dot is the apricot circle. */
function Question() {
  return (
    <svg className={st.q} viewBox="0 0 62 100" focusable="false">
      <path d="M10.5 33A20.5 20.5 0 0 1 51.5 33C51.5 48 31 47 31 63V70" className={st.qHook} />
      <circle cx="31" cy="88.5" r="11.5" className={st.qDot} />
    </svg>
  );
}

/**
 * The first screen: one thought and one action on the flat violet field. It ends at the form
 * (the mini exercise is the next section), so the heading and the field fit any first viewport.
 */
export function Hero({ t }: { t: TFunction }) {
  return (
    <section className={`field ${st.hero}`} data-surface="field" aria-labelledby="hero-title">
      <HeroBackdrop />
      <div className={st.heroBody}>
        <h1 id="hero-title" className={st.heroTitle} aria-label={t('landing.hero.title')}>
          <span className={st.heroLine} aria-hidden="true">
            {fill(t('landing.hero.titleA'), { ai: <AiPlate word={t('landing.hero.ai')} />, q: <Question /> })}
          </span>
          <span className={st.heroLine} aria-hidden="true">
            {fill(t('landing.hero.titleB'), { spot: <Marked word={t('landing.hero.spot')} /> })}
          </span>
        </h1>
        <p className={st.heroLead}>{t('landing.hero.lead')}</p>
        <div className={st.heroForm}>
          <JobForm id="hero-job" surface="field" label={t('landing.form.label')} placeholder={t('landing.form.placeholder')} submit={t('landing.form.submit')} />
          <p className={st.heroLinks}>
            <Link href="/start" className={st.fieldLink}>
              {t('landing.hero.upload')}
            </Link>
            <Link href="/start?sample=nurse" className={`${st.fieldLink} ${st.quietLink}`}>
              {t('landing.hero.sample')}
            </Link>
          </p>
        </div>
      </div>
    </section>
  );
}
