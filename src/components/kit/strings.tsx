'use client';

/*
 * Words the kit draws itself (category names, evidence labels, units).
 * English defaults live here; screens pass translated strings through <KitProvider>
 * (fed from src/i18n once 01.3 lands). The kit never owns translations.
 */

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { Category, Locale } from './types';

export interface KitStrings {
  category: Record<Category, string>;
  observed: string;
  estimate: string;
  noEvidence: string;
  notSeen: string;
  research: { E0: string; E1: string; E2: string; none: string };
  conversations: string;
  automation: string;
  together: string;
  hoursUnit: string;
  hoursShort: (h: string) => string;
  perWeek: (h: string) => string;
  share: string;
  score: string;
  scoreHint: string;
  outOf: string;
  points: string;
  streakDays: string[];
  today: string;
  redeem: string;
  needMore: (n: string) => string;
  yourCode: string;
  copy: string;
  copied: string;
  comingSoon: string;
  undo: string;
  close: string;
  dismiss: string;
  dropTitle: string;
  dropHint: string;
  dropActive: string;
  dropReading: (file: string) => string;
  dropDone: (file: string) => string;
  dropError: string;
  dropRetry: string;
  chooseFile: string;
  soundOn: string;
  soundOff: string;
  draftedByAi: string;
  highlightHint: string;
  highlightKeys: string;
  noMatches: string;
  notOnOurList: string;
}

export const enStrings: KitStrings = {
  category: {
    ai_does: 'AI already does it',
    ai_speeds: 'AI speeds it up',
    human_edge: 'Your human edge',
    no_data: 'No data yet',
  },
  observed: 'Observed in real AI use',
  estimate: 'Research estimate',
  noEvidence: 'No evidence yet',
  notSeen: 'Not yet seen in published AI usage',
  research: {
    E0: 'Researchers rated this task as one AI barely helps with',
    E1: 'Researchers rated this task as one a language model can speed up by half',
    E2: 'Researchers rated this task as one AI can speed up with extra tools',
    none: 'No research rating for this task',
  },
  conversations: 'Share of AI work conversations',
  automation: 'AI does it',
  together: 'Done together',
  hoursUnit: 'h',
  hoursShort: (h) => `${h} h`,
  perWeek: (h) => `${h} h a week`,
  share: 'Share of week',
  score: 'Irreplaceability score',
  scoreHint: 'out of 100, grows with practice',
  outOf: 'of 100',
  points: 'points',
  streakDays: ['M', 'T', 'W', 'T', 'F', 'S', 'S'],
  today: 'Today',
  redeem: 'Redeem',
  needMore: (n) => `Need ${n} more`,
  yourCode: 'Your code',
  copy: 'Copy',
  copied: 'Copied',
  comingSoon: 'More products coming soon',
  undo: 'Undo',
  close: 'Close',
  dismiss: 'Dismiss',
  dropTitle: 'Drop your résumé here',
  dropHint: 'PDF, DOCX or plain text, up to 5 MB',
  dropActive: 'Let go to read it',
  dropReading: (f) => `Reading ${f}`,
  dropDone: (f) => `${f} is ready`,
  dropError: 'We could not read this file. Try a PDF or paste the text.',
  dropRetry: 'Choose another file',
  chooseFile: 'Choose a file',
  soundOn: 'Sound on',
  soundOff: 'Sound off',
  draftedByAi: 'Drafted by AI',
  highlightHint: 'Drag across the words you think are wrong, or tap a word',
  highlightKeys: 'Arrow keys move between words, Shift extends the selection, Enter marks it.',
  noMatches: 'No matching job titles',
  notOnOurList: 'Not on our list',
};

interface KitContextValue {
  locale: Locale;
  s: KitStrings;
  num: (v: number, digits?: number) => string;
  hours: (v: number) => string;
}

const intlLocale: Record<Locale, string> = { en: 'en-US', ru: 'ru-RU', kk: 'kk-KZ' };

function makeValue(locale: Locale, s: KitStrings): KitContextValue {
  const cache = new Map<number, Intl.NumberFormat>();
  const fmt = (digits: number) => {
    let f = cache.get(digits);
    if (!f) {
      f = new Intl.NumberFormat(intlLocale[locale], { minimumFractionDigits: digits, maximumFractionDigits: digits });
      cache.set(digits, f);
    }
    return f;
  };
  return {
    locale,
    s,
    num: (v, digits = 0) => fmt(digits).format(v),
    hours: (v) => fmt(1).format(v),
  };
}

const KitContext = createContext<KitContextValue>(makeValue('en', enStrings));

export function KitProvider({ locale = 'en', strings, children }: { locale?: Locale; strings?: Partial<KitStrings>; children: ReactNode }) {
  const value = useMemo(() => makeValue(locale, { ...enStrings, ...strings }), [locale, strings]);
  return <KitContext.Provider value={value}>{children}</KitContext.Provider>;
}

export function useKit() {
  return useContext(KitContext);
}
