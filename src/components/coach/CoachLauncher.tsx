'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { KeystoneMark } from '@/components/kit/Mark';
import { useT } from '@/i18n/client';
import st from './launcher.module.css';

/**
 * «Ask your coach» for the app shell: a small paper chip with the keystone, the coach's mark. `compact`
 * shows the mark alone (narrow headers) with the label kept for screen readers and as a tooltip.
 * Free and Pro land on the coach page's preview; Coach lands in the conversation.
 */
export function CoachLauncher({ compact = false, className }: { compact?: boolean; className?: string }) {
  const { t } = useT();
  const pathname = usePathname();
  const here = pathname?.startsWith('/coach') ?? false;
  const label = t('coach.launcher.label');
  return (
    <Link
      href="/coach"
      className={`${st.launcher} ${className ?? ''}`}
      data-compact={compact || undefined}
      aria-current={here ? 'page' : undefined}
      aria-label={compact ? label : undefined}
      title={compact ? label : undefined}
    >
      <span className={st.mark} aria-hidden="true">
        <KeystoneMark size={20} tone="paper" />
      </span>
      {compact ? null : <span className={st.text}>{label}</span>}
    </Link>
  );
}
