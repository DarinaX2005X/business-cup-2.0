'use client';

import type { CSSProperties } from 'react';
import st from './controls.module.css';

/** A content-shaped placeholder; use only while a real load is running. */
export function Skeleton({ width = '100%', height = 16, radius = 8, style }: { width?: number | string; height?: number | string; radius?: number; style?: CSSProperties }) {
  return <span className={st.skel} aria-hidden="true" style={{ display: 'block', width, height, borderRadius: radius, ...style }} />;
}

/** Week Bar silhouette: category heads over tiles, so the real bar lands in the same place. */
export function WeekBarSkeleton({ label = 'Loading your week' }: { label?: string }) {
  const groups = [
    [14, 9],
    [16, 12],
    [23, 14, 7],
    [4],
  ];
  return (
    <div role="status" aria-label={label} style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
      {groups.map((g, gi) => {
        const total = g.reduce((a, b) => a + b, 0);
        return (
          <div key={gi} style={{ flex: `${total} 1 0`, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 18 }}>
            {gi < 3 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <Skeleton width="62%" height={40} radius={10} />
                <Skeleton width="80%" height={14} />
              </div>
            ) : null}
            <div style={{ display: 'flex', gap: 6 }}>
              {g.map((w, i) => (
                <div key={i} style={{ flex: `${w} 1 0`, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <Skeleton height={128} radius={10} />
                  <Skeleton width="50%" height={12} />
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** TaskRow silhouette. */
export function TaskRowSkeleton() {
  return (
    <div aria-hidden="true" style={{ display: 'grid', gridTemplateColumns: '44px 1fr 64px', gap: 16, alignItems: 'center', padding: '16px 0' }}>
      <Skeleton width={44} height={34} radius={7} />
      <div style={{ display: 'grid', gap: 8 }}>
        <Skeleton width="86%" height={14} />
        <Skeleton width="54%" height={14} />
      </div>
      <Skeleton width={64} height={22} radius={6} />
    </div>
  );
}
