'use client';

import { useId } from 'react';
import st from './trophy.module.css';

const ARCH =
  'M2,49 A30 30 0 0 1 6.22,33.66 L20.36,43.2 A13 13 0 0 0 19,49ZM8.12,30.84 A30 30 0 0 1 19.2,21.87 L25.6,37.69 A13 13 0 0 0 22.27,40.38ZM44.8,21.87 A30 30 0 0 1 55.88,30.84 L41.73,40.38 A13 13 0 0 0 38.4,37.69ZM57.78,33.66 A30 30 0 0 1 62,49 L45,49 A13 13 0 0 0 43.64,43.2Z';
const KEY = 'M19.69,14 L44.31,14 L35.25,36.41 A13 13 0 0 0 28.75,36.41Z';

/**
 * The Business Cup trophy in the product's own matter: an apricot bowl (the human part) with the
 * keystone arch on its front, hatched machine-tile handles and base. One light from the top left,
 * a side shade, a rim with thickness and a contact shadow. Decorative: the text beside it says
 * what the offer is. It floats a little, and a glint crosses the bowl on hover.
 */
export function Trophy({ size = 220, className, pieces = false }: { size?: number; className?: string; pieces?: boolean }) {
  const u = useId().replace(/:/g, '');
  return (
    <span className={`${st.trophy} ${className ?? ''}`} style={{ width: size }} aria-hidden="true">
      {pieces ? (
        <>
          <i className={st.piece} data-n="1" />
          <i className={st.piece} data-n="2" />
          <i className={st.piece} data-n="3" />
          <i className={st.piece} data-n="4" />
          <i className={st.piece} data-n="5" />
        </>
      ) : null}
      <svg viewBox="0 0 240 262" className={st.svg} focusable="false">
        <defs>
          <linearGradient id={`${u}bowl`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="var(--apricot-hi)" />
            <stop offset="0.45" stopColor="var(--apricot)" />
            <stop offset="1" stopColor="var(--apricot-low)" />
          </linearGradient>
          <linearGradient id={`${u}stem`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="var(--apricot)" />
            <stop offset="1" stopColor="var(--apricot-deep)" />
          </linearGradient>
          <pattern id={`${u}hatch`} width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="7" height="7" fill="var(--machine-field)" />
            <rect width="1.8" height="7" fill="var(--machine)" />
          </pattern>
          <clipPath id={`${u}clip`}>
            <path d="M52 42H188C188 112 160 152 120 152C80 152 52 112 52 42Z" />
          </clipPath>
        </defs>

        <ellipse cx="120" cy="246" rx="86" ry="10" className={st.shadow} />

        {/* handles: machine tiles bent into arcs */}
        <g className={st.handles}>
          <path d="M60 62C14 60 16 124 76 130" fill="none" stroke="var(--tile-ai-face)" strokeWidth="17" strokeLinecap="round" transform="translate(0 3)" />
          <path d="M60 62C14 60 16 124 76 130" fill="none" stroke={`url(#${u}hatch)`} strokeWidth="17" strokeLinecap="round" />
          <path d="M180 62C226 60 224 124 164 130" fill="none" stroke="var(--tile-ai-face)" strokeWidth="17" strokeLinecap="round" transform="translate(0 3)" />
          <path d="M180 62C226 60 224 124 164 130" fill="none" stroke={`url(#${u}hatch)`} strokeWidth="17" strokeLinecap="round" />
        </g>

        {/* plinth and base */}
        <rect x="52" y="214" width="136" height="30" rx="9" fill="var(--violet-deep)" />
        <rect x="52" y="210" width="136" height="28" rx="9" fill="var(--violet-hi)" />
        <rect x="72" y="190" width="96" height="27" rx="8" fill="var(--tile-ai-face)" />
        <rect x="72" y="186" width="96" height="26" rx="8" fill={`url(#${u}hatch)`} />

        {/* stem */}
        <path d="M106 148H134L130 188H110Z" fill={`url(#${u}stem)`} />
        <ellipse cx="120" cy="166" rx="19" ry="7" fill="var(--apricot)" />
        <ellipse cx="120" cy="164.5" rx="19" ry="6" fill="var(--apricot-hi)" />

        {/* bowl */}
        <path d="M52 42H188C188 112 160 152 120 152C80 152 52 112 52 42Z" fill={`url(#${u}bowl)`} />
        <g clipPath={`url(#${u}clip)`}>
          <path d="M150 30C176 70 170 128 128 158L200 158V30Z" fill="var(--apricot-deep)" opacity="0.22" />
          <path d="M64 48C64 92 76 122 96 140" fill="none" stroke="var(--card)" strokeOpacity="0.5" strokeWidth="9" strokeLinecap="round" />
          <rect className={st.glint} x="-60" y="20" width="34" height="160" fill="var(--card)" opacity="0.45" transform="skewX(-18)" />
        </g>
        <ellipse cx="120" cy="42" rx="68" ry="12" fill="var(--apricot-hi)" />
        <ellipse cx="120" cy="43.5" rx="59" ry="8" fill="var(--apricot-deep)" opacity="0.55" />

        {/* the keystone arch on the front */}
        <g transform="translate(92 62) scale(0.875)">
          <path d={ARCH} fill="var(--violet)" />
          <path d={KEY} fill="var(--card)" />
        </g>
      </svg>
    </span>
  );
}
