import type { Metadata } from 'next';
import { StartFlow } from '@/components/start/StartFlow';

export const metadata: Metadata = {
  title: 'Map your week · Irreplaceable',
  description: 'Type your job title or upload your resume and see your week task by task: what AI already does, what it speeds up and what stays yours.',
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function StartPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const one = (k: string) => {
    const v = sp[k];
    return typeof v === 'string' && v.length <= 200 ? v : undefined;
  };
  return <StartFlow initial={{ step: one('step'), q: one('q'), code: one('code'), sample: one('sample'), from: one('from') }} />;
}
