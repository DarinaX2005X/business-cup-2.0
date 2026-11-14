import type { Metadata } from 'next';
import { getT } from '@/i18n/messages';
import { PublicFooter, PublicHeader } from '@/components/public/PublicChrome';
import { JobsIndex } from '@/components/public/JobsIndex';
import { getOccupations, siteUrl, sourceList } from '@/components/public/data';
import st from '@/components/public/jobs.module.css';

export const dynamic = 'force-static';

export async function generateMetadata(): Promise<Metadata> {
  const t = getT('en');
  const count = (await getOccupations()).length;
  return {
    metadataBase: siteUrl(),
    title: t('jobs.index.metaTitle', { count }),
    description: t('jobs.index.metaDescription', { count }),
    alternates: { canonical: '/jobs' },
    openGraph: { title: t('jobs.index.title'), description: t('jobs.index.metaDescription', { count }), url: '/jobs', siteName: 'Irreplaceable', locale: 'en_US' },
  };
}

export default async function JobsPage() {
  const t = getT('en');
  const list = await getOccupations();
  const jobs = [...list]
    .sort((a, b) => a.title.localeCompare(b.title, 'en'))
    .map((o) => ({ slug: o.slug, title: o.title, human: Math.round(o.typicalHumanShare * 100) }));
  return (
    <>
      <PublicHeader
        current="jobs"
        labels={{ home: t('jobs.chrome.home'), nav: t('jobs.chrome.nav'), method: t('jobs.chrome.method'), jobs: t('jobs.chrome.jobs'), start: t('jobs.chrome.start') }}
      />
      <main lang="en" className={st.indexPage}>
        <header className={st.indexHead}>
          <h1 className={st.indexH1}>{t('jobs.index.title')}</h1>
          <p>{t('jobs.index.intro', { count: jobs.length })}</p>
        </header>
        <JobsIndex
          jobs={jobs}
          labels={{
            filter: t('jobs.index.filter'),
            placeholder: t('jobs.index.placeholder'),
            empty: t('jobs.index.empty', {}),
            showingOne: t('jobs.index.showing_one'),
            showingOther: t('jobs.index.showing_other'),
            human: t('jobs.index.humanShare'),
            letters: t('jobs.index.letters'),
          }}
        />
      </main>
      <PublicFooter title={t('jobs.footer.title')} note={t('jobs.footer.note')} methodLabel={t('jobs.footer.method')} sources={sourceList()} />
    </>
  );
}
