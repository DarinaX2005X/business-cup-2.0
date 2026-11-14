'use client';

import { Fragment, type ReactNode } from 'react';
import type { RepType } from '@/domain/types';
import type { TFunction, TParams } from '@/i18n/core';

/** A translated sentence with React nodes in place of `{name}` slots (plates, links). */
export function rich(t: TFunction, key: string, nodes: Record<string, ReactNode>, params?: TParams): ReactNode[] {
  const text = t(key, params);
  return text.split(/(\{\w+\})/).map((part, i) => {
    const name = /^\{(\w+)\}$/.exec(part)?.[1];
    if (name && name in nodes) return <Fragment key={i}>{nodes[name]}</Fragment>;
    return part ? <Fragment key={i}>{part}</Fragment> : null;
  });
}

/*
 * Job titles, document types and task names are never put inside a sentence: they are shown on their
 * own (a plate, a label line), so every sentence reads right for any title in every language.
 */

export const typeName = (t: TFunction, type: RepType) => t(`today.choice.${type}.name`);

/** «6 h 12 min» until the next local midnight. */
export function untilText(t: TFunction, ms: number): string {
  const min = Math.max(1, Math.ceil(ms / 60_000));
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? t('today.done.hoursMinutes', { h, m }) : t('today.done.minutesOnly', { m });
}
