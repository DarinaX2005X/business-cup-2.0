'use client';

import { SiteHeader } from '@/components/landing/SiteHeader';

/** /pricing uses the site's one header (the landing's), like every marketing page. `mapHref` is kept for the caller. */
export function PricingHeader(_props: { mapHref?: string | null }) {
  return <SiteHeader />;
}
