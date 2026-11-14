'use client';

import type { CSSProperties } from 'react';
import type { PlanItem } from '@/server/growth/types';
import st from './plan.module.css';

/**
 * One tile per step of a week, filled apricot when it is done: the same material as the human part of
 * the Week Bar, so a week of the plan reads as a small bar that fills up as the person works.
 */
export function WeekTiles({ done, total, size = 'md', label }: { done: number; total: number; size?: 'sm' | 'md'; label?: string }) {
  return (
    <span className={st.tiles} data-size={size} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      {Array.from({ length: total }, (_, i) => (
        <i key={i} data-on={i < done || undefined} style={{ '--i': i } as CSSProperties} />
      ))}
    </span>
  );
}

/** The action with the task and skill names set on plates, so the person sees their own work named. */
export function PlanText({ item }: { item: Pick<PlanItem, 'template' | 'text' | 'taskLabel' | 'skillName'> }) {
  const parts = item.template.split(/(\{task\}|\{skill\})/g);
  if (parts.length === 1) return <>{item.text}</>;
  return (
    <>
      {parts.map((p, i) =>
        p === '{task}' && item.taskLabel ? (
          <span key={i} className={st.taskName}>
            {item.taskLabel}
          </span>
        ) : p === '{skill}' && item.skillName ? (
          <span key={i} className={st.skillName}>
            {item.skillName}
          </span>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

/** Where an action happens in the product, when it does. */
export function linkFor(item: Pick<PlanItem, 'kind' | 'template'>): { href: string; key: string } | null {
  if (item.kind === 'rep') return { href: '/today', key: 'plan.go.today' };
  if (item.kind === 'review') return { href: '/progress', key: 'plan.go.review' };
  if (item.kind === 'work') {
    if (/second look/i.test(item.template)) return { href: '/second-look', key: 'plan.go.secondLook' };
    if (/playbook/i.test(item.template)) return { href: '/playbook', key: 'plan.go.playbook' };
  }
  return null;
}
