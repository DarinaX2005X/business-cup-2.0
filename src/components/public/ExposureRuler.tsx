import type { CSSProperties } from 'react';
import type { Category } from '@/domain/types';
import st from './method.module.css';

export interface RulerPin {
  id: string;
  label: string;
  sub: string;
  value: number;
  category: Category;
}

/**
 * The exposure scale from 0 to 1 cut into the three category zones at the build's thresholds,
 * each zone in its Week Bar material, with real tasks pinned where they land.
 */
export function ExposureRuler({
  speeds,
  does,
  pins,
  labels,
  format,
}: {
  speeds: number;
  does: number;
  pins: RulerPin[];
  labels: { scale: string; human: string; speeds: string; does: string };
  format: (v: number) => string;
}) {
  const ticks = [0, speeds, 0.5, does, 1];
  return (
    <figure className={st.ruler} style={{ '--sp': speeds, '--dz': does } as CSSProperties}>
      <div className={st.rulerPins}>
        {pins.map((p, i) => (
          <div key={p.id} className={st.pin} data-cat={p.category} data-side={i % 2 ? 'b' : 'a'} style={{ '--x': p.value } as CSSProperties}>
            <span className={st.pinCard}>
              <b>{p.label}</b>
              <span>{p.sub}</span>
            </span>
            <span className={st.pinStem} aria-hidden="true" />
          </div>
        ))}
      </div>
      <div className={st.rulerBar} role="img" aria-label={`${labels.scale}: ${labels.human} 0–${format(speeds)}, ${labels.speeds} ${format(speeds)}–${format(does)}, ${labels.does} ${format(does)}–1`}>
        <span className={st.zHuman}>
          <em>{labels.human}</em>
        </span>
        <span className={st.zSpeeds}>
          <em>{labels.speeds}</em>
        </span>
        <span className={st.zDoes}>
          <em>{labels.does}</em>
        </span>
      </div>
      <div className={st.rulerTicks} aria-hidden="true">
        {ticks.map((t) => (
          <span key={t} style={{ '--x': t } as CSSProperties} data-key={t === speeds || t === does || undefined}>
            {format(t)}
          </span>
        ))}
      </div>
      <figcaption className={st.rulerScale}>{labels.scale}</figcaption>
    </figure>
  );
}
