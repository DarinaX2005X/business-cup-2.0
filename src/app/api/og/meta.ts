import { createHash } from 'node:crypto';
import type { Metadata } from 'next';
import type { XrayResult } from '@/domain/types';

/**
 * Share card helpers for pages that link the card (05.2.2): the week map `/x/[id]` and the public
 * portfolio `/p/[slug]` (which uses the card of its latest map).
 *
 *   export async function generateMetadata() {
 *     ...
 *     return { metadataBase: siteUrl(), title, ...scoreCardMetadata(xray, { title, description }) };
 *   }
 */

export const CARD_SIZE = { width: 1200, height: 630 } as const;

/** Changes whenever the map changes, so caches (and LinkedIn) never keep an outdated card. */
const versionTag = (x: Pick<XrayResult, 'version' | 'updatedAt'>) => createHash('sha256').update(`${x.version}:${x.updatedAt}`).digest('hex').slice(0, 10);

/** Relative path of the card; resolve against `metadataBase` or the site origin. */
export function scoreCardPath(x: Pick<XrayResult, 'id' | 'version' | 'updatedAt'>, opts: { locale?: string; download?: boolean } = {}): string {
  const q = new URLSearchParams({ x: x.id, v: versionTag(x) });
  if (opts.locale) q.set('l', opts.locale);
  if (opts.download) q.set('download', '1');
  return `/api/og/score?${q.toString()}`;
}

/** Open Graph and Twitter fields for a page whose preview is this map's card. */
export function scoreCardMetadata(
  x: Pick<XrayResult, 'id' | 'version' | 'updatedAt' | 'jobTitle'>,
  text: { title: string; description: string; alt?: string; locale?: string },
): Pick<Metadata, 'openGraph' | 'twitter'> {
  const image = { url: scoreCardPath(x, { locale: text.locale }), ...CARD_SIZE, alt: text.alt ?? text.title, type: 'image/png' };
  return {
    openGraph: { title: text.title, description: text.description, type: 'website', siteName: 'Irreplaceable', images: [image] },
    twitter: { card: 'summary_large_image', title: text.title, description: text.description, images: [image.url] },
  };
}

/** Host name printed on the card: the public site when configured, else the request's own host. */
export function cardDomain(requestUrl: URL): string {
  const raw = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  try {
    if (raw) return new URL(raw).host;
  } catch {
    /* fall through to the request host */
  }
  return requestUrl.host;
}
