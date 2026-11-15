import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Report } from '@/components/xray/Report';
import { getT } from '@/i18n/server';
import { readPlanForReport } from '@/server/growth';
import { getProfileFromCookies } from '@/server/profile/ssr';
import { loadBundle } from '@/server/xray/data';
import { readXray, viewXray } from '@/server/xray/records';
import { getTaskTexts } from '@/server/xray/tips';

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const t = getT('en');
  const x = await readXray(id).catch(() => null);
  return {
    title: x ? `${x.jobTitle}: ${t('xray.report.kicker')}` : t('xray.notFound.title'),
    robots: { index: false, follow: false },
  };
}

/** /x/[id]/report: the week map as a print-ready A4 page («Download PDF» prints it). */
export default async function ReportPage({ params, searchParams }: Props) {
  const [{ id }, sp, viewer] = await Promise.all([params, searchParams, getProfileFromCookies()]);
  const view = await viewXray(id, viewer);
  if (!view) notFound();
  const bundle = await loadBundle(view.xray.occupationCode);
  if (!bundle) notFound();
  const texts = await getTaskTexts(bundle.code, 'en');
  const shorts: Record<string, string> = {};
  if (texts?.ready) for (const [tid, v] of Object.entries(texts.tasks)) shorts[tid] = v.short;
  const plan = viewer ? await readPlanForReport(viewer, id).catch(() => null) : null;
  return (
    <Report
      id={id}
      jobTitle={view.xray.jobTitle}
      occupationTitle={bundle.title}
      result={view.xray}
      bundle={bundle}
      shorts={shorts}
      autoPrint={sp.print === '1'}
      plan={plan}
    />
  );
}
