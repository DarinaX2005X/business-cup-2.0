'use client';

import { useEffect, useRef } from 'react';
import { archStones } from './arch';
import st from './landing.module.css';

const STONES = archStones(720, 1240, 1150, 955, 11, 0.9);
const KEY = (STONES.length - 1) / 2;
const TILES = [1, 2, 3, 4, 5, 6, 7];

/**
 * Behind the hero: the top of a very large keystone arch one step darker than the field, cropped
 * by the edges, and a few hatched week tiles (one of them the solid human one) that drift slowly.
 * Decorative only. Layers shift a little with the pointer on fine pointers and with scroll where
 * CSS scroll timelines exist; with reduced motion everything rests in place.
 */
export function HeroBackdrop() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fine = window.matchMedia('(hover: hover) and (pointer: fine)');
    const still = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (!fine.matches || still.matches) return;
    let frame = 0;
    let x = 0;
    let y = 0;
    const apply = () => {
      frame = 0;
      el.style.setProperty('--px', x.toFixed(3));
      el.style.setProperty('--py', y.toFixed(3));
    };
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      if (r.bottom < 0) return;
      x = (e.clientX / window.innerWidth) * 2 - 1;
      y = (e.clientY / window.innerHeight) * 2 - 1;
      if (!frame) frame = requestAnimationFrame(apply);
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div ref={ref} className={st.backdrop} aria-hidden="true">
      <div className={st.archLayer}>
        <svg className={st.arch} viewBox="0 0 1440 900" preserveAspectRatio="xMidYMin slice" focusable="false">
          <defs>
            <pattern id="lp-hatch" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="14" height="14" fill="none" />
              <rect width="3" height="14" className={st.archHatch} />
            </pattern>
          </defs>
          {STONES.map((d, i) => (
            <g key={i}>
              <path d={d} className={i === KEY ? st.archKey : st.archStone} />
              {i === KEY ? null : <path d={d} fill="url(#lp-hatch)" />}
            </g>
          ))}
        </svg>
      </div>
      {TILES.map((n) => (
        <span key={n} className={st.tile} data-n={n}>
          <i />
        </span>
      ))}
    </div>
  );
}
