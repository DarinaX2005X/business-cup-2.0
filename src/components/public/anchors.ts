/**
 * Section anchors of /method. The week map inspector links to `/method#<anchor>`; keep these stable.
 */
export const METHOD_ANCHORS = {
  what: 'what',
  sources: 'sources',
  evidence: 'evidence',
  category: 'category',
  week: 'week',
  score: 'score',
  validation: 'validation',
  limits: 'limits',
  coverage: 'coverage',
  privacy: 'privacy',
} as const;

export type MethodAnchor = keyof typeof METHOD_ANCHORS;
export const METHOD_ORDER = Object.keys(METHOD_ANCHORS) as MethodAnchor[];
