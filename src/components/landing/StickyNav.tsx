'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * The landing header: fixed on top while the page scrolls. Over the hero it sits on the field itself;
 * once the page moves it gets its own violet bar. Its links are anchors to sections of this page, and a
 * click scrolls there smoothly (instantly with reduced motion; plain jumps without JavaScript).
 */
export function StickyNav({ className, children }: { className: string; children: ReactNode }) {
  const [scrolled, setScrolled] = useState(false);
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[href^="#"]');
      if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      const target = document.getElementById(a.hash.slice(1));
      if (!target) return;
      e.preventDefault();
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      target.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
      window.history.replaceState(window.history.state, '', a.hash);
    };
    el.addEventListener('click', onClick);
    return () => el.removeEventListener('click', onClick);
  }, []);

  return (
    <header ref={ref} className={className} data-surface="field" data-scrolled={scrolled || undefined}>
      {children}
    </header>
  );
}
