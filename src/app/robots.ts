import type { MetadataRoute } from 'next';
import { siteUrl } from '@/components/public/data';

/** Public pages are open; personal maps, the API and the dev gallery are not for crawlers. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/', disallow: ['/api/', '/x/', '/dev/', '/today', '/progress', '/shop', '/profile', '/pro/'] },
    sitemap: new URL('/sitemap.xml', siteUrl()).toString(),
  };
}
