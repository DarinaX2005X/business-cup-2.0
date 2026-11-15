import { KeystoneMark } from '@/components/kit/Mark';
import { categoryReason } from '@/domain/evidence';
import type { Category, OccupationBundle, XrayComputed } from '@/domain/types';
import { getT } from '@/i18n/server';
import { PrintActions } from './PrintActions';
import { distinctLabels, taskLabel } from './lib';
import { PlanPrintSection } from '@/components/plan/PlanPrintSection';
import type { PlanResponse } from '@/server/growth/types';
import st from './report.module.css';

const GROUPS: { category: Category; key: 'does' | 'speeds' | 'yours' }[] = [
  { category: 'ai_does', key: 'does' },
  { category: 'ai_speeds', key: 'speeds' },
  { category: 'human_edge', key: 'yours' },
];

/**
 * The week map as one calm A4 page: the job, the score and what it means, the week as a bar in whole
 * hours, the biggest tasks of each group with a one-line reason, pay at stake, three next steps and the
 * sources. English only (round 3). Printing hides the app shell and keeps cards whole across pages.
 */
export function Report({
  id,
  jobTitle,
  occupationTitle,
  result,
  bundle,
  shorts,
  autoPrint,
  plan,
}: {
  id: string;
  jobTitle: string;
  occupationTitle: string;
  result: XrayComputed;
  bundle: Pick<OccupationBundle, 'tasks' | 'dataVersion'>;
  /** Generated short labels when they exist (else the build's labels are used). */
  shorts: Record<string, string>;
  autoPrint: boolean;
  /** The owner's 90-day plan when one is written (read only, never generated here). */
  plan?: PlanResponse | null;
}) {
  const t = getT('en');
  const byId = new Map(bundle.tasks.map((x) => [x.id, x]));
  const ids = result.shares.map((s) => s.taskId);
  const labels = distinctLabels(ids, (tid) => taskLabel(shorts[tid] ?? null, byId.get(tid)), (tid) => byId.get(tid)?.text ?? '');
  const label = (tid: string) => labels.get(tid) ?? '';
  const sorted = [...result.shares].sort((a, b) => b.share - a.share);
  const whole = (h: number) => Math.round(h);
  const aei = t.f.date(bundle.dataVersion.aei, 'long');

  const hand = result.handToAi[0];
  const practise = result.handToAi[1] ?? result.handToAi[0];
  const edge = result.humanEdge[0];
  const steps = [
    hand ? t('xray.report.step1', { task: label(hand) }) : null,
    practise ? t('xray.report.step2', { task: label(practise) }) : t('xray.report.stepsGeneric'),
    edge ? t('xray.report.step3', { task: label(edge) }) : null,
  ].filter((x): x is string => !!x);

  return (
    <div className={st.sheet}>
      {/* Printing: no app header, tab bar or toasts, only the page. */}
      <style>{`@media print { header, nav, [class*="awardDock"], [class*="skip"] { display: none !important; } main { padding: 0 !important; } body { background: #fff !important; } @page { size: A4; margin: 14mm 14mm 16mm; } }`}</style>
      <PrintActions id={id} autoPrint={autoPrint} printLabel={t('xray.report.print')} backLabel={t('xray.report.back')} />

      <article className={st.page}>
        <header className={st.head}>
          <div className={st.brand}>
            <KeystoneMark size={28} />
            <span>Irreplaceable</span>
            <span className={st.kicker}>{t('xray.report.kicker')}</span>
          </div>
          <h1 className={st.title}>{jobTitle}</h1>
          <p className={st.sub}>{t('xray.conclusion.occupation', { title: occupationTitle })}</p>
        </header>

        <section className={`${st.card} ${st.scoreCard}`}>
          <div className={st.scoreNum}>{result.score}</div>
          <div>
            <h2 className={st.h2}>{t('xray.report.scoreTitle')}</h2>
            <p>{t('xray.report.scoreMeaning')}</p>
          </div>
        </section>

        <section className={st.card}>
          <h2 className={st.h2}>{t('xray.report.weekTitle')}</h2>
          <div className={st.bar} role="img" aria-label={GROUPS.map((g) => `${t(`xray.overview.${g.key}.title`)} ${whole(result.hours[g.category])} h`).join(', ')}>
            {GROUPS.filter((g) => result.percent[g.category] > 0).map((g) => (
              <span key={g.key} className={st.seg} data-cat={g.category} style={{ flexGrow: result.percent[g.category] }} />
            ))}
            {result.percent.no_data > 0 ? <span className={st.seg} data-cat="no_data" style={{ flexGrow: result.percent.no_data }} /> : null}
          </div>
          <ul className={st.legend}>
            {GROUPS.map((g) => (
              <li key={g.key}>
                <i className={st.key} data-cat={g.category} aria-hidden="true" />
                <span>{t(`xray.overview.${g.key}.title`)}</span>
                <b>{t('xray.report.hours', { hours: whole(result.hours[g.category]) })}</b>
              </li>
            ))}
          </ul>
        </section>

        <section className={st.groups}>
          <h2 className={st.h2}>{t('xray.report.groupsTitle')}</h2>
          <div className={st.groupGrid}>
            {GROUPS.map((g) => {
              const top = sorted.filter((s) => byId.get(s.taskId)?.evidence.category === g.category).slice(0, 3);
              return (
                <div key={g.key} className={st.card} data-cat={g.category}>
                  <h3 className={st.h3}>
                    <i className={st.key} data-cat={g.category} aria-hidden="true" />
                    {t(`xray.overview.${g.key}.title`)}
                  </h3>
                  {top.length ? (
                    <ul className={st.tasks}>
                      {top.map((s) => {
                        const task = byId.get(s.taskId);
                        return (
                          <li key={s.taskId}>
                            <b>{label(s.taskId)}</b>
                            <span className={st.taskH}>{t('xray.report.hours', { hours: whole((s.share * 40) / 100) })}</span>
                            <small>{task ? t(`xray.report.reason.${categoryReason(task.evidence)}`) : ''}</small>
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className={st.muted}>{t(`xray.overview.${g.key}.none`)}</p>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <section className={st.card}>
          <h2 className={st.h2}>{t('xray.report.payTitle')}</h2>
          <p className={st.pay}>
            {result.payAtStake != null && result.salary.annual != null
              ? t('xray.report.payLine', { atStake: t.f.currency(result.payAtStake), annual: t.f.currency(result.salary.annual) })
              : t('xray.report.payNone')}
          </p>
        </section>

        <section className={st.card}>
          <h2 className={st.h2}>{t('xray.report.stepsTitle')}</h2>
          <ol className={st.steps}>
            {steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </section>

        {plan ? <PlanPrintSection plan={plan} /> : null}

        <footer className={st.foot}>
          <p>{t('xray.report.made', { date: t.f.date(new Date(), 'long'), onet: bundle.dataVersion.onet, aei })}</p>
          <p>{t('xray.report.sources', { onet: bundle.dataVersion.onet, aei })}</p>
        </footer>
      </article>
    </div>
  );
}
