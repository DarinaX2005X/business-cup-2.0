import Link from 'next/link';
import { Wordmark } from '@/components/kit/Mark';
import { ScoreDial } from '@/components/kit/ScoreDial';
import btn from '@/components/kit/controls.module.css';
import type { RepType } from '@/domain/types';
import type { getT } from '@/i18n/messages';
import type { PublicPortfolio } from '@/server/progress/types';
import { TypeGlyph } from './TypeGlyph';
import st from './public.module.css';

type T = ReturnType<typeof getT>;
const TYPES: RepType[] = ['slip', 'delegate', 'edge'];

/** The brand line of a public page: the wordmark home, what this is, and the way to make one's own. */
function Top({ t }: { t: T }) {
  return (
    <div className={st.top}>
      <Link href="/" className={st.brand} aria-label="Irreplaceable">
        <Wordmark size={30} />
      </Link>
      <div className={st.topLinks}>
        <Link href="/" className={st.link}>
          {t('progress.public.what')}
        </Link>
        <Link href="/start" className={`${btn.btn} ${btn.b_primary} ${btn.s_sm}`}>
          {t('progress.public.mapOwn')}
        </Link>
      </div>
    </div>
  );
}

/**
 * /p/<slug>: someone's verified practice, for a manager or a LinkedIn visitor. The violet band carries
 * the job, the count of reps and the score arch; below, only the reps the owner made public. No name,
 * no pay, no resume, no documents.
 */
export function PublicProof({ data, t }: { data: PublicPortfolio; t: T }) {
  return (
    <div className={st.page}>
      <Top t={t} />
      <header className={`${st.band} field`} data-surface="field">
        <div className={st.bandText}>
          <h1 className={st.job}>{data.occupationTitle}</h1>
          <p className={st.reps}>
            {t('progress.public.reps', { count: data.reps })}. {t('progress.public.since', { date: monthYear(data.since) })}
          </p>
          <p className={st.level}>
            <span aria-hidden="true">{data.level.level}</span>
            {data.level.label}
          </p>
          <ul className={st.kinds} aria-label={t('progress.public.byType')}>
            {TYPES.filter((k) => data.byType[k] > 0).map((k) => (
              <li key={k}>
                <TypeGlyph type={k} size={36} />
                <b>{data.byType[k]}</b>
                <span>{t(`progress.type.${k}`)}</span>
              </li>
            ))}
          </ul>
        </div>
        {data.score !== null ? (
          <div className={st.dial}>
            <ScoreDial value={data.score} surface="violet" size={220} label={t('progress.public.scoreLabel')} hint={t('progress.public.scoreHint')} />
          </div>
        ) : null}
      </header>

      <section className={st.list} aria-labelledby="shared-title">
        <h2 id="shared-title" className={st.h2}>
          {t('progress.public.listTitle')}
        </h2>
        {data.entries.length ? (
          <ul className={st.rows}>
            {data.entries.map((e) => (
              <li key={e.id} className={st.row}>
                <TypeGlyph type={e.type} />
                <div className={st.rowMain}>
                  <b className={st.rowTask}>{e.taskShort || t(`progress.type.${e.type}`)}</b>
                  <p className={st.rowWhat}>
                    <span>{t(`progress.type.${e.type}`)}.</span> {t(e.summary.key, e.summary.params)}
                  </p>
                </div>
                <p className={st.rowSide}>
                  <span className={st.rowScore} aria-label={t('progress.list.scoreLabel', { score: e.score })}>
                    {e.score}
                    <small>/100</small>
                  </span>
                  <time dateTime={e.day}>{t.f.date(`${e.day}T12:00:00Z`, 'medium')}</time>
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <div className={st.empty}>
            <h3>{t('progress.public.emptyTitle')}</h3>
            <p>{t('progress.public.emptyBody')}</p>
          </div>
        )}
      </section>

      <p className={st.about}>
        {t('progress.public.about')}{' '}
        <Link href="/" className={st.link}>
          {t('progress.public.what')}
        </Link>
      </p>
    </div>
  );
}

function monthYear(iso: string): string {
  return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(iso));
}

/** Unknown slug, deleted profile. */
export function PublicProofMissing({ t }: { t: T }) {
  return (
    <div className={st.page}>
      <Top t={t} />
      <section className={st.empty}>
        <h1 className={st.h2}>{t('progress.public.notFoundTitle')}</h1>
        <p>{t('progress.public.notFoundBody')}</p>
        <Link href="/start" className={`${btn.btn} ${btn.b_primary}`}>
          {t('progress.public.mapOwn')}
        </Link>
      </section>
    </div>
  );
}
