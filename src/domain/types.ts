// Shared domain contracts (PLAN.md «Контракты»). This file is the authoritative copy:
// other packages import these types instead of redeclaring them.

export type Category = 'ai_does' | 'ai_speeds' | 'human_edge' | 'no_data';
export const CATEGORIES: readonly Category[] = ['ai_does', 'ai_speeds', 'human_edge', 'no_data'];

export type Locale = 'en' | 'ru' | 'kk';

export type EvidenceLevel = 'observed' | 'estimate' | 'none';

export interface TaskEvidence {
  theoryLabel: 'E0' | 'E1' | 'E2' | null; // human annotators' label (GPT-4 label when no human label)
  gpt4Label?: 'E0' | 'E1' | 'E2' | null; // GPT-4 label (always written by the build; optional for older fixtures), shown when it disagrees with the human one
  theorySource: 'human' | 'gpt4' | 'human+gpt4' | 'estimated' | null; // human+gpt4: labels disagree, theory is their mean
  theory: number; // 1 (E1), 0.5 (E2), 0 (E0); mean of human and GPT-4 when they disagree; DWA mean when estimated; 0 when unknown
  observed: boolean; // meaningful work use in AEI 2026-06-26: work-gated and a share >= 0.01% (see seenRarely)
  everObserved: boolean; // published in any AEI release since August 2025
  aeiShare: number | null; // 0..1 share of conversations (source in aeiSource)
  aeiSource: 'claude_ai' | '1p_api' | null; // which AEI file aeiShare comes from
  aeiAutomation: number | null; // 0..1 automation / (automation + augmentation), pct-weighted over sources
  aeiWorkShare: number | null; // 0..1 max work-use share over sources
  penetration: number | null; // AEI labor_market_impacts task_penetration 0..1
  history: { release: string; share: number }[] | null; // Claude.ai share by period, only with >= 3 periods
  physical: boolean | null; // Microsoft Working with AI physical flag
  // ---- Added in the data repair round. Always written by the build; optional so older fixtures compile.
  /** Work use is published in AEI 2026-06-26, but the share rounds below 0.01% in both sources: shown, not counted. */
  seenRarely?: boolean;
  /** Raw per-source facts behind aeiShare / aeiAutomation (0..1). */
  aeiClaudeShare?: number | null;
  aeiApiShare?: number | null;
  aeiClaudeAutomation?: number | null;
  aeiApiAutomation?: number | null;
  aeiClaudeWorkShare?: number | null;
  aeiApiWorkShare?: number | null;
  /** Which automation decided the category: Claude.ai, API (only with theory >= 0.75), or none. */
  automationBasis?: 'claude_ai' | '1p_api' | null;
  /** Most of the task's O*NET activities are work with people (relationships, care, teaching, supervising …). */
  peopleWork?: boolean;
  exposure: number; // 0..1
  category: Category;
  evidenceLevel: EvidenceLevel;
}

export interface OccTask {
  id: string;
  text: string;
  importance: number | null; // O*NET IM 1..5; null for the 12 occupations O*NET publishes without task ratings
  relevance: number | null; // O*NET RT 0..100
  frequency: number | null; // mean FT category 1..7
  core: boolean;
  dwaIds: string[];
  /** 2–4 word plain-English label for the Week Bar: model-written for the top 150 occupations, else shortLabel(text). */
  short?: string;
  evidence: TaskEvidence;
}

export interface RelatedOccupation {
  code: string;
  slug: string;
  title: string;
  similarity: number;
  typicalHumanShare: number;
  wageDelta: number | null;
  missingSkills: string[];
}

export interface OccupationBundle {
  code: string;
  slug: string;
  title: string;
  description: string;
  jobZone: number | null;
  wage: {
    medianAnnual: number | null;
    employment: number | null;
    sharedWith: number; // O*NET occupations sharing this OEWS row, including this one; 0 without wage
    soc: string | null; // OEWS code actually used (may be an aggregate such as 13-2020)
    note: 'aggregate' | 'hourly_x2080' | 'top_coded' | null;
    source: 'BLS OEWS May 2025';
  };
  tasks: OccTask[];
  skills: { id: string; name: string; importance: number }[];
  knowledge: { id: string; name: string; importance: number }[];
  typicalHumanShare: number; // 0..1 share of human_edge in the default week (defaultShares)
  /** Public bundles carry only the first neighbour (what Free shows); the full list is server-only (data/build/related.json). */
  related: RelatedOccupation[];
  /** Number of neighbours in the full list. */
  relatedCount?: number;
  dataVersion: DataVersion;
}

export interface DataVersion {
  onet: '31.0';
  aei: '2026-06-26';
  gpts: string;
  ms: string;
  bls: 'May 2025';
}

export interface TitleIndexEntry {
  t: string; // display title as published
  c: string; // O*NET-SOC code
  k: 'primary' | 'alt' | 'reported' | 'alias';
  l?: 'ru' | 'kk'; // language for translated titles and non-English aliases; absent = English
}

export interface OccupationIndexEntry {
  code: string;
  slug: string;
  title: string;
  jobZone: number | null;
  taskCount: number;
  typicalHumanShare: number;
  employment: number | null;
  rank: number; // 1 = most common: BLS employment, else number of O*NET titles (meta.rankBasis)
}

export interface WeekShare {
  taskId: string;
  share: number; // integer 1..100, sum 100
}

export interface XrayResult {
  id: string;
  version: number;
  profileId: string;
  occupationCode: string;
  locale: Locale;
  jobTitle: string;
  inputSource: 'title' | 'resume' | 'description';
  shares: WeekShare[];
  hours: Record<Category, number>; // of 40
  percent: Record<Category, number>;
  observedShare: number; // 0..1 share of the week in tasks with evidenceLevel = observed
  salary: { annual: number | null; source: 'bls_median' | 'user' | 'none' };
  payAtStake: number | null; // annual × (percent.ai_does × 1 + percent.ai_speeds × 0.5) / 100
  weekExposure: number; // Σ share × exposure / 100
  baseScore: number; // round(100 × (1 − (percent.ai_does × 1 + percent.ai_speeds × 0.5) / 100)), same weights as payAtStake
  score: number; // round(baseScore + (100 − baseScore) × 0.45 × F), F = (1 − e^(−n/20)) × avgScore
  practice: { n: number; avgScore: number }; // avgScore 0..1
  handToAi: string[];
  humanEdge: string[];
  hoursFreed: number;
  dataVersion: DataVersion;
  createdAt: string;
  updatedAt: string;
}

/** What computeXray returns: everything the server does not add (ids, owner, version, input meta, timestamps). */
export type XrayComputed = Omit<
  XrayResult,
  'id' | 'version' | 'profileId' | 'locale' | 'jobTitle' | 'inputSource' | 'createdAt' | 'updatedAt'
>;

export interface XrayBreakdown {
  /**
   * contribution = share × exposure / 100 (adds up to weekExposure);
   * weight = category weight (1 / 0.5 / 0); scorePoints = share × weight (adds up to 100 − baseScore).
   */
  perTask: { taskId: string; share: number; hours: number; exposure: number; contribution: number; weight: number; scorePoints: number }[];
  scoreFormula: { base: number; n: number; avg: number; F: number; score: number };
  pay: {
    annual: number | null;
    /** (percent.ai_does × 1 + percent.ai_speeds × 0.5) / 100; payAtStake = annual × shareAtStake */
    shareAtStake: number;
    /** @deprecated kept for existing callers; equals shareAtStake */
    shareHighExposure: number;
    weights: { ai_does: number; ai_speeds: number };
  };
}

export interface ResumeFacts {
  title: string;
  seniorityYears: number | null;
  industry: string | null;
  duties: { original: string; en: string }[];
  tools: string[];
}

export type RepType = 'slip' | 'delegate' | 'edge';

export interface SlipError {
  quote: string;
  start: number;
  end: number;
  type: 'fact' | 'logic' | 'compliance' | 'omission' | 'tone' | 'calculation';
  explanation: string;
  fix: string;
}

export interface Trap {
  id: string;
  description: string;
  keywords: string[];
}

export interface Rep {
  id: string;
  profileId: string;
  type: RepType;
  taskId: string;
  occupationCode: string;
  locale: Locale;
  day: string;
  kind: 'daily' | 'extra' | 'trial';
  status: 'open' | 'done';
  source: 'live' | 'bank';
  seed: string;
  difficulty: 1 | 2 | 3;
  title: string;
  brief: string;
  slip?: { document: string; errors: SlipError[] };
  delegate?: {
    scenario: string;
    inputs: string;
    goal: string;
    criteria: { id: string; text: string }[];
    traps: Trap[];
    instruction?: string;
    run?: string;
    review?: { ranges: [number, number][]; fix: string };
  };
  edge?: {
    scenario: string;
    personaPublic: string;
    personaHidden: string;
    goal: string;
    criteria: { id: string; text: string }[];
    turns: { role: 'user' | 'persona'; text: string }[];
  };
  result?: RepResult;
  createdAt: string;
  completedAt?: string;
}

export interface RepPublic {
  id: string;
  type: RepType;
  kind: Rep['kind'];
  status: Rep['status'];
  source: Rep['source'];
  title: string;
  brief: string;
  taskId: string;
  taskText: string;
  locale: Locale;
  slip?: { document: string; errorCount: number };
  delegate?: {
    scenario: string;
    inputs: string;
    goal: string;
    criteria: { id: string; text: string }[];
    instruction?: string;
    run?: string;
  };
  edge?: {
    scenario: string;
    personaPublic: string;
    goal: string;
    criteria: { id: string; text: string }[];
    turns: { role: 'user' | 'persona'; text: string }[];
    repliesLeft: number;
  };
  result?: RepResult;
  reveal?: RepReveal;
}

export interface RepResult {
  score: number;
  found?: number;
  total?: number;
  falseFlags?: number;
  flags?: ('over_selected' | 'ended_early')[];
  criteria?: { id: string; status: 'met' | 'partly' | 'missed'; quote?: string }[];
  trapsCaught?: string[];
  points: number;
  scoreChange: { before: number; after: number };
}

export interface RepReveal {
  errors?: SlipError[];
  traps?: Trap[];
  personaHidden?: string;
}

export interface AiOrMeRound {
  roundId: string;
  cards: {
    taskId: string;
    text: string;
    answer: 'ai' | 'human';
    fact: { key: string; params: Record<string, number | string> };
  }[];
  completed?: { correct: boolean[] };
}

export type PointsType =
  | 'xray_completed'
  | 'week_confirmed'
  | 'rep_completed'
  | 'rep_perfect'
  | 'first_rep'
  | 'streak_bonus'
  | 'ai_or_me'
  | 'used_at_work'
  | 'proof_shared'
  | 'review_kit'
  | 'invite_completed'
  | 'invited_bonus'
  | 'pivot_explored'
  | 'redeem'
  | 'plan_item_done';

export interface PointsEvent {
  id: string;
  type: PointsType;
  points: number;
  ref: string;
  at: string;
  /** Local day (YYYY-MM-DD) the action counts for: daily limits (04.1.1). */
  day?: string;
}

export interface PointsAward {
  type: PointsType;
  points: number;
  labelKey: string;
}

export interface Reward {
  id: string;
  kind: 'pro_discount' | 'pro_months' | 'partner_gift' | 'streak_freeze' | 'coming_soon';
  cost: number | null;
  percentOff?: number;
  months?: number;
  partner?: 'claude' | 'chatgpt';
  titleKey: string;
}

export interface Redemption {
  id: string;
  rewardId: string;
  cost: number;
  status: 'issued' | 'applied' | 'requested' | 'sent';
  code?: string;
  email?: string;
  at: string;
  /** Stripe promotion code id behind `code` (pro_* rewards). */
  promotionCodeId?: string;
  /** Where an applied code went: the next Checkout or the running subscription. */
  appliedTo?: 'checkout' | 'subscription';
  appliedAt?: string;
}

export interface ProofEntry {
  id: string;
  repId: string;
  type: RepType;
  taskId: string;
  occupationCode: string;
  score: number;
  summaryKey: string;
  summaryParams: Record<string, number | string>;
  at: string;
  public: boolean;
}

export interface Profile {
  id: string;
  version: number;
  secretHash: string;
  createdAt: string;
  locale: Locale;
  tz: string | null;
  occupationCode?: string;
  jobTitle?: string;
  resumeFacts?: ResumeFacts;
  shares?: WeekShare[];
  salary?: number | null;
  xrays: string[];
  lastXrayId?: string;
  reps: string[];
  repLog: { id: string; taskId: string; type: RepType; kind: Rep['kind']; day: string; score?: number }[];
  trial: { status: 'available' | 'in_progress' | 'used'; repId?: string };
  streak: { current: number; best: number; lastDay: string | null; days: string[]; freezes: number };
  /** `xp`: every positive award ever, never spent (levels, leaderboard); older profiles derive it, see xpOf. */
  points: { balance: number; events: PointsEvent[]; xp?: number };
  redemptions: Redemption[];
  plan: {
    status: 'free' | 'trialing' | 'pro';
    periodEnd?: string;
    stripeCustomerId?: string;
    subscriptionId?: string;
    /** What gives Pro: a Stripe subscription or the Business Cup 2.0 offer (04.1.4). */
    source?: 'stripe' | 'cup';
    interval?: 'month' | 'year';
    /** Stripe subscription set to end at `periodEnd` (canceled in the Billing Portal). */
    cancelAtPeriodEnd?: boolean;
    /** Last time the plan was read from Stripe. */
    syncedAt?: string;
    /** Paid tier; missing means 'pro' (plans made before round 3). The Cup offer is always 'coach'. */
    tier?: 'pro' | 'coach';
  };
  proof: ProofEntry[];
  publicSlug?: string;
  invitedBy?: string;
  sound: boolean;
  hintsSeen: string[];
  /** Leaderboard name chosen by the person (2–24 characters, see cleanNickname). */
  nickname?: string;
  /** A Business Cup jury account built from a sample résumé (shown with a "Demo account" mark). */
  demo?: boolean;
  /** Jury persona → the week map built for it (makes POST /api/demo/jury idempotent). */
  demoXrays?: Partial<Record<'nurse' | 'software' | 'accountant', string>>;
  /** Skills read from the résumé or added by the person (round 3 growth, src/server/growth). */
  skills?: ProfileSkills;
  /** Progress on the 90-day plan of each week map, by xray id (round 3 growth). */
  planProgress?: Record<string, PlanProgress>;
}

// ---- Round 3 growth: skills from the résumé and the 90-day plan (src/server/growth)

/** resume: read from the résumé by `profile.skills`; added: typed by the person; confirmed: a résumé skill the person kept. */
export type SkillSource = 'resume' | 'added' | 'confirmed';
export type SkillKind = 'skill' | 'knowledge' | 'tool';

export interface ProfileSkill {
  /** Stable within the profile: `sk_` + a hash of the normalised name. */
  id: string;
  /** The person's own wording: «Patient triage», «Python», «Month-end close». */
  name: string;
  kind: SkillKind;
  /** O*NET skill or knowledge element this counts toward (src/server/growth/onet.ts), or null. */
  onetId: string | null;
  /** O*NET technology name a tool matches (Software Skills of the occupation), or null. */
  tech: string | null;
  source: SkillSource;
  /** Up to two short verbatim excerpts of the résumé; the code checked each one is in the text. */
  quotes: string[];
  /** Years of use when the résumé states or dates them. */
  years: number | null;
  at: string;
}

export interface ProfileSkills {
  items: ProfileSkill[];
  /** O*NET elements the résumé shows, each with a verified excerpt (gaps are what is not here). */
  shown: { onetId: string; quote: string }[];
  /** O*NET elements the read looked for (shown or not); elements outside it are unknown, not missing. */
  checked: string[];
  /** Skills the person removed: a new read does not bring them back, and «Undo» restores them. */
  removed: { key: string; item: ProfileSkill }[];
  /** Occupation the résumé was read against. */
  occupationCode: string | null;
  /** sha256 of the normalised résumé text (the text itself is never stored). */
  textHash: string | null;
  seniorityYears: number | null;
  extractedAt: string | null;
  updatedAt: string;
}

export interface PlanProgress {
  /** The plan these checks belong to (`plan:<xrayId>` in the store). */
  planId: string;
  /** Local day (YYYY-MM-DD) week 1 started. */
  startDay: string;
  /** Checked items with the local day they were checked. */
  done: { id: string; day: string }[];
}
