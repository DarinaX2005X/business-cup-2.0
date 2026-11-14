import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PlanPrintSectionFor } from '@/components/plan/PlanPrintSection';
import { PlanProgress } from '@/components/plan/PlanProgress';
import { PlanView } from '@/components/plan/PlanView';
import { SkillsView } from '@/components/skills/SkillsView';

export const metadata: Metadata = { title: 'Growth views', robots: { index: false, follow: false } };

type Search = Promise<{ [key: string]: string | string[] | undefined }>;

/**
 * Development only: the growth views on one page for the visitor's own map (`?x=<xrayId>`, `&v=skills|plan|progress|print`),
 * until the map's Skills and Plan tabs mount them. Everything loads live from the API with the visitor's profile.
 */
export default async function GrowthDevPage({ searchParams }: { searchParams: Search }) {
  if (process.env.NODE_ENV === 'production') notFound();
  const sp = await searchParams;
  const x = typeof sp.x === 'string' && /^[0-9A-Za-z]{12}$/.test(sp.x) ? sp.x : null;
  const v = typeof sp.v === 'string' ? sp.v : 'skills';
  if (!x) return <main style={{ padding: 32 }}>Add ?x=&lt;your xray id&gt;&amp;v=skills|plan|progress|print</main>;
  return (
    <main style={{ maxWidth: 1240, margin: '0 auto', padding: '40px 16px 120px' }}>
      {v === 'plan' ? <PlanView xrayId={x} /> : v === 'progress' ? <div style={{ maxWidth: 420 }}><PlanProgress xrayId={x} /></div> : v === 'print' ? <PlanPrintSectionFor xrayId={x} /> : <SkillsView xrayId={x} />}
    </main>
  );
}
