'use client';

import { Fragment, type ReactNode } from 'react';
import type { Locale, RepType } from '@/domain/types';
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

/** «Registered Nurse» reads «registered nurse» inside an English sentence; acronyms stay as they are. */
export function jobInSentence(title: string | undefined, locale: Locale): string | null {
  const s = title?.trim();
  if (!s) return null;
  if (locale !== 'en') return s;
  return s
    .split(/(\s+)/)
    .map((w) => (/^[A-Z][a-z]+$/.test(w) ? w.toLowerCase() : w))
    .join('');
}

/** English needs «a» or «an» before a job title; the other locales have no articles. */
export function withArticle(job: string, locale: Locale): string {
  if (locale !== 'en') return job;
  return `${/^[aeiou]/i.test(job) && !/^(uni|eu|one|use)/i.test(job) ? 'an' : 'a'} ${job}`;
}

export const typeName = (t: TFunction, type: RepType) => t(`today.choice.${type}.name`);

/** «6 h 12 min» until the next local midnight. */
export function untilText(t: TFunction, ms: number): string {
  const min = Math.max(1, Math.ceil(ms / 60_000));
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? t('today.done.hoursMinutes', { h, m }) : t('today.done.minutesOnly', { m });
}
