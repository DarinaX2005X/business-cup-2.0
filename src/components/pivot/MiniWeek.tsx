import type { CSSProperties } from 'react';
import { CATEGORY_ORDER } from '@/components/kit/week';
import type { WeekTiles } from './types';
import st from './pivot.module.css';

/**
 * A small Week Bar: one thick tile per task, grouped in the reading order (AI already does it, AI speeds
 * it up, human edge, no data), largest first inside a group. Same materials as the kit bar, no labels:
 * the numbers sit in the text next to it, and the whole bar is one image with a spoken summary.
 */
export function MiniWeek({ tiles, label, surface = 'paper', size = 'md' }: { tiles: WeekTiles; label: string; surface?: 'paper' | 'violet'; size?: 'md' | 'lg' }) {
  const ordered = CATEGORY_ORDER.flatMap((c) => tiles.filter((x) => x.category === c).sort((a, b) => b.share - a.share));
  return (
    <div className={st.mini} data-surface={surface} data-size={size} role="img" aria-label={label}>
      {ordered.map((x, i) => (
        <span key={i} className={st.miniTile} data-cat={x.category} style={{ '--w': x.share, '--i': i } as CSSProperties} />
      ))}
    </div>
  );
}
