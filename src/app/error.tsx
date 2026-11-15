'use client';

import { useEffect } from 'react';
import { Lost } from '@/components/public/Lost';

/** An unexpected error while rendering a page: «Try again» and a way back, in the product's look. */
export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[page] render failed', error.digest ?? error.message);
  }, [error]);
  return <Lost kind="error" onRetry={reset} />;
}
