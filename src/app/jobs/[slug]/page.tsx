import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getT } from '@/i18n/messages';
import { KitProvider } from '@/components/kit/strings';
import { WEEK_HOURS } from '@/domain/constants';
import { FieldArches } from '@/components/kit/Illustration';
import ctl from '@/components/kit/controls.module.css';
import { PublicFooter, PublicHeader } from '@/components/public/PublicChrome';
import { WeekBar } from '@/components/kit/WeekBar';
import { JobTasks, OtherTasks } from '@/components/public/JobTasks';
import { getBundle, getMeta, getOccupationBySlug, getOccupations, siteUrl, sourceList, STATIC_JOB_PAGES } from '@/components/public/data';
import { jobModel } from '@/components/public/jobModel';
import { taskShort } from '@/components/public/text';
import st from '@/components/public/jobs.module.css';
import pub from '@/components/public/public.module.css';

/* English only: the root layout's cookie read returns nothing here, so every page is prerendered once. */
export const dynamic = 'force-static';
export const dynamicParams = true;
export const revalidate = 86400;

export async function generateStaticParams() {
  const list = await getOccupations();
  return list.slice(0, STATIC_JOB_PAGES).map((o) => ({ slug: o.slug }));
}

type Props = { params: Promise<{ slug: string }> };

async function load(slug: string) {
  const entry = await getOccupationBySlug(slug);
  if (!entry) return null;
  const bundle = await getBundle(entry.code);
  return bundle && bundle.tasks.length ? bundle : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const bundle = await load(slug);
  if (!bundle) return { title: getT('en')('jobs.notFound.title') };
  const m = jobModel(bundle);
  const url = `/jobs/${bundle.slug}`;
  return {
    metadataBase: siteUrl(),
    title: m.metaTitle,
    description: m.description,
    alternates: { canonical: url },
    openGraph: { title: m.h1, description: m.description, url, type: 'article', siteName: 'Irreplaceable', locale: 'en_US' },
    twitter: { card: 'summary', title: m.h1, description: m.description },
  };
}

export default async function JobPage({ params }: Props) {
  const { slug } = await params;
  const bundle = await load(slug);
  if (!bundle) notFound();
  const t = getT('en');
  const f = t.f;
  const meta = getMeta();
  const m = jobModel(bundle);
  const index = new Map((await getOccupations()).map((o) => [o.code, o]));
  const fmt = (v: number, d = 0) => f.number(v, { minimumFractionDigits: d, maximumFractionDigits: d });
  const fmtMax = (v: number, d = 2) => f.number(v, { maximumFractionDigits: d });
  const observedPct = Math.round(m.result.observedShare * 100);
  const wage = bundle.wage;
  const startHref = `/start?code=${encodeURIComponent(bundle.code)}`;
  const skills = [...bundle.skills].sort((a, b) => b.importance - a.importance).slice(0, 6);
  const knowledge = [...bundle.knowledge].sort((a, b) => b.importance - a.importance).slice(0, 4);
  const related = bundle.related.filter((r) => index.has(r.code)).slice(0, 6);

  const chrome = {
    home: t('jobs.chrome.home'),
    nav: t('jobs.chrome.nav'),
    method: t('jobs.chrome.method'),
    jobs: t('jobs.chrome.jobs'),
    start: t('jobs.chrome.start'),
  };

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Occupation',
    name: bundle.title,
    description: bundle.description,
    occupationalCategory: bundle.code,
    ...(wage.medianAnnual ? { estimatedSalary: { '@type': 'MonetaryAmountDistribution', name: 'base', currency: 'USD', duration: 'P1Y', median: wage.medianAnnual } } : {}),
    skills: skills.map((s) => s.name).join(', '),
  };

  return (
    <>
      <PublicHeader labels={chrome} current="jobs" />
      {/* English only: kit chips and units stay English even when the visitor reads the app in RU or KK. */}
      <KitProvider locale="en">
      <main lang="en">
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />
        <section className={`field ${st.hero}`} data-surface="field">
          <FieldArches className={st.arches} />
          <div className={st.heroIn}>
            <div className={st.heroTop}>
              <div className={st.heroText}>
                <p className={st.crumb}>
                  <Link href="/jobs">{t('jobs.chrome.jobs')}</Link>
                  <span aria-hidden="true">/</span>
                  <span>{bundle.title}</span>
                </p>
                <h1 className={st.h1}>{m.h1}</h1>
                <p className={st.summary}>{m.summary}</p>
                <p className={st.observed}>
                  <svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true">
                    {observedPct > 0 ? (
                      <>
                        <circle cx="8" cy="8" r="7" fill="currentColor" />
                        <path d="M4.8 8.2l2.1 2.1 4.3-4.4" stroke="var(--field)" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                      </>
                    ) : (
                      <circle cx="8" cy="8" r="6.2" stroke="currentColor" strokeWidth="1.6" fill="none" />
                    )}
                  </svg>
                  {observedPct > 0 ? t('jobs.page.observed', { share: observedPct }) : t('jobs.page.observedNone')}
                </p>
              </div>
              <aside className={st.facts} aria-label={t('jobs.page.facts')}>
                <p className={st.factsTitle}>{t('jobs.page.facts')}</p>
                <dl>
                  <div>
                    <dt>{t('jobs.page.median')}</dt>
                    <dd>
                      {wage.medianAnnual != null ? f.currency(wage.medianAnnual) : t('jobs.page.noWage')}
                      {wage.note ? <small>{t(`jobs.page.medianNote_${wage.note}`)}</small> : null}
                      {wage.medianAnnual != null && wage.sharedWith > 1 ? <small>{t('jobs.page.medianShared', { n: wage.sharedWith - 1 })}</small> : null}
                    </dd>
                  </div>
                  {wage.employment != null ? (
                    <div>
                      <dt>{t('jobs.page.employment')}</dt>
                      <dd>{f.integer(wage.employment)}</dd>
                    </div>
                  ) : null}
                  <div>
                    <dt>{t('jobs.page.taskCount')}</dt>
                    <dd>{f.integer(bundle.tasks.length)}</dd>
                  </div>
                </dl>
                <Link href={startHref} className={`${ctl.btn} ${ctl.b_apricot} ${ctl.s_lg} ${ctl.block}`}>
                  {t('jobs.page.cta')}
                </Link>
                <p className={st.ctaNote}>{t('jobs.page.ctaNote')}</p>
              </aside>
            </div>
            <div className={st.week}>
              <WeekBar
                variant="violet"
                ariaLabel={t('jobs.page.weekLabel', { title: bundle.title })}
                tasks={m.week.map((r) => ({
                  id: r.task.id,
                  label: taskShort(r.task),
                  text: r.task.text,
                  share: r.share,
                  category: r.task.evidence.category,
                  evidenceLevel: r.task.evidence.evidenceLevel,
                }))}
              />
              <p className={st.weekCaption}>
                {t('jobs.page.weekCaption', { hours: WEEK_HOURS })} <span className={st.factsSource}>{t('jobs.page.factsSource', { onet: meta.dataVersion.onet })}</span>
              </p>
            </div>
          </div>
        </section>

        <div className={st.body}>
          <section className={st.section} aria-labelledby="tasks">
            <div className={st.sectionHead}>
              <h2 id="tasks">{t('jobs.tasks.title')}</h2>
              <p>{t('jobs.tasks.intro', { n: m.week.length })}</p>
            </div>
            <JobTasks rows={m.week} t={t} theoryWeight={meta.constants.THEORY_WEIGHT} fmt={(v, d = 2) => (d === 1 ? fmt(v, 1) : fmtMax(v, d))} />
            <OtherTasks tasks={m.others} t={t} />
          </section>

          <div className={st.pair}>
            <section className={st.section} aria-labelledby="skills">
              <div className={st.sectionHead}>
                <h2 id="skills">{t('jobs.skills.title')}</h2>
                <p>{t('jobs.skills.intro')}</p>
              </div>
              <ul className={st.skills}>
                {skills.map((s) => (
                  <li key={s.id}>
                    <span className={st.skillName}>{s.name}</span>
                    <span className={st.skillMeter} aria-hidden="true">
                      <span style={{ width: `${(s.importance / 5) * 100}%` }} />
                    </span>
                    <span className={st.skillValue}>{t('jobs.skills.importance', { value: fmtMax(s.importance, 1) })}</span>
                  </li>
                ))}
              </ul>
              {knowledge.length ? (
                <p className={st.knowledge}>
                  <b>{t('jobs.skills.knowledge')}:</b> {knowledge.map((k) => k.name).join(', ')}
                </p>
              ) : null}
            </section>

            <section className={st.section} aria-labelledby="related">
              <div className={st.sectionHead}>
                <h2 id="related">{t('jobs.related.title')}</h2>
                <p>{t('jobs.related.intro')}</p>
              </div>
              <ul className={st.related}>
                {related.map((r) => (
                  <li key={r.code}>
                    <Link href={`/jobs/${index.get(r.code)!.slug}`}>
                      <span>{r.title}</span>
                      <small>{t('jobs.related.similarity', { value: Math.round(r.similarity * 100) })}</small>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          </div>

          <section className={st.closing}>
            <div>
              <h2>{t('jobs.closing.title')}</h2>
              <p>{t('jobs.closing.body')}</p>
            </div>
            <div className={st.closingActions}>
              <Link href={startHref} className={`${ctl.btn} ${ctl.b_primary} ${ctl.s_lg}`}>
                {t('jobs.closing.button')}
              </Link>
              <Link href="/method" className={pub.textLink}>
                {t('jobs.closing.method')}
              </Link>
            </div>
          </section>
        </div>
      </main>
      </KitProvider>
      <PublicFooter title={t('jobs.footer.title')} note={t('jobs.footer.note')} methodLabel={t('jobs.footer.method')} sources={sourceList()} />
    </>
  );
}
