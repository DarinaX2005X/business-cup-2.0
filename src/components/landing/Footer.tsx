import Link from 'next/link';
import { sourceList } from '@/components/public/data';
import type { TFunction } from '@/i18n/core';
import { LANDING_LINKS } from './config';
import { Logo } from './Logo';
import st from './landing.module.css';

/** The one footer of the site: How we measure, Privacy, Job pages, Pricing, and the datasets with their licences. */
export function LandingFooter({ t }: { t: TFunction }) {
  const sources = sourceList();
  return (
    <footer className={st.footer}>
      <div className={st.footerIn}>
        <div className={st.footerBrand}>
          <Logo size={32} />
          <p>{t('landing.footer.slogan')}</p>
        </div>
        <nav className={st.footerNav} aria-label={t('landing.footer.links')}>
          <Link href="/method" className={st.paperLink}>
            {t('landing.footer.method')}
          </Link>
          <Link href="/privacy" className={st.paperLink}>
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

/** The shared site footer (same as the landing's). */
export const SiteFooter = LandingFooter;
