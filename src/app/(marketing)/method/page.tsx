import type { Metadata } from 'next';
import Link from 'next/link';
import { getRequestT } from '@/i18n/server';
import { CategoryChip, EvidenceBadge } from '@/components/kit/Evidence';
import ctl from '@/components/kit/controls.module.css';
import { PublicFooter, PublicHeader, type ChromeLabels } from '@/components/public/PublicChrome';
import { Toc } from '@/components/public/Toc';
import { ExposureRuler } from '@/components/public/ExposureRuler';
import { METHOD_ANCHORS as A, METHOD_ORDER } from '@/components/public/anchors';
import { getMeta, getValidation, siteUrl, sourceList } from '@/components/public/data';
import { CONSTANTS, nurseWeek, workedExamples } from '@/components/public/methodData';
import pub from '@/components/public/public.module.css';
import st from '@/components/public/method.module.css';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getRequestT();
  return {
    metadataBase: siteUrl(),
    title: t('method.meta.title'),
    description: t('method.meta.description'),
    alternates: { canonical: '/method' },
    openGraph: { title: t('method.meta.title'), description: t('method.meta.description'), url: '/method', type: 'article', siteName: 'Irreplaceable' },
  };
}

export default async function MethodPage() {
  const t = await getRequestT();
  const f = t.f;
  const meta = getMeta();
  const c = meta.constants;
  const cov = meta.coverage;
  const counts = meta.counts;
  const pct = (x: number, digits = 1) => f.percent(x, digits);
  const dec = (x: number, digits = 2) => f.number(x, { maximumFractionDigits: digits });
  const sources = sourceList();
  const examples = await workedExamples();
  const nurse = await nurseWeek();
  const validation = getValidation();

  const chrome: ChromeLabels = {
    home: t('method.chrome.home'),
    nav: t('method.chrome.nav'),
    method: t('method.chrome.method'),
    jobs: t('method.chrome.jobs'),
    start: t('method.chrome.start'),
  };

  const totalTasks = counts.tasks;
  const cats = cov.categories;
  const ev = cov.evidenceLevels;
  const split = [
    { cat: 'ai_does' as const, n: cats.ai_does },
    { cat: 'ai_speeds' as const, n: cats.ai_speeds },
    { cat: 'human_edge' as const, n: cats.human_edge },
    ...(cats.no_data ? [{ cat: 'no_data' as const, n: cats.no_data }] : []),
  ];

  const srcLabel = (s: string | null) => t(s === '1p_api' ? 'method.category.src_1p_api' : 'method.category.src_claude_ai');

  const sourceCover: Record<string, string> = {
    onet: t('method.sources.onetCover', { rated: pct(cov.importanceRated) }),
    aei: t('method.sources.aeiCover', {
      published: pct(cov.aeiPublished),
      gate: pct(c.WORK_GATE, 0),
      gated: pct(cov.aeiObservedWorkGated),
      pen: pct(cov.penetration),
    }),
    gpts: t('method.sources.gptsCover', { labelled: pct(cov.gptsLabel), estimated: pct(cov.theoryEstimatedDwa) }),
    ms: t('method.sources.msCover', { physical: pct(cov.physicalFlag) }),
    bls: t('method.sources.blsCover', { wage: pct(cov.wage), shared: pct(cov.wageShared) }),
  };

  const coverageRows: [string, string][] = [
    [t('method.coverage.occupations'), t('method.coverage.occupationsValue', { n: counts.occupationsWithTasks, total: counts.occupations })],
    [t('method.coverage.tasks'), f.integer(counts.tasks)],
    [t('method.coverage.importance'), pct(cov.importanceRated)],
    [t('method.coverage.gpts'), pct(cov.gptsLabel)],
    [t('method.coverage.dwa'), pct(cov.theoryEstimatedDwa)],
    [t('method.coverage.aei', { aei: meta.dataVersion.aei }), pct(cov.aeiPublished)],
    [t('method.coverage.gated'), pct(cov.aeiObservedWorkGated)],
    [t('method.coverage.ever'), pct(cov.aeiEverObserved)],
    [t('method.coverage.penetration'), pct(cov.penetration)],
    [t('method.coverage.physical'), pct(cov.physicalFlag)],
    [t('method.coverage.wage'), pct(cov.wage)],
    [t('method.coverage.shared'), pct(cov.wageShared)],
    [t('method.coverage.related'), pct(cov.related)],
    [t('method.coverage.titles'), t('method.coverage.titlesValue', { titles: counts.titles, aliases: counts.aliases })],
  ];

  return (
    <>
      <PublicHeader labels={chrome} current="method" locale />
      <main className={st.page}>
        <section className={st.intro}>
          <div className={st.introText}>
            <h1 className={st.h1}>{t('method.title')}</h1>
            <p className={st.lead}>{t('method.lead')}</p>
            <p className={st.build}>{t('method.updated', { onet: `${meta.dataVersion.onet} (${meta.onetRelease})`, aei: meta.dataVersion.aei, bls: meta.dataVersion.bls })}</p>
          </div>
          <div className={st.heroSheet}>
            <ExposureRuler
              speeds={c.aiSpeedsExposure}
              does={c.aiDoesExposure}
              format={(v) => dec(v)}
              labels={{ scale: t('method.hero.scale'), human: t('method.hero.zoneHuman'), speeds: t('method.hero.zoneSpeeds'), does: t('method.hero.zoneDoes') }}
              pins={examples.map((e) => ({
                id: e.task.id,
                label: e.short,
                sub: `${e.occupation}, ${dec(e.exposure)}`,
                value: e.exposure,
                category: e.task.evidence.category,
              }))}
            />
            <p className={st.heroCaption}>
              {t('method.hero.caption')}{' '}
              <a href={`#${A.category}`} className={pub.textLink}>
                {t('method.sections.category')}
              </a>
            </p>
          </div>
        </section>

        <div className={st.layout}>
          <Toc title={t('method.toc')} items={METHOD_ORDER.map((k) => ({ id: A[k], label: t(`method.sections.${k}`) }))} />

          <article className={st.article}>
            <section id={A.what} className={st.section}>
              <h2>{t('method.sections.what')}</h2>
              <p>{t('method.what.p1', { count: nurse?.taskCount ?? 0 })}</p>
              <p>
                {t('method.what.p2', {
                  version: meta.dataVersion.onet,
                  occupations: counts.occupations,
                  withTasks: counts.occupationsWithTasks,
                  tasks: counts.tasks,
                })}
              </p>
            </section>

            <section id={A.sources} className={st.section}>
              <h2>{t('method.sections.sources')}</h2>
              <p>{t('method.sources.intro')}</p>
              <ol className={st.sources}>
                {sources.map((s) => (
                  <li key={s.id} className={st.source}>
                    <div className={st.sourceHead}>
                      <h3>
                        <a href={s.url} target="_blank" rel="noreferrer">
                          {s.name}
                        </a>
                      </h3>
                      <span className={st.sourceVer}>
                        {s.version}, {s.license}
                      </span>
                    </div>
                    <p>{t(`method.sources.${s.id}`)}</p>
                    <p className={st.sourceCover}>{sourceCover[s.id]}</p>
                  </li>
                ))}
              </ol>
              <h3 className={st.h3}>{t('method.sources.attribution')}</h3>
              <p className={st.muted}>{t('method.sources.attributionNote')}</p>
              <div className={st.attributions} lang="en">
                {sources.map((s) => (
                  <blockquote key={s.id} cite={s.url}>
                    {s.attribution}
                  </blockquote>
                ))}
              </div>
            </section>

            <section id={A.evidence} className={st.section}>
              <h2>{t('method.sections.evidence')}</h2>
              <p>{t('method.evidence.intro')}</p>
              <dl className={st.badges}>
                <div>
                  <dt>
                    <EvidenceBadge level="observed" />
                  </dt>
                  <dd>
                    <p>{t('method.evidence.observed')}</p>
                    <b>{t('method.evidence.count', { count: ev.observed, share: pct(ev.observed / totalTasks) })}</b>
                  </dd>
                </div>
                <div>
                  <dt>
                    <EvidenceBadge level="estimate" />
                  </dt>
                  <dd>
                    <p>{t('method.evidence.estimate')}</p>
                    <b>{t('method.evidence.count', { count: ev.estimate, share: pct(ev.estimate / totalTasks) })}</b>
                  </dd>
                </div>
              </dl>
              <p>{t('method.evidence.missing', { ever: pct(cov.aeiEverObserved) })}</p>

              <figure className={st.split}>
                <figcaption>{t('method.evidence.split', { tasks: totalTasks })}</figcaption>
                <div
                  className={st.splitBar}
                  role="img"
                  aria-label={t('method.evidence.splitAlt', { does: cats.ai_does, speeds: cats.ai_speeds, human: cats.human_edge })}
                >
                  {split.map((s) => (
                    <span key={s.cat} data-cat={s.cat} style={{ flexGrow: s.n }} />
                  ))}
                </div>
                <ul className={st.splitKeys}>
                  {split.map((s) => (
                    <li key={s.cat} style={{ flexGrow: s.n }}>
                      <CategoryChip category={s.cat} />
                      <span>
                        <b>{f.integer(s.n)}</b> {pct(s.n / totalTasks)}
                      </span>
                    </li>
                  ))}
                </ul>
              </figure>
            </section>

            <section id={A.category} className={st.section}>
              <h2>{t('method.sections.category')}</h2>
              <p>{t('method.category.intro')}</p>
              <div className={st.formula} lang="en">
                <code>{t('method.category.theory')}</code>
                <code>{t('method.category.observed')}</code>
                <code className={st.formulaMain}>
                  {t('method.category.exposure', { tw: dec(c.THEORY_WEIGHT), ow: dec(1 - c.THEORY_WEIGHT) })}
                </code>
              </div>
              <p>{t('method.category.rules')}</p>
              <ul className={st.rules}>
                <li>
                  <CategoryChip category="ai_does" />
                  <span>{t('method.category.ruleDoes', { auto: pct(c.aiDoesAutomation, 0), does: dec(c.aiDoesExposure) })}</span>
                </li>
                <li>
                  <CategoryChip category="ai_speeds" />
                  <span>{t('method.category.ruleSpeeds', { speeds: dec(c.aiSpeedsExposure) })}</span>
                </li>
                <li>
                  <CategoryChip category="human_edge" />
                  <span>{t('method.category.ruleHuman', { speeds: dec(c.aiSpeedsExposure) })}</span>
                </li>
                {cats.no_data === 0 ? (
                  <li>
                    <CategoryChip category="no_data" />
                    <span>{t('method.category.ruleNone')}</span>
                  </li>
                ) : null}
              </ul>
              <p className={st.muted}>{t('method.category.choice', { gate: pct(c.WORK_GATE, 0) })}</p>

              <h3 className={st.h3}>{t('method.category.examples')}</h3>
              <div className={st.examples}>
                {examples.map((e) => {
                  const ev2 = e.task.evidence;
                  return (
                    <article key={e.task.id} className={st.example}>
                      <p className={st.exOcc}>
                        <Link href={`/jobs/${e.slug}`} className={pub.textLink}>
                          {e.occupation}
                        </Link>
                      </p>
                      <h4 className={st.exTask} lang="en">
                        {e.task.text}
                      </h4>
                      <dl className={st.exLines}>
                        <div>
                          <dt>{t('method.category.rating', { label: ev2.theoryLabel ?? '–' })}</dt>
                          <dd>{t('method.category.theoryLine', { value: dec(e.theory) })}</dd>
                        </div>
                        <div>
                          <dt>
                            {ev2.observed
                              ? t('method.category.observedLine', { source: srcLabel(ev2.aeiSource), auto: pct(ev2.aeiAutomation ?? 0.5, 0) })
                              : t('method.category.notObserved')}
                          </dt>
                          <dd>{t('method.category.observedValue', { value: dec(e.observed, 3) })}</dd>
                        </div>
                      </dl>
                      <p className={st.exEq} lang="en">
                        <span>
                          {dec(c.THEORY_WEIGHT)} × {dec(e.theory)} + {dec(1 - c.THEORY_WEIGHT)} × {dec(e.observed, 3)} ={' '}
                        </span>
                        <b>{dec(e.exposure, 3)}</b>
                      </p>
                      <div className={st.exVerdict}>
                        <CategoryChip category={ev2.category} />
                        <EvidenceBadge level={ev2.evidenceLevel} size="sm" />
                      </div>
                      <p className={st.exWhy}>
                        {t(`method.category.${e.reason}`, { does: dec(c.aiDoesExposure), speeds: dec(c.aiSpeedsExposure), label: ev2.theoryLabel ?? '' })}
                      </p>
                    </article>
                  );
                })}
              </div>
            </section>

            <section id={A.week} className={st.section}>
              <h2>{t('method.sections.week')}</h2>
              <p>{t('method.week.p1')}</p>
              <p>{t('method.week.p2', { n: CONSTANTS.DEFAULT_WEEK_TASKS })}</p>
              <div className={st.formula} lang="en">
                <code className={st.formulaMain}>{t('method.week.formula')}</code>
              </div>
              {nurse ? (
                <figure className={st.tableWrap}>
                  <figcaption>{t('method.week.example')}</figcaption>
                  <div className={st.scrollX}>
                    <table className={st.table}>
                      <thead>
                        <tr>
                          <th scope="col">{t('method.week.colTask')}</th>
                          <th scope="col">{t('method.week.colImportance')}</th>
                          <th scope="col">{t('method.week.colFrequency')}</th>
                          <th scope="col">{t('method.week.colWeight')}</th>
                          <th scope="col">{t('method.week.colShare')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {nurse.top.map((r) => (
                          <tr key={r.id}>
                            <th scope="row" lang="en" title={r.text}>
                              {r.short}
                            </th>
                            <td>{r.importance != null ? dec(r.importance) : '–'}</td>
                            <td>{r.frequency != null ? dec(r.frequency) : '–'}</td>
                            <td>{dec(r.weight)}</td>
                            <td>
                              {f.integer(r.share)}%<span className={st.cellSub}>{t('method.week.hours', { h: dec((r.share * 40) / 100, 1) })}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </figure>
              ) : null}
            </section>

            <section id={A.score} className={st.section}>
              <h2>{t('method.sections.score')}</h2>
              <p>{t('method.score.intro')}</p>
              <div className={st.formula} lang="en">
                <code>{t('method.score.f1')}</code>
                <code>{t('method.score.f2')}</code>
                <code>{t('method.score.f3', { scale: CONSTANTS.PRACTICE_SCALE })}</code>
                <code className={st.formulaMain}>{t('method.score.f4', { gain: dec(CONSTANTS.PRACTICE_GAIN) })}</code>
              </div>
              <p>{t('method.score.explainF', { gain: pct(CONSTANTS.PRACTICE_GAIN, 0) })}</p>
              {nurse ? (
                <div className={st.scoreEx}>
                  <h3 className={st.h3}>{t('method.score.example')}</h3>
                  <ol className={st.steps}>
                    <li>{t('method.score.exWeek', { value: dec(nurse.result.weekExposure, 3) })}</li>
                    <li>{t('method.score.exBase', { value: f.integer(nurse.result.baseScore) })}</li>
                    <li>
                      {t('method.score.exPractice', {
                        n: nurse.practice.n,
                        avg: pct(nurse.practice.avgScore, 0),
                        F: dec(nurse.ps.F, 3),
                        score: f.integer(nurse.ps.score),
                      })}
                    </li>
                  </ol>
                  {nurse.result.payAtStake != null && nurse.result.salary.annual != null ? (
                    <p>
                      {t('method.score.pay', {
                        high: dec(CONSTANTS.HIGH_EXPOSURE),
                        currency: f.currency(nurse.result.payAtStake),
                        annual: f.currency(nurse.result.salary.annual),
                      })}
                    </p>
                  ) : null}
                </div>
              ) : null}
              <p className={st.muted}>{t('method.score.notProbability')}</p>
            </section>

            <section id={A.validation} className={st.section}>
              <h2>{t('method.sections.validation')}</h2>
              <p>{t('method.validation.intro')}</p>
              <ul className={st.validation}>
                {validation.map((v) => (
                  <li key={v.id}>
                    <b className={st.rho}>{dec(v.rho)}</b>
                    <span>
                      <span className={st.vName}>{t(`method.validation.${v.id}`)}</span>
                      <span className={st.muted}>{t('method.validation.row', { rho: `ρ = ${dec(v.rho)}`, n: v.n })}</span>
                    </span>
                  </li>
                ))}
              </ul>
              <p>{t('method.validation.outro')}</p>
              <p className={st.muted}>{t('method.validation.source')}</p>
            </section>

            <section id={A.limits} className={st.section}>
              <h2>{t('method.sections.limits')}</h2>
              <ul className={st.limits}>
                <li>{t('method.limits.layoffs')}</li>
                <li>{t('method.limits.dated')}</li>
                <li>{t('method.limits.oneVendor')}</li>
                <li>{t('method.limits.pay')}</li>
              </ul>
            </section>

            <section id={A.coverage} className={st.section}>
              <h2>{t('method.sections.coverage')}</h2>
              <p className={st.muted}>{t('method.coverage.intro')}</p>
              <div className={st.scrollX}>
                <table className={st.table} data-kind="coverage">
                  <thead>
                    <tr>
                      <th scope="col">{t('method.coverage.colMeasure')}</th>
                      <th scope="col">{t('method.coverage.colValue')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {coverageRows.map(([k, v]) => (
                      <tr key={k}>
                        <th scope="row">{k}</th>
                        <td>{v}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className={st.muted}>
                {t('method.coverage.wageDetail', {
                  detailed: cov.wageMatch.detailed,
                  aggregate: cov.wageMatch.aggregate,
                  manual: cov.wageMatch.manual,
                  unmatched: cov.wageMatch.unmatched,
                })}
              </p>
            </section>

            <section id={A.privacy} className={st.section}>
              <h2>{t('method.sections.privacy')}</h2>
              <p>{t('method.privacy.p1')}</p>
              <p>{t('method.privacy.p2')}</p>
              <p>{t('method.privacy.p3')}</p>
            </section>
          </article>
        </div>

        <section className={`field ${st.cta}`} data-surface="field">
          <div className={st.ctaIn}>
            <h2>{t('method.cta.title')}</h2>
            <p>{t('method.cta.body')}</p>
            <div className={st.ctaActions}>
              <Link href="/start" className={`${ctl.btn} ${ctl.b_apricot} ${ctl.s_lg}`}>
                {t('method.cta.button')}
              </Link>
              <Link href="/jobs" className={`${ctl.btn} ${ctl.b_ghost} ${ctl.s_lg}`}>
                {t('method.cta.jobs')}
              </Link>
            </div>
          </div>
        </section>
      </main>
      <PublicFooter title={t('method.footer.title')} note={t('method.footer.note')} methodLabel={t('method.footer.method')} sources={sources} />
    </>
  );
}
