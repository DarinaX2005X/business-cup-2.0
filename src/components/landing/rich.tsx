import { Fragment, type ReactNode } from 'react';

/** A translated sentence with React nodes in place of `{name}` slots. */
export function fill(text: string, nodes: Record<string, ReactNode>): ReactNode[] {
  return text.split(/(\{\w+\})/).map((part, i) => {
    const name = /^\{(\w+)\}$/.exec(part)?.[1];
    if (name && name in nodes) return <Fragment key={i}>{nodes[name]}</Fragment>;
    return part ? <Fragment key={i}>{part}</Fragment> : null;
  });
}
