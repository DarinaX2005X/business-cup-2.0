import { existsSync } from 'node:fs';
import path from 'node:path';
import { NAV_SECTIONS } from './nav.config';

/**
 * Server only. Which shell sections can be shown: enabled in nav.config.ts and with their page file
 * present under src/app/(app)/. The check runs wherever the sources are on disk (development, local
 * and CI builds), so a section whose screen is still being built never shows a dead link. A deployed
 * function without the sources trusts `enabled`, which the build already checked.
 */
const APP_DIR = path.join(process.cwd(), 'src', 'app', '(app)');

/** Extra pages outside the nav that other parts of the shell link to (Home's quick links, the menu). */
const EXTRA_PAGES = {
  leaderboard: 'leaderboard/page.tsx',
  profile: 'profile/page.tsx',
  playbook: 'playbook/page.tsx',
  secondLook: 'second-look/page.tsx',
  pivot: 'pivot/page.tsx',
} as const;

export type ExtraPage = keyof typeof EXTRA_PAGES;

function pageExists(rel: string): boolean {
  if (!existsSync(APP_DIR)) return true;
  return existsSync(path.join(APP_DIR, rel));
}

/** Ids of the nav sections that are on and have a page. */
export function availableSections(): string[] {
  return NAV_SECTIONS.filter((s) => s.enabled && (!s.page || pageExists(s.page))).map((s) => s.id);
}

/** Ids of the extra pages that exist. */
export function availablePages(): ExtraPage[] {
  return (Object.keys(EXTRA_PAGES) as ExtraPage[]).filter((k) => pageExists(EXTRA_PAGES[k]));
}
