'use client';

import { useMemo, type ReactNode } from 'react';
import { parseDoc, type DocBlock, type TextPart } from '@/components/kit/repDoc';
import st from './doc.module.css';

/** A marked stretch of the source text: a caught or missed trap, or a quote the grader found in your words. */
export interface Spot {
  start: number;
  end: number;
  kind: 'caught' | 'missed' | 'quote';
  /** Small number after the stretch, matching a list beside the document. */
  n?: number;
}

/**
 * Read-only document with the kit's light markup (headings, lists, tables), for the material of a
 * Delegate case and the person's own instructions. Spots are drawn as marks in the text.
 */
export function DocText({ src, spots = [], className, plain = false }: { src: string; spots?: Spot[]; className?: string; plain?: boolean }) {
  const blocks = useMemo<DocBlock[]>(
    () =>
      plain
        ? src
            .split('\n')
            .reduce<{ out: DocBlock[]; pos: number }>(
              (acc, line) => {
                if (line.trim()) acc.out.push({ kind: 'p', part: { start: acc.pos, text: line } });
                acc.pos += line.length + 1;
                return acc;
              },
              { out: [], pos: 0 },
            ).out
        : parseDoc(src),
    [src, plain],
  );
  const sorted = useMemo(() => [...spots].sort((a, b) => a.start - b.start), [spots]);

  const part = (p: TextPart): ReactNode => {
    const end = p.start + p.text.length;
    const inside = sorted.filter((s) => s.start < end && s.end > p.start);
    if (!inside.length) return p.text;
    const out: ReactNode[] = [];
    let at = p.start;
    for (const s of inside) {
      const a = Math.max(s.start, p.start);
      const b = Math.min(s.end, end);
      if (a < at) continue;
      if (a > at) out.push(src.slice(at, a));
      out.push(
        <mark key={a} className={st.mark} data-kind={s.kind}>
          {src.slice(a, b)}
        </mark>,
      );
      if (s.n && b === s.end) out.push(<sup key={`n${a}`} className={st.n} aria-hidden="true">{s.n}</sup>);
      at = b;
    }
    if (at < end) out.push(src.slice(at, end));
    return out;
  };

  return (
    <div className={`${st.doc} ${className ?? ''}`}>
      {blocks.map((b, i) => {
        if (b.kind === 'table') {
          return (
            <div key={i} className={st.tableWrap}>
              <table className={st.table}>
                {b.head.length ? (
                  <thead>
                    <tr>
                      {b.head.map((c) => (
                        <th key={c.start} scope="col">
                          {part(c)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                ) : null}
                <tbody>
                  {b.rows.map((r, ri) => (
                    <tr key={ri}>
                      {r.map((c) => (
                        <td key={c.start}>{part(c)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        if (b.kind === 'h1') return <p key={i} className={st.h1}>{part(b.part)}</p>;
        if (b.kind === 'h2') return <p key={i} className={st.h2}>{part(b.part)}</p>;
        if (b.kind === 'li')
          return (
            <p key={i} className={st.li}>
              <span className={st.bullet} aria-hidden="true" />
              <span>{part(b.part)}</span>
            </p>
          );
        return (
          <p key={i} className={b.kind === 'sub' ? st.sub : st.p}>
            {part(b.part)}
          </p>
        );
      })}
    </div>
  );
}
