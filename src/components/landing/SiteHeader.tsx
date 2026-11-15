'use client';

import Link from 'next/link';
import { LandingAccount } from '@/components/public/Returning';
import { useT } from '@/i18n/client';
import { Logo } from './Logo';
import { StickyNav } from './StickyNav';
import st from './landing.module.css';

/** Sections of the landing the header scrolls to (ids on the sections in Sections.tsx). */
export const LANDING_ANCHORS = [
  { id: 'how', key: 'landing.nav.how' },
  { id: 'features', key: 'landing.nav.features' },
  { id: 'pricing', key: 'landing.nav.pricing' },
  { id: 'data', key: 'landing.nav.data' },
] as const;

/**
 * The one header of the site (landing, /method, /jobs, /pricing, /privacy, sign-in pages): the logo, the
 * landing's sections and Log in / Open the app on the right. On the landing it sits on the hero's field and
 * its links scroll; elsewhere it is a solid violet bar and the same links open those landing sections.
 */
export function SiteHeader({ home = false }: { home?: boolean }) {
  const { t } = useT();
  return (
    <StickyNav className={st.nav} solid={!home}>
      <div className={st.navIn}>
        <Link href="/" className={st.brand} aria-label={t('landing.nav.home')}>
          <Logo surface="field" size={36} />
        </Link>
        <nav className={st.navLinks} aria-label={t('landing.nav.label')}>
          {LANDING_ANCHORS.map((a) =>
            home ? (
              <a key={a.id} href={`#${a.id}`} className={st.navLink}>
                {t(a.key)}
              </a>
            ) : (
              <Link key={a.id} href={`/#${a.id}`} className={st.navLink}>
                {t(a.key)}
              </Link>
            ),
          )}
        </nav>
        <LandingAccount />
      </div>
    </StickyNav>
  );
}
