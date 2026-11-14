import type { MetadataRoute } from 'next';
import { getMeta, getOccupations, siteUrl } from '@/components/public/data';

/** Every public page: landing, method, pricing, the job index and all job pages. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();
  const at = (path: string) => new URL(path, base).toString();
  const meta = getMeta();
  // The data build date stands in for the last change of data-driven pages.
  const dataDate = new Date(`${meta.dataVersion.aei}T00:00:00Z`);
  const jobs = await getOccupations();
  return [
    { url: at('/'), changeFrequency: 'weekly', priority: 1 },
    { url: at('/method'), lastModified: dataDate, changeFrequency: 'monthly', priority: 0.8 },
    { url: at('/pricing'), changeFrequency: 'monthly', priority: 0.5 },
    { url: at('/jobs'), lastModified: dataDate, changeFrequency: 'monthly', priority: 0.8 },
    ...jobs.map((o) => ({
      url: at(`/jobs/${o.slug}`),
      lastModified: dataDate,
      changeFrequency: 'monthly' as const,
      priority: o.rank <= 150 ? 0.7 : 0.5,
    })),
  ];
}
