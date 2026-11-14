import Link from 'next/link';
import type { ReactNode } from 'react';
import st from './coach.module.css';

/**
 * The small Markdown the coach writes: paragraphs, bullet and numbered lists, **bold** and links. Built
 * as React elements (no HTML injection), safe on a half-arrived stream: an unclosed `**` or link simply
 * shows as text until the rest arrives. Only links to the app's own routes become links.
 */

const ROUTE = /^\/(today|progress|shop|playbook|second-look|pivot|method|pricing|start|home|cup|coach|leaderboard)(\/[a-z0-9-]{1,120})?([?#][\w=&#-]*)?$|^\/x\/[0-9A-Za-z]{12}(\/[a-z-]+)?([?#][\w=&#-]*)?$/;

export const isAppRoute = (href: string) => ROUTE.test(href);

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|\[([^\]]{1,120})\]\(([^)\s]{1,200})\)/g;
  let pos = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > pos) out.push(text.slice(pos, m.index));
    if (m[1] !== undefined) out.push(<strong key={`${key}b${i}`}>{m[1]}</strong>);
    else if (isAppRoute(m[3])) {
      out.push(
        <Link key={`${key}l${i}`} href={m[3]} className={st.mdLink}>
          {m[2]}
        </Link>,
      );
    } else out.push(m[2]);
    pos = m.index + m[0].length;
    i++;
  }
  if (pos < text.length) out.push(text.slice(pos));
  return out;
}

type Block = { kind: 'p'; lines: string[] } | { kind: 'ul' | 'ol'; items: string[] };

export function parseBlocks(src: string): Block[] {
  const blocks: Block[] = [];
  for (const raw of src.replace(/\r/g, '').split('\n')) {
    const line = raw.trimEnd();
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d{1,2}[.)]\s+(.*)$/.exec(line);
    const last = blocks[blocks.length - 1];
    if (!line.trim()) {
      blocks.push({ kind: 'p', lines: [] });
      continue;
    }
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      const kind = bullet ? 'ul' : 'ol';
      const text = (bullet ?? numbered)![1];
      if (last && last.kind === kind) last.items.push(text);
      else blocks.push({ kind, items: [text] });
      continue;
    }
    const text = heading ? `**${heading[1]}**` : line.trim();
    if (last && last.kind === 'p') last.lines.push(text);
    else if (last && (last.kind === 'ul' || last.kind === 'ol') && /^\s{2,}/.test(raw)) last.items[last.items.length - 1] += ` ${text}`;
    else blocks.push({ kind: 'p', lines: [text] });
  }
  return blocks.filter((b) => (b.kind === 'p' ? b.lines.length > 0 : b.items.length > 0));
}

export function Markdown({ text, caret = false }: { text: string; caret?: boolean }) {
  const blocks = parseBlocks(text);
  return (
    <div className={st.md}>
      {blocks.map((b, i) => {
        const tail = caret && i === blocks.length - 1 ? <span className={st.caret} aria-hidden="true" /> : null;
        if (b.kind === 'p') {
          return (
            <p key={i}>
              {inline(b.lines.join(' '), `p${i}`)}
              {tail}
            </p>
          );
        }
        const List = b.kind;
        return (
          <List key={i}>
            {b.items.map((it, j) => (
              <li key={j}>
                {inline(it, `l${i}-${j}`)}
                {j === b.items.length - 1 ? tail : null}
              </li>
            ))}
          </List>
        );
      })}
      {caret && !blocks.length ? <span className={st.caret} aria-hidden="true" /> : null}
    </div>
  );
}
