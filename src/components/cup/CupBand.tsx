'use client';

import { CupSpecial } from './CupSpecial';

/**
 * The Business Cup 2.0 card under the plans, on the landing and on /pricing: the compact size of the
 * card the landing shows right under its first screen, with the jury's one-click accounts.
 */
export function CupBand({ className }: { className?: string }) {
  return <CupSpecial variant="compact" headingLevel="h3" className={className} />;
}
