import type { ReactNode } from 'react';
import st from './landing.module.css';

/*
 * Authored illustrations of the landing, all in the product's matter: hatching is the machine part,
 * apricot is the human part, paper sheets are work documents, the arch is the mark. One light from
 * the top left: a light upper edge, a darker lower face, a soft contact shadow. Decorative, the
 * text next to each one carries the meaning.
 */

const ARCH =
  'M2,49 A30 30 0 0 1 6.22,33.66 L20.36,43.2 A13 13 0 0 0 19,49ZM8.12,30.84 A30 30 0 0 1 19.2,21.87 L25.6,37.69 A13 13 0 0 0 22.27,40.38ZM44.8,21.87 A30 30 0 0 1 55.88,30.84 L41.73,40.38 A13 13 0 0 0 38.4,37.69ZM57.78,33.66 A30 30 0 0 1 62,49 L45,49 A13 13 0 0 0 43.64,43.2Z';
const KEY = 'M19.69,14 L44.31,14 L35.25,36.41 A13 13 0 0 0 28.75,36.41Z';

function Frame({ id, box, children }: { id: string; box: string; children: ReactNode }) {
  return (
    <svg viewBox={box} className={st.art} aria-hidden="true" focusable="false">
      <defs>
        <pattern id={`${id}h`} width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="7" height="7" fill="var(--machine-field)" />
          <rect width="1.8" height="7" fill="var(--machine)" />
        </pattern>
        <linearGradient id={`${id}a`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--apricot-hi)" />
          <stop offset="0.5" stopColor="var(--apricot)" />
          <stop offset="1" stopColor="var(--apricot-low)" />
        </linearGradient>
      </defs>
      {children}
    </svg>
  );
}

const sheet = (x: number, y: number, w: number, h: number, lines: number[]) => (
  <>
    <rect x={x + 2} y={y + 5} width={w} height={h} rx="9" fill="var(--violet-deep)" opacity="0.16" />
    <rect x={x} y={y} width={w} height={h} rx="9" fill="var(--card)" stroke="var(--line)" strokeWidth="1.5" />
    {lines.map((lw, i) => (
      <rect key={i} x={x + 12} y={y + 16 + i * 13} width={lw} height="5" rx="2.5" fill="var(--line)" />
    ))}
  </>
);

/** Step 1: a resume sheet and the name badge of a job. */
export function ArtJob() {
  return (
    <Frame id="aj" box="0 0 200 150">
      <ellipse cx="100" cy="138" rx="70" ry="7" fill="var(--violet-deep)" opacity="0.14" />
      <g transform="rotate(-7 80 70)"><g data-part="back">
        {sheet(38, 14, 92, 112, [50, 68, 60, 68, 40, 62])}
      </g></g>
      <g data-part="front">
        <rect x="88" y="60" width="92" height="66" rx="13" fill="var(--tile-hu-face)" />
        <rect x="88" y="55" width="92" height="66" rx="13" fill="url(#aja)" />
        <rect x="88" y="55" width="92" height="3" rx="1.5" fill="var(--card)" opacity="0.5" />
        <rect x="124" y="46" width="20" height="16" rx="5" fill="var(--violet)" />
        <circle cx="112" cy="84" r="11" fill="var(--card)" />
        <rect x="130" y="76" width="38" height="6" rx="3" fill="var(--ink)" />
        <rect x="130" y="88" width="26" height="5" rx="2.5" fill="var(--apricot-deep)" opacity="0.7" />
        <rect x="100" y="104" width="68" height="5" rx="2.5" fill="var(--apricot-deep)" opacity="0.45" />
      </g>
    </Frame>
  );
}

/** Step 2: the week as tiles under the keystone arch. */
export function ArtWeek() {
  const tiles: [number, number, 'h' | 'a'][] = [
    [22, 34, 'h'],
    [60, 18, 'h'],
    [82, 30, 'a'],
    [116, 24, 'a'],
    [144, 34, 'a'],
  ];
  return (
    <Frame id="aw" box="0 0 200 150">
      <ellipse cx="100" cy="138" rx="84" ry="7" fill="var(--violet-deep)" opacity="0.14" />
      <g transform="translate(42 -16) scale(1.8)"><g data-part="back">
        <path d={ARCH} fill="url(#awh)" stroke="var(--tile-ai-face)" strokeWidth="1" />
        <path d={KEY} fill="url(#awa)" />
      </g></g>
      <g data-part="front">
        {tiles.map(([x, w, k], i) => (
          <g key={i}>
            <rect x={x} y={90} width={w} height={40} rx="8" fill={k === 'a' ? 'var(--tile-hu-face)' : 'var(--tile-ai-face)'} />
            <rect x={x} y={84} width={w} height={40} rx="8" fill={k === 'a' ? 'url(#awa)' : 'url(#awh)'} />
          </g>
        ))}
      </g>
    </Frame>
  );
}

/** Step 3: ten minutes on a timer, the tenth marked in apricot. */
export function ArtTimer() {
  return (
    <Frame id="at" box="0 0 200 150">
      <ellipse cx="100" cy="140" rx="56" ry="6" fill="var(--violet-deep)" opacity="0.14" />
      <g data-part="back">
        <rect x="90" y="8" width="20" height="16" rx="5" fill="var(--violet)" />
        <rect x="138" y="26" width="16" height="12" rx="4" fill="var(--violet-hi)" transform="rotate(40 146 32)" />
      </g>
      <g data-part="front">
        <circle cx="100" cy="82" r="56" fill="var(--tile-ai-face)" />
        <circle cx="100" cy="78" r="56" fill="url(#ath)" />
        <circle cx="100" cy="78" r="43" fill="var(--card)" />
        <path d="M100 35A43 43 0 0 1 137.2 56.5L100 78Z" fill="url(#ata)" />
        <circle cx="100" cy="78" r="26" fill="var(--card)" />
        <text x="100" y="88" textAnchor="middle" fontSize="28" fontWeight="800" fill="var(--ink)" style={{ letterSpacing: '-1.5px' }}>
          10
        </text>
      </g>
    </Frame>
  );
}

/** Spot the slip: one line of a sheet under the apricot marker, a lens over it. */
export function ArtSlip() {
  return (
    <Frame id="as" box="0 0 140 120">
      <g data-part="back">{sheet(18, 10, 84, 100, [44, 60, 52, 60, 36])}</g>
      <rect x="26" y="47" width="68" height="15" rx="5" fill="var(--apricot)" opacity="0.85" />
      <rect x="30" y="52" width="52" height="5" rx="2.5" fill="var(--ink)" />
      <g data-part="front">
        <path d="M104 86L124 106" stroke="var(--violet-deep)" strokeWidth="9" strokeLinecap="round" />
        <circle cx="92" cy="74" r="22" fill="var(--card)" fillOpacity="0.55" stroke="var(--violet)" strokeWidth="7" />
        <path d="M80 66A14 14 0 0 1 92 60" fill="none" stroke="var(--card)" strokeWidth="3.5" strokeLinecap="round" />
      </g>
    </Frame>
  );
}

/** Delegate: you (apricot) hand a brief to the machine tile. */
export function ArtDelegate() {
  return (
    <Frame id="ad" box="0 0 140 120">
      <rect x="84" y="36" width="46" height="56" rx="12" fill="var(--tile-ai-face)" />
      <rect x="84" y="30" width="46" height="56" rx="12" fill="url(#adh)" />
      <circle cx="30" cy="62" r="22" fill="var(--tile-hu-face)" />
      <circle cx="30" cy="58" r="22" fill="url(#ada)" />
      <path d="M17 52A14 14 0 0 1 30 43" fill="none" stroke="var(--card)" strokeOpacity="0.6" strokeWidth="3.5" strokeLinecap="round" />
      <g transform="rotate(8 70 58)"><g data-part="front">
        <rect x="50" y="40" width="42" height="46" rx="7" fill="var(--violet-deep)" opacity="0.16" transform="translate(2 4)" />
        <rect x="50" y="40" width="42" height="46" rx="7" fill="var(--card)" stroke="var(--line)" strokeWidth="1.5" />
        <rect x="58" y="50" width="26" height="4.5" rx="2.25" fill="var(--ink)" />
        <rect x="58" y="60" width="20" height="4.5" rx="2.25" fill="var(--line)" />
        <rect x="58" y="70" width="24" height="4.5" rx="2.25" fill="var(--line)" />
      </g></g>
    </Frame>
  );
}

/** Human edge: a person speaks (apricot), the machine bubble stays behind. */
export function ArtEdge() {
  return (
    <Frame id="ae" box="0 0 140 120">
      <g data-part="back">
        <path d="M62 14H118A12 12 0 0 1 130 26V58A12 12 0 0 1 118 70H112L116 84L98 70H62A12 12 0 0 1 50 58V26A12 12 0 0 1 62 14Z" fill="url(#aeh)" stroke="var(--tile-ai-face)" strokeWidth="1.5" />
      </g>
      <g data-part="front">
        <path d="M24 44H82A13 13 0 0 1 95 57V87A13 13 0 0 1 82 100H44L24 114L30 100H24A13 13 0 0 1 11 87V57A13 13 0 0 1 24 44Z" fill="var(--tile-hu-face)" transform="translate(0 4)" />
        <path d="M24 44H82A13 13 0 0 1 95 57V87A13 13 0 0 1 82 100H44L24 114L30 100H24A13 13 0 0 1 11 87V57A13 13 0 0 1 24 44Z" fill="url(#aea)" />
        <rect x="26" y="60" width="54" height="6" rx="3" fill="var(--ink)" />
        <rect x="26" y="74" width="36" height="6" rx="3" fill="var(--apricot-deep)" opacity="0.6" />
      </g>
    </Frame>
  );
}
