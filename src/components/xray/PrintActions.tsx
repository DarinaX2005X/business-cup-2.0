'use client';

import { ArrowLeft, Download } from 'lucide-react';
import Link from 'next/link';
import { useEffect } from 'react';
import btn from '@/components/kit/controls.module.css';
import st from './report.module.css';

/** «Save as PDF» and the way back; opened from the map with `?print=1`, it asks to print once. */
export function PrintActions({ id, autoPrint, printLabel, backLabel }: { id: string; autoPrint: boolean; printLabel: string; backLabel: string }) {
  useEffect(() => {
    if (!autoPrint) return;
    const timer = window.setTimeout(() => window.print(), 400);
    return () => window.clearTimeout(timer);
  }, [autoPrint]);
  return (
    <div className={st.actions}>
      <Link href={`/x/${id}`} className={`${btn.btn} ${btn.b_quiet} ${btn.s_sm}`}>
        <ArrowLeft size={18} strokeWidth={1.75} aria-hidden="true" />
        {backLabel}
      </Link>
      <button type="button" className={`${btn.btn} ${btn.b_primary} ${btn.s_sm}`} onClick={() => window.print()}>
        <Download size={18} strokeWidth={1.75} aria-hidden="true" />
        {printLabel}
      </button>
    </div>
  );
}
