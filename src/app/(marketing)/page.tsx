import { CupSpecial } from '@/components/cup/CupSpecial';
import { Closing } from '@/components/landing/Closing';
import { DeletedToast } from '@/components/landing/DeletedToast';
import { weekView } from '@/components/landing/data';
import { SiteFooter } from '@/components/landing/Footer';
import { Hero } from '@/components/landing/Hero';
import { SiteHeader } from '@/components/landing/SiteHeader';
import { DataNote, Features, MistakeBanner, Pay, Steps } from '@/components/landing/Sections';
import st from '@/components/landing/landing.module.css';
import { getRequestT } from '@/i18n/server';

/**
 * The landing: what you get, shown with real pieces of the product. The week, the reps and the
 * rewards on it come from src/components/landing/fixtures (written by scripts/landing-fixtures.ts
 * from the real pipeline) and from the shop and pricing constants the product itself uses.
 * Order: hero, the Business Cup 2.0 card on the same field, how it works, what you get, the mistake banner, plans with the Business Cup band, the
 * data, the closing form. The header links scroll to these sections.
 */
export default async function LandingPage() {
  const t = await getRequestT();
  const view = weekView(t.locale);
  return (
    <div className={st.page}>
      <SiteHeader home />
      <main>
        <Hero t={t} />
        {/* the hero's field continues under the first screen with the Business Cup 2.0 offer */}
        <section className={`field ${st.cupLead}`} data-surface="field" aria-label={t('cup.titleA')}>
          <CupSpecial variant="hero" />
        </section>
        <Steps />
        <Features view={view} />
        <MistakeBanner />
        <Pay />
        <DataNote view={view} />
        <Closing t={t} />
      </main>
      <SiteFooter t={t} />
      <DeletedToast />
    </div>
  );
}
