import { Closing } from '@/components/landing/Closing';
import { repSamples, weekView } from '@/components/landing/data';
import { LandingFooter } from '@/components/landing/Footer';
import { Hero, LandingHeader } from '@/components/landing/Hero';
import { DataNote, Features, Pay, Steps } from '@/components/landing/Sections';
import st from '@/components/landing/landing.module.css';
import { getRequestT } from '@/i18n/server';

/**
 * The landing: what you get, shown with real pieces of the product. The week, the reps and the
 * rewards on it come from src/components/landing/fixtures (written by scripts/landing-fixtures.ts
 * from the real pipeline) and from the shop and pricing constants the product itself uses.
 */
export default async function LandingPage() {
  const t = await getRequestT();
  const view = weekView(t.locale);
  return (
    <div className={st.page}>
      <LandingHeader t={t} />
      <main>
        <Hero t={t} />
        <Steps view={view} />
        <Features view={view} reps={repSamples()} />
        <Pay />
        <DataNote />
        <Closing t={t} />
      </main>
      <LandingFooter t={t} />
    </div>
  );
}
