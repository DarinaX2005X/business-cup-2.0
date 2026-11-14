'use client';

import Link from 'next/link';
import { Wordmark } from '@/components/kit/Mark';
import ctl from '@/components/kit/controls.module.css';
import { LanguageSwitch } from '@/components/public/LanguageSwitch';
import pub from '@/components/public/public.module.css';
import { useT } from '@/i18n/client';

/** The public header (same pieces as /method) with Pricing as the current page. */
export function PricingHeader({ mapHref }: { mapHref: string | null }) {
  const { t } = useT();
  return (
    <header className={pub.header}>
      <div className={pub.headerIn}>
        <Link href="/" className={pub.brand} aria-label={t('pricing.nav.home')}>
          <Wordmark size={34} />
        </Link>
        <nav className={pub.nav} aria-label={t('pricing.nav.label')}>
          <Link href="/method" className={pub.navLink}>
            {t('pricing.nav.method')}
          </Link>
          <Link href="/pricing" className={pub.navLink} aria-current="page">
            {t('pricing.nav.pricing')}
          </Link>
        </nav>
        <LanguageSwitch className={pub.locale} />
        <Link href={mapHref ?? '/start'} className={`${ctl.btn} ${ctl.b_primary} ${ctl.s_sm} ${pub.headerCta}`}>
          {mapHref ? t('pricing.nav.openMap') : t('pricing.nav.start')}
        </Link>
      </div>
    </header>
  );
}
