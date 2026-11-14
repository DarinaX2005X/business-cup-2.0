'use client';

import { useEffect, useState } from 'react';
import st from './method.module.css';

/**
 * Table of contents: sticky on the left on wide screens, a folded list on top on narrow ones.
 * The section being read is marked through IntersectionObserver (no scroll listener).
 */
export function Toc({ title, items }: { title: string; items: { id: string; label: string }[] }) {
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    const els = items.map((i) => document.getElementById(i.id)).filter((e): e is HTMLElement => !!e);
    if (!els.length || typeof IntersectionObserver === 'undefined') return;
    const visible = new Map<string, number>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) visible.set(e.target.id, e.boundingClientRect.top);
          else visible.delete(e.target.id);
        }
        const first = items.find((i) => visible.has(i.id));
        if (first) setActive(first.id);
      },
      { rootMargin: '-20% 0px -60% 0px' },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [items]);

  const list = (
    <ol className={st.tocList}>
      {items.map((i) => (
        <li key={i.id}>
          <a href={`#${i.id}`} aria-current={active === i.id ? 'location' : undefined}>
            {i.label}
          </a>
        </li>
      ))}
    </ol>
  );

  return (
    <nav className={st.toc} aria-label={title}>
      <div className={st.tocWide}>
        <p className={st.tocTitle}>{title}</p>
        {list}
      </div>
      <details className={st.tocNarrow}>
        <summary>{title}</summary>
        {list}
      </details>
    </nav>
  );
}
