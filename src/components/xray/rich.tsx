import { Fragment, type ReactNode } from 'react';
import type { TFunction, TParams } from '@/i18n/core';

/**
 * A translated sentence with some placeholders rendered as elements, in whatever order the language puts
 * them: `rich(t, 'xray.week.pay', { atStake: <b>…</b>, annual: <b>…</b> })`. Plain params are formatted by
 * `t` as usual; the element placeholders are left in the string by `t` and swapped here.
 */
export function rich(t: TFunction, key: string, nodes: Record<string, ReactNode>, params?: TParams): ReactNode[] {
  const text = t(key, params);
  return text.split(/(\{\w+\})/).map((part, i) => {
    const name = /^\{(\w+)\}$/.exec(part)?.[1];
    return name && name in nodes ? <Fragment key={i}>{nodes[name]}</Fragment> : part ? <Fragment key={i}>{part}</Fragment> : null;
  });
}
