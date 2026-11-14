'use client';

import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import { CategorySwatch } from '@/components/kit/Evidence';
import { SheetStack } from '@/components/kit/Illustration';
import { ScoreDial } from '@/components/kit/ScoreDial';
import { useKit } from '@/components/kit/strings';
import { groupWeek, hoursOf } from '@/components/kit/week';
import btn from '@/components/kit/controls.module.css';
import { Plans } from '@/components/pricing/Plans';
import { useT } from '@/i18n/client';
import { ArtEdge, ArtJob, ArtSlip, ArtTimer } from './Art';
import { ArtDelegate, ArtGame, ArtProof, ArtShop, ArtStreak, ArtWeek } from './ArtMore';
import type { WeekView } from './data';
import st from './landing.module.css';

/** «How it works»: three steps in one row, each with its own illustration, joined by a dashed line. */
export function Steps() {
  const { t } = useT();
  const steps = [
    { key: 'one', art: <ArtJob /> },
    { key: 'two', art: <ArtWeek /> },
    { key: 'three', art: <ArtTimer /> },
  ] as const;
  return (
    <section className={st.steps} aria-labelledby="steps-title">
      <span className={st.stepsShape} aria-hidden="true" />
      <div className={st.wrap}>
        <div className={st.headC}>
          <h2 id="steps-title" className={st.h2}>
            {t('landing.steps.title')}
          </h2>
          <p className={st.lead}>{t('landing.steps.lead')}</p>
        </div>
        <ol className={st.stepList}>
          {steps.map((step, i) => (
            <li key={step.key} className={st.step} data-n={i + 1}>
              <div className={st.stepArt}>{step.art}</div>
              <span className={st.stepNo} aria-hidden="true">
                {i + 1}
              </span>
              <h3 className={st.stepTitle}>{t(`landing.steps.${step.key}.title`)}</h3>
              <p className={st.stepBody}>{t(`landing.steps.${step.key}.body`)}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/** The banner: the product's signature moment, with the stack of sheets and the apricot marker. */
export function MistakeBanner() {
  const { t } = useT();
  return (
    <section className={st.bannerSec} aria-labelledby="banner-title">
      <div className={st.wrap}>
        <div className={`field ${st.banner}`} data-surface="field">
          <span className={st.bannerTile} aria-hidden="true" />
          <div className={st.bannerText}>
            <h2 id="banner-title" className={st.bannerTitle}>
              {t('landing.banner.title')}
            </h2>
            <p className={st.bannerBody}>{t('landing.banner.body')}</p>
            <Link href="/start" className={`${btn.btn} ${btn.b_lavender} ${btn.s_lg}`}>
              {t('landing.form.submit')}
            </Link>
          </div>
          <div className={st.bannerArt} aria-hidden="true">
            <SheetStack fit="contain" />
          </div>
        </div>
      </div>
    </section>
  );
}

function Small({ k, art, tone, className }: { k: string; art: ReactNode; tone: 'violet' | 'warm' | 'sunk'; className: string }) {
  const { t } = useT();
  return (
    <article className={`${st.card} ${st.small} ${className}`}>
      <div className={st.cardArt} data-tone={tone}>
        {art}
      </div>
      <h3 className={st.cardTitle}>{t(`landing.features.${k}.title`)}</h3>
      <p className={st.cardBody}>{t(`landing.features.${k}.body`)}</p>
    </article>
  );
}

/**
 * «What you get»: a bento of the product's own objects, redrawn as illustrations. The only numbers
 * are the example week and its score, read from the landing fixture (a nurse's week mapped from the
 * sample resume by the real pipeline).
 */
export function Features({ view }: { view: WeekView }) {
  const { t, f } = useT();
  const { s: kit } = useKit();
  const groups = groupWeek(view.tasks);
  const top = [...view.tasks].sort((x, y) => y.share - x.share).slice(0, 4);
  const h = (share: number) => f.number(hoursOf(share), { maximumFractionDigits: 1 });
  const reps = [
    { k: 'slip', art: <ArtSlip /> },
    { k: 'delegate', art: <ArtDelegate /> },
    { k: 'edge', art: <ArtEdge /> },
  ];

  return (
    <section className={st.features} aria-labelledby="features-title">
      <div className={st.wrap}>
        <div className={st.headC}>
          <h2 id="features-title" className={st.h2}>
            {t('landing.features.title')}
          </h2>
          <p className={st.lead}>{t('landing.features.lead')}</p>
        </div>

        <div className={st.cards}>
          <article className={`field ${st.card} ${st.cardMap}`} data-surface="field">
            <div className={st.cardText}>
              <h3 className={st.cardTitle}>{t('landing.features.map.title')}</h3>
              <p className={st.cardBody}>{t('landing.features.map.body')}</p>
              <div className={st.dial}>
                <ScoreDial value={view.result.score} surface="violet" size={190} />
              </div>
            </div>
            <figure className={st.mapFig}>
              <ul className={st.mwTotals}>
                {groups.map((g) => (
                  <li key={g.category} data-cat={g.category}>
                    <b>{t('landing.features.map.hours', { hours: h(g.share) })}</b>
                    <span>{kit.category[g.category]}</span>
                  </li>
                ))}
              </ul>
              <div className={st.mwBar} role="img" aria-label={t('landing.features.map.caption')}>
                {groups
                  .flatMap((g) => g.tasks)
                  .map((task, i) => (
                    <span key={task.id} data-cat={task.category} style={{ flexGrow: task.share, '--i': i } as CSSProperties} />
                  ))}
              </div>
              <p className={st.mwTop}>{t('landing.features.map.top')}</p>
              <ul className={st.mwTasks}>
                {top.map((task) => (
                  <li key={task.id}>
                    <CategorySwatch category={task.category} size="sm" />
                    <span>{task.label}</span>
                    <b>{t('landing.features.map.hours', { hours: h(task.share) })}</b>
                  </li>
                ))}
              </ul>
              <figcaption>{t('landing.features.map.caption')}</figcaption>
            </figure>
          </article>

          <article className={`${st.card} ${st.cardReps}`}>
            <div className={st.cardText}>
              <h3 className={st.cardTitle}>{t('landing.features.reps.title')}</h3>
              <p className={st.cardBody}>{t('landing.features.reps.body')}</p>
            </div>
            <ul className={st.repRow}>
              {reps.map((r) => (
                <li key={r.k} className={st.repItem}>
                  <div className={st.repArt}>{r.art}</div>
                  <h4 className={st.repName}>{t(`landing.features.reps.${r.k}`)}</h4>
                  <p className={st.repBody}>{t(`landing.features.reps.${r.k}Body`)}</p>
                </li>
              ))}
            </ul>
          </article>

          <Small k="game" art={<ArtGame />} tone="violet" className={st.cardGame} />
          <Small k="shop" art={<ArtShop />} tone="sunk" className={st.cardThird} />
          <Small k="proof" art={<ArtProof />} tone="warm" className={st.cardThird} />
          <Small k="streak" art={<ArtStreak />} tone="violet" className={st.cardThird} />
        </div>
      </div>
    </section>
  );
}

/** «What you pay for»: the same three plans as /pricing, with the Business Cup 2.0 card under them. */
export function Pay() {
  const { t } = useT();
  return (
    <section className={st.pay} aria-labelledby="pay-title">
      <div className={st.wrap}>
        <div className={st.headC}>
          <h2 id="pay-title" className={st.h2}>
            {t('landing.pay.title')}
          </h2>
          <p className={st.lead}>{t('landing.pay.lead')}</p>
        </div>
        <Plans />
      </div>
    </section>
  );
}

/** «Built on real data»: where the numbers come from, in three lines, and the way to the method page. */
export function DataNote() {
  const { t } = useT();
  return (
    <section className={st.data} aria-labelledby="data-title">
      <div className={`${st.wrap} ${st.dataIn}`}>
        <h2 id="data-title" className={st.dataTitle}>
          {t('landing.data.title')}
        </h2>
        <ul className={st.dataList}>
          <li>{t('landing.data.onet')}</li>
          <li>{t('landing.data.aei')}</li>
          <li>{t('landing.data.bls')}</li>
        </ul>
        <Link href="/method" className={st.paperLink}>
          {t('landing.data.link')}
        </Link>
      </div>
    </section>
  );
}
