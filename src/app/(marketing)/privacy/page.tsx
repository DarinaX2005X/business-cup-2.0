import type { Metadata } from 'next';
import { SiteFooter } from '@/components/landing/Footer';
import { SiteHeader } from '@/components/landing/SiteHeader';
import { siteUrl } from '@/components/public/data';
import st from '@/components/public/method.module.css';
import { getRequestT } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getRequestT();
  return { metadataBase: siteUrl(), title: t('method.privacyPage.title'), description: t('method.privacyPage.lead'), alternates: { canonical: '/privacy' } };
}

/** /privacy: what is kept, what is not, and how to delete it, in the site's own header and footer. */
export default async function PrivacyPage() {
  const t = await getRequestT();
  const parts = ['resume', 'stored', 'skills', 'delete'] as const;
  return (
    <>
      <SiteHeader />
      <main className={st.page}>
        <section className={st.intro}>
          <div className={st.introText}>
            <h1 className={st.h1}>{t('method.privacyPage.title')}</h1>
            <div className={st.introSide}>
              <p className={st.lead}>{t('method.privacyPage.lead')}</p>
            </div>
          </div>
        </section>
        <article className={st.article} style={{ maxWidth: 760, margin: '0 auto', paddingBottom: 64 }}>
          {parts.map((k) => (
            <section key={k} className={st.section}>
              <h2>{t(`method.privacyPage.${k}.title`)}</h2>
              <p>{t(`method.privacyPage.${k}.body`)}</p>
            </section>
          ))}
        </article>
      </main>
      <SiteFooter t={t} />
    </>
  );
}
