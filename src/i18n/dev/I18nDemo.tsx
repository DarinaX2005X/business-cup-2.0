'use client';

import { useState, useSyncExternalStore } from 'react';
import { useT } from '../client';
import { LocaleSwitcher } from '../LocaleSwitcher';

/**
 * Check page for the language mechanism (mounted at /dev/i18n by MAIN): switching the language must
 * change texts, numbers, money, dates and plural forms in place while the typed draft and counter stay.
 */
const subscribeNoop = () => () => undefined;
const galleryFlag = () => new URLSearchParams(window.location.search).get('gallery') === '1';

/** Open in development; in production only with `?gallery=1` (like the kit gallery). */
export function I18nDemo() {
  const unlocked = useSyncExternalStore(subscribeNoop, galleryFlag, () => false);
  if (process.env.NODE_ENV === 'production' && !unlocked) {
    return (
      <main style={{ maxWidth: 640, margin: '0 auto', padding: '32px 16px' }}>
        <h1>404</h1>
        <p>This page could not be found.</p>
      </main>
    );
  }
  return <Demo />;
}

function Demo() {
  const { t, f, locale } = useT();
  const [count, setCount] = useState(1);
  const [draft, setDraft] = useState('');
  const sample = new Date('2026-11-14T00:00:00Z');

  return (
    <main style={{ maxWidth: 640, margin: '0 auto', padding: '32px 16px', display: 'grid', gap: 16 }}>
      <label htmlFor="locale-switcher">{t('common.language')}</label>
      <LocaleSwitcher />
      <p data-testid="locale">{locale}</p>
      <p>{t('common.errors.network')}</p>
      <p>
        <button type="button" onClick={() => setCount((c) => c + 1)}>
          {t('common.actions.retry')}
        </button>{' '}
        <span data-testid="plural">{t('common.points.earned', { count })}</span>
      </p>
      <p data-testid="formats">
        {f.number(12345.6)} · {f.currency(72000)} · {f.percent(0.42)} · {f.date(sample, 'long')}
      </p>
      <input value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="draft" />
    </main>
  );
}
