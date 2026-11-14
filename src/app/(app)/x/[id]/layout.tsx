import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { readXray } from '@/server/xray/records';

/**
 * Checks that the map exists before the page's loading boundary starts streaming, so a missing map
 * answers with HTTP 404 (and the designed screen from ../not-found.tsx) instead of a 200 with a fallback.
 */
export default async function XrayLayout({ children, params }: { children: ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const x = await readXray(id).catch(() => null);
  if (!x) notFound();
  return children;
}
