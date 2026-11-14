'use client';

import { MarketingHeader } from '@/components/public/MarketingHeader';

/**
 * The shared marketing header (src/components/public/MarketingHeader.tsx) with Pricing as the current page.
 * `mapHref` is kept for the caller; the header itself offers «Open my week» to a person with a map.
 */
export function PricingHeader(_props: { mapHref?: string | null }) {
  return <MarketingHeader current="pricing" />;
}
