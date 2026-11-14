import type { Metadata } from 'next';
import Link from 'next/link';
import { getRequestT } from '@/i18n/server';
import { CategoryChip, EvidenceBadge } from '@/components/kit/Evidence';
import ctl from '@/components/kit/controls.module.css';
import { PublicFooter, PublicHeader, type ChromeLabels } from '@/components/public/PublicChrome';
import { Toc } from '@/components/public/Toc';
import { CategoryPath, type PathRow } from '@/components/public/CategoryPath';
import { METHOD_ANCHORS as A, METHOD_ORDER } from '@/components/public/anchors';
import { getMeta, getValidation, siteUrl, sourceList } from '@/components/public/data';
import { constants, nurseWeek, PATH_CATEGORY, pathCounts, workedExamples } from '@/components/public/methodData';
import type { Category } from '@/domain/types';
import { WEEK_HOURS } from '@/domain/constants';
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
  const c = constants();
  const cov = meta.coverage;
  const counts = meta.counts;
  const pct = (x: number, digits = 1) => f.percent(x, digits);
  const dec = (x: number, digits = 2) => f.number(x, { maximumFractionDigits: digits });
  const sources = sourceList();
  const examples = await workedExamples();
  const nurse = await nurseWeek();
  const validation = getValidation();
  const paths = await pathCounts();

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

  const n = (x: number) => t('method.hero.count', { n: f.integer(x) });
  const exAt = (steps: string[]) =>
    examples
      .filter((e) => steps.includes(e.step))
      .map((e) => ({ id: e.task.id, label: e.share ? t('method.hero.example', { label: e.short, h: dec((e.share * WEEK_HOURS) / 100, 1) }) : e.short }));
  const pathRows: PathRow[] = [
    {
      id: 'observed',
      question: t('method.hero.q1', { gate: pct(c.WORK_GATE, 0) }),
      outcomes: [
        { category: 'ai_does', label: t('method.cat.ai_does'), condition: t('method.hero.q1yes', { auto: pct(c.aiDoesAutomation, 0) }), count: n(paths.observed_does) },
        { category: 'ai_speeds', label: t('method.cat.ai_speeds'), condition: t('method.hero.q1no', { auto: pct(c.aiDoesAutomation, 0) }), count: n(paths.observed_speeds) },
      ],
      examples: exAt(['observed_does', 'observed_speeds']),
    },
    {
      id: 'physical',
      question: t('method.hero.q2'),
      outcomes: [{ category: 'human_edge', label: t('method.cat.human_edge'), count: n(paths.physical) }],
      examples: exAt(['physical']),
    },
    {
      id: 'rated',
      question: t('method.hero.q3'),
      outcomes: [{ category: 'ai_speeds', label: t('method.cat.ai_speeds'), count: n(paths.rated_speeds + paths.usage_speeds) }],
      examples: exAt(['rated_speeds', 'usage_speeds']),
    },
    {
      id: 'rest',
      question: t('method.hero.q4'),
      outcomes: [{ category: 'human_edge', label: t('method.cat.human_edge'), count: n(paths.low_human) }],
      examples: exAt(['low_human']),
    },
  ];
  const ruleRows: { key: string; cat: Category; text: string }[] = [
    { key: 'r1', cat: PATH_CATEGORY.observed_does, text: t('method.category.r1', { auto: pct(c.aiDoesAutomation, 0) }) },
    { key: 'r2', cat: PATH_CATEGORY.observed_speeds, text: t('method.category.r2') },
    { key: 'r3', cat: PATH_CATEGORY.physical, text: t('method.category.r3', { max: dec(c.physicalMaxTheory) }) },
    { key: 'r4', cat: PATH_CATEGORY.rated_speeds, text: t('method.category.r4', { min: dec(c.aiSpeedsTheory) }) },
    { key: 'r5', cat: PATH_CATEGORY.low_human, text: t('method.category.r5') },
    ...(paths.no_data === 0 ? [{ key: 'r6', cat: 'no_data' as Category, text: t('method.category.r6') }] : []),
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
    [t('method.coverage.aei', { aei: meta.dataVersion.aei.replace(/-/g, '‑') }), pct(cov.aeiPublished)],
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
            <div className={st.introSide}>
            <p className={st.lead}>{t('method.lead')}</p>
            <p className={st.build}>{t('method.updated', { onet: `${meta.dataVersion.onet} (${meta.onetRelease})`, aei: meta.dataVersion.aei.replace(/-/g, '‑'), bls: meta.dataVersion.bls })}</p>
            </div>
          </div>
          <div className={st.heroSheet}>
            <h2 className={st.heroTitle}>{t('method.hero.title')}</h2>
            <CategoryPath rows={pathRows} noLabel={t('method.hero.no')} exampleLabel={t('method.hero.examples')} />
            <p className={st.heroCaption}>
              {t('method.hero.caption', { tasks: f.integer(paths.total) })}{' '}
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
              <p>{t('method.category.rules')}</p>
              <ol className={st.rules}>
                {ruleRows.map((r) => (
                  <li key={r.key}>
                    <span className={st.ruleChip}>
                      <CategoryChip category={r.cat} />
                    </span>
                    <span>{r.text}</span>
                  </li>
                ))}
              </ol>
              <p>{t('method.category.theoryNote')}</p>
              <p>{t('method.category.exposureNote')}</p>
              <div className={st.formula} lang="en">
                <code>{t('method.category.exposureE1')}</code>
                <code className={st.formulaMain}>{t('method.category.exposureE2', { tw: dec(c.THEORY_WEIGHT), ow: dec(1 - c.THEORY_WEIGHT) })}</code>
              </div>
              <p className={st.muted}>{t('method.category.choice', { gate: pct(c.WORK_GATE, 0), auto: pct(c.aiDoesAutomation, 0) })}</p>

              {examples.length ? (
                <>
                  <h3 className={st.h3}>{t('method.category.examples')}</h3>
                  <div className={st.examples}>
                    {examples.map((e) => {
                      const ev2 = e.task.evidence;
                      const g4 = (ev2 as { gpt4Label?: string | null }).gpt4Label ?? null;
                      const use = ev2.observed
                        ? t('method.category.useObserved', { auto: pct(ev2.aeiAutomation ?? 0.5, 0), source: srcLabel(ev2.aeiSource) })
                        : ev2.everObserved
                          ? t('method.category.useEarlier')
                          : (ev2.penetration ?? 0) > 0
                            ? t('method.category.usePenetration', { value: dec(ev2.penetration ?? 0) })
                            : t('method.category.useNone');
                      const rating =
                        ev2.theorySource === 'human+gpt4'
                          ? t('method.category.ratingMixed', { human: ev2.theoryLabel ?? '', gpt4: g4 ?? '', value: dec(ev2.theory) })
                          : ev2.theoryLabel
                            ? t('method.category.ratingValue', { label: ev2.theoryLabel, value: dec(ev2.theory) })
                            : t('method.category.ratingNone');
                      return (
                        <article key={e.task.id} className={st.example} data-cat={ev2.category}>
                          <h4 className={st.exTask}>
                            <span className={st.exShort} lang="en">{e.short}</span>
                            <span className={st.exFull} lang="en">{e.task.text}</span>
                          </h4>
                          <dl className={st.exLines}>
                            <div>
                              <dt>{t('method.category.use')}</dt>
                              <dd>{use}</dd>
                            </div>
                            <div>
                              <dt>{t('method.category.physical')}</dt>
                              <dd>{ev2.physical ? t('method.category.yes') : t('method.category.noAnswer')}</dd>
                            </div>
                            <div>
                              <dt>{t('method.category.rating')}</dt>
                              <dd>{rating}</dd>
                            </div>
                          </dl>
                          <div className={st.exVerdict}>
                            <CategoryChip category={ev2.category} />
                            <EvidenceBadge level={ev2.evidenceLevel} size="sm" />
                          </div>
                          <p className={st.exWhy}>{t(`method.category.step_${e.step}`)}</p>
                        </article>
                      );
                    })}
                  </div>
                </>
              ) : null}
            </section>

            <section id={A.week} className={st.section}>
              <h2>{t('method.sections.week')}</h2>
              <p>{t('method.week.p1', { hours: WEEK_HOURS })}</p>
              <p>{t('method.week.p2', { n: c.DEFAULT_WEEK_TASKS, min: c.DEFAULT_SHARE_MIN, max: c.DEFAULT_SHARE_MAX })}</p>
              <div className={st.formula} lang="en">
                <code className={st.formulaMain}>{t('method.week.formula')}</code>
              </div>
              <p className={st.muted}>
                {t('method.week.freq', {
                  scale: Object.entries(c.FREQ_PER_YEAR)
                    .map(([k, v]) => `${k} = ${f.integer(v)}`)
                    .join(', '),
                })}
              </p>
              {nurse ? (
                <figure className={st.tableWrap}>
                  <figcaption>{t('method.week.example')}</figcaption>
                  <div className={st.scrollX}>
                    <table className={st.table}>
                      <thead>
                        <tr>
                          <th scope="col">{t('method.week.colTask')}</th>
                          <th scope="col">{t('method.week.colImportance')}</th>
                          <th scope="col">{t('method.week.colRelevance')}</th>
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
                            <td>{r.relevance != null ? f.integer(r.relevance) : '–'}</td>
                            <td>{r.perYear != null ? f.integer(r.perYear) : '–'}</td>
                            <td>{dec(r.weight, 1)}</td>
                            <td>
                              {f.integer(r.share)}%<span className={st.cellSub}>{t('method.week.hours', { h: dec((r.share * WEEK_HOURS) / 100, 1) })}</span>
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
                <code>{t('method.score.f1', { does: dec(c.AT_STAKE_DOES), speeds: dec(c.AT_STAKE_SPEEDS) })}</code>
                <code>{t('method.score.f2')}</code>
                <code>{t('method.score.f3', { scale: c.PRACTICE_SCALE })}</code>
                <code className={st.formulaMain}>{t('method.score.f4', { gain: dec(c.PRACTICE_GAIN) })}</code>
              </div>
              <p>{t('method.score.explainF', { gain: pct(c.PRACTICE_GAIN, 0) })}</p>
              {nurse ? (
                <div className={st.scoreEx}>
                  <h3 className={st.h3}>{t('method.score.example')}</h3>
                  <ol className={st.steps}>
                    <li>
                      {t('method.score.exPoints', {
                        does: f.integer(nurse.result.percent.ai_does),
                        wd: dec(c.AT_STAKE_DOES),
                        speeds: f.integer(nurse.result.percent.ai_speeds),
                        ws: dec(c.AT_STAKE_SPEEDS),
                        value: dec(nurse.pointsOff, 1),
                      })}
                    </li>
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
                        half: dec(c.AT_STAKE_SPEEDS),
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
                      <span className={st.muted}>{t('method.validation.row', { n: v.n })}</span>
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
