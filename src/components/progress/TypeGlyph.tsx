import type { RepType } from '@/domain/types';
import st from './progress.module.css';

/**
 * The three kinds of rep as tiny objects from the product's paper world, lit from the top left:
 * Spot the slip is a sheet with one line under the apricot marker, Delegate is a sheet whose lower half
 * is the machine's hatched draft, Human edge is two speech bubbles with yours in apricot.
 */
export function TypeGlyph({ type, size = 40 }: { type: RepType; size?: number }) {
  return (
    <svg className={st.glyph} width={size} height={size} viewBox="0 0 40 40" aria-hidden="true" data-type={type}>
      <rect x="3" y="3" width="34" height="34" rx="10" className={st.glyphBg} />
      {type === 'edge' ? (
        <>
          <path d="M9 11.5h15a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3h-9l-4 3.5v-3.5h-2a3 3 0 0 1-3-3v-6a3 3 0 0 1 3-3z" className={st.glyphSheet} />
          <path d="M9.5 16.5h12M9.5 19.5h8" className={st.glyphLine} />
          <path d="M17 20.5h13a3 3 0 0 1 3 3v5a3 3 0 0 1-3 3h-1v3l-3.5-3H17a3 3 0 0 1-3-3v-5a3 3 0 0 1 3-3z" className={st.glyphWarm} />
          <path d="M17.5 21.2h12" className={st.glyphHi} />
        </>
      ) : (
        <>
          <rect x="11" y="8.5" width="18" height="24" rx="2.5" className={st.glyphShadow} />
          <rect x="10.5" y="7" width="19" height="24.5" rx="2.5" className={st.glyphSheet} />
          {type === 'slip' ? (
            <>
              <path d="M14 12.5h12M14 16h10" className={st.glyphLine} />
              <rect x="13" y="18" width="14" height="4.2" rx="1.6" className={st.glyphMarker} />
              <path d="M14 20.1h12M14 25.5h9" className={st.glyphLine} />
            </>
          ) : (
            <>
              <path d="M14 12h12M14 15.5h8" className={st.glyphLine} />
              <rect x="13.2" y="19" width="13.6" height="9.5" rx="1.5" className={st.glyphHatch} />
            </>
          )}
        </>
      )}
    </svg>
  );
}
