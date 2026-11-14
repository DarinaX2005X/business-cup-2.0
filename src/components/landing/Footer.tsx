import Link from 'next/link';
import { METHOD_ANCHORS } from '@/components/public/anchors';
import { sourceList } from '@/components/public/data';
import type { TFunction } from '@/i18n/core';
import { LANDING_LINKS } from './config';
import { LandingLanguage } from './LandingLanguage';
import { Logo } from './Logo';
import st from './landing.module.css';

/** Footer: where to read the method and the privacy notes, the datasets with their licences, the language. */
export function LandingFooter({ t }: { t: TFunction }) {
  const sources = sourceList();
  return (
    <footer className={st.footer}>
      <div className={st.footerIn}>
        <div className={st.footerBrand}>
          <Logo size={32} />
          <p>{t('landing.footer.slogan')}</p>
          <LandingLanguage surface="paper" />
        </div>
        <nav className={st.footerNav} aria-label={t('landing.footer.links')}>
          <Link href="/method" className={st.paperLink}>
            {t('landing.footer.method')}
          </Link>
          <Link href={`/method#${METHOD_ANCHORS.privacy}`} className={st.paperLink}>
            {t('landing.footer.privacy')}
          </Link>
          <Link href="/jobs" className={st.paperLink}>
            {t('landing.footer.jobs')}
          </Link>
          {LANDING_LINKS.pricing ? (
            <Link href={LANDING_LINKS.pricing} className={st.paperLink}>
              {t('landing.nav.pricing')}
            </Link>
          ) : null}
          {LANDING_LINKS.github ? (
            <a href={LANDING_LINKS.github} className={st.paperLink} target="_blank" rel="noreferrer">
              {t('landing.footer.github')}
            </a>
          ) : null}
        </nav>
        <div className={st.footerSources}>
          <h2 className={st.footerTitle}>{t('landing.footer.sources')}</h2>
          <ul>
            {sources.map((s) => (
              <li key={s.id}>
                <a href={s.url} className={st.paperLink} target="_blank" rel="noreferrer">
                  {s.name}
                </a>
                <span>
                  {s.version}, {s.license}
                </span>
              </li>
            ))}
          </ul>
          <p className={st.attribution}>
            {sources
              .filter((s) => s.id === 'onet' || s.id === 'aei')
              .map((s) => s.attribution)
              .join(' ')}
          </p>
        </div>
      </div>
    </footer>
  );
}
