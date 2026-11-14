import type { ReactNode } from 'react';
import st from './landing.module.css';

/*
 * More authored illustrations in the same matter as Art.tsx: the week as tiles under the arch, a
 * brief with a flagged trap, the two cards of «AI or me?», a coin and a voucher, a proof sheet with
 * a margin mark, the tiles of a streak. `data-part` layers move a little when their card is hovered.
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
        <linearGradient id={`${id}v`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--violet-hi)" />
          <stop offset="1" stopColor="var(--violet)" />
        </linearGradient>
      </defs>
      {children}
    </svg>
  );
}

/** A week tile with thickness: a lower face, the top, a light upper edge. */
function Tile({ x, y, w, h, kind, id, r = 9 }: { x: number; y: number; w: number; h: number; kind: 'h' | 'a'; id: string; r?: number }) {
  return (
    <g>
      <rect x={x} y={y + 7} width={w} height={h} rx={r} fill={kind === 'a' ? 'var(--tile-hu-face)' : 'var(--tile-ai-face)'} />
      <rect x={x} y={y} width={w} height={h} rx={r} fill={kind === 'a' ? `url(#${id}a)` : `url(#${id}h)`} />
      <rect x={x + 5} y={y + 3} width={w - 10} height="2.5" rx="1.25" fill="var(--card)" opacity={kind === 'a' ? 0.55 : 0.9} />
    </g>
  );
}

/** Step 2: the week laid out as tiles, the keystone arch standing over it. */
export function ArtWeek() {
  const tiles: [number, number, 'h' | 'a'][] = [
    [14, 30, 'h'],
    [48, 16, 'h'],
    [68, 36, 'a'],
    [108, 30, 'a'],
    [142, 22, 'a'],
    [168, 18, 'a'],
  ];
  return (
    <Frame id="aw2" box="0 0 200 150">
      <ellipse cx="100" cy="141" rx="92" ry="6" fill="var(--violet-deep)" opacity="0.14" />
      <g transform="translate(34 -22) scale(2.05)"><g data-part="back">
        <path d={ARCH} fill="var(--tile-ai-face)" transform="translate(0 1.6)" />
        <path d={ARCH} fill="url(#aw2h)" />
        <path d={KEY} fill="var(--tile-hu-face)" transform="translate(0 1.6)" />
        <path d={KEY} fill="url(#aw2a)" />
      </g></g>
      <g data-part="front">
        {tiles.map(([x, w, k], i) => (
          <Tile key={i} id="aw2" x={x} y={86} w={w} h={44} kind={k} />
        ))}
      </g>
    </Frame>
  );
}

/** Delegate: your brief on a clipboard, two lines for the machine and one trap flagged in apricot. */
export function ArtDelegate() {
  return (
    <Frame id="ad2" box="0 0 140 120">
      <g data-part="back">
        <rect x="26" y="20" width="84" height="96" rx="12" fill="var(--violet-deep)" opacity="0.18" transform="translate(3 5)" />
        <rect x="26" y="16" width="84" height="96" rx="12" fill="url(#ad2v)" />
        <rect x="34" y="26" width="68" height="78" rx="7" fill="var(--card)" />
        <rect x="52" y="8" width="32" height="18" rx="6" fill="var(--violet-deep)" />
        <rect x="60" y="13" width="16" height="5" rx="2.5" fill="var(--violet-tint)" />
        {[42, 62].map((y) => (
          <g key={y}>
            <rect x="42" y={y} width="13" height="13" rx="4" fill="url(#ad2h)" stroke="var(--tile-ai-face)" strokeWidth="1" />
            <rect x="61" y={y + 4} width="32" height="5" rx="2.5" fill="var(--line)" />
          </g>
        ))}
        <rect x="61" y="86" width="26" height="5" rx="2.5" fill="var(--ink)" />
      </g>
      <g data-part="front">
        <path d="M49 78L58 96H40Z" fill="var(--tile-hu-face)" stroke="var(--tile-hu-face)" strokeWidth="5" strokeLinejoin="round" transform="translate(0 2.5)" />
        <path d="M49 78L58 96H40Z" fill="url(#ad2a)" stroke="url(#ad2a)" strokeWidth="5" strokeLinejoin="round" />
        <rect x="47.4" y="82" width="3.2" height="8" rx="1.6" fill="var(--ink)" />
        <circle cx="49" cy="93.4" r="1.8" fill="var(--ink)" />
      </g>
    </Frame>
  );
}

/** AI or me: two cards to choose from, the machine one and the human one. */
export function ArtGame() {
  return (
    <Frame id="ag" box="0 0 220 150">
      <ellipse cx="110" cy="140" rx="84" ry="6" fill="var(--violet-deep)" opacity="0.14" />
      <g transform="rotate(-9 74 80)"><g data-part="back">
        <rect x="30" y="28" width="88" height="110" rx="14" fill="var(--tile-ai-face)" transform="translate(0 6)" />
        <rect x="30" y="28" width="88" height="110" rx="14" fill="url(#agh)" />
        <rect x="42" y="40" width="64" height="86" rx="8" fill="var(--card)" opacity="0.92" />
        <text x="74" y="94" textAnchor="middle" fontSize="30" fontWeight="800" fill="var(--violet)" style={{ letterSpacing: '-1px' }}>
          AI
        </text>
      </g></g>
      <g transform="rotate(8 150 78)"><g data-part="front">
        <rect x="104" y="22" width="88" height="110" rx="14" fill="var(--tile-hu-face)" transform="translate(0 6)" />
        <rect x="104" y="22" width="88" height="110" rx="14" fill="url(#aga)" />
        <rect x="110" y="26" width="76" height="3" rx="1.5" fill="var(--card)" opacity="0.55" />
        <text x="148" y="88" textAnchor="middle" fontSize="30" fontWeight="800" fill="var(--ink)" style={{ letterSpacing: '-1px' }}>
          Me
        </text>
      </g></g>
    </Frame>
  );
}

/** Points and the shop: coins and the voucher they buy. */
export function ArtShop() {
  const coin = (cx: number, cy: number, r: number) => (
    <g>
      <ellipse cx={cx} cy={cy + r * 0.2} rx={r} ry={r} fill="var(--tile-hu-face)" />
      <circle cx={cx} cy={cy} r={r} fill="url(#asha)" />
      <circle cx={cx} cy={cy} r={r * 0.68} fill="none" stroke="var(--apricot-deep)" strokeOpacity="0.45" strokeWidth={r * 0.1} />
      <g transform={`translate(${cx - r * 0.5} ${cy - r * 0.56}) scale(${r / 64})`}>
        <path d={ARCH} fill="var(--apricot-deep)" opacity="0.75" />
        <path d={KEY} fill="var(--card)" />
      </g>
      <path d={`M${cx - r * 0.62} ${cy - r * 0.42}A${r * 0.76} ${r * 0.76} 0 0 1 ${cx - r * 0.1} ${cy - r * 0.76}`} fill="none" stroke="var(--card)" strokeOpacity="0.7" strokeWidth={r * 0.1} strokeLinecap="round" />
    </g>
  );
  return (
    <Frame id="ash" box="0 0 260 150">
      <ellipse cx="140" cy="140" rx="100" ry="6" fill="var(--violet-deep)" opacity="0.14" />
      <g transform="rotate(5 160 80)"><g data-part="back">
        <rect x="84" y="32" width="150" height="92" rx="14" fill="var(--violet-deep)" opacity="0.2" transform="translate(3 6)" />
        <rect x="84" y="32" width="150" height="92" rx="14" fill="var(--card)" />
        <path d="M84 46A14 14 0 0 1 98 32H184V124H98A14 14 0 0 1 84 110Z" fill="url(#ashv)" />
        <path d="M184 36V120" stroke="var(--line)" strokeWidth="2" strokeDasharray="5 5" />
        <circle cx="184" cy="32" r="7" fill="var(--card-under, var(--paper))" />
        <circle cx="184" cy="124" r="7" fill="var(--card-under, var(--paper))" />
        <text x="100" y="84" fontSize="32" fontWeight="800" fill="var(--on-violet)" style={{ letterSpacing: '-1.5px' }}>
          Pro
        </text>
        <rect x="100" y="96" width="52" height="6" rx="3" fill="var(--on-violet-2)" opacity="0.7" />
        <rect x="196" y="58" width="26" height="6" rx="3" fill="var(--line)" />
        <rect x="196" y="72" width="18" height="6" rx="3" fill="var(--line)" />
      </g></g>
      <g data-part="front">
        {coin(58, 96, 34)}
        {coin(104, 42, 20)}
      </g>
    </Frame>
  );
}

/** Proof: a finished rep on a sheet, the editor's mark in the margin and a stamp. */
export function ArtProof() {
  return (
    <Frame id="apr" box="0 0 220 150">
      <ellipse cx="110" cy="141" rx="80" ry="6" fill="var(--violet-deep)" opacity="0.14" />
      <g transform="rotate(-5 100 80)"><g data-part="back">
        <rect x="44" y="14" width="112" height="124" rx="11" fill="var(--violet-deep)" opacity="0.16" transform="translate(3 6)" />
        <rect x="44" y="14" width="112" height="124" rx="11" fill="var(--card)" stroke="var(--line)" strokeWidth="1.5" />
        <path d="M124 14V138" stroke="var(--line)" strokeWidth="1.5" />
        {[30, 44, 72, 86, 100, 114].map((y, i) => (
          <rect key={y} x="56" y={y} width={[52, 40, 56, 44, 56, 30][i]} height="5.5" rx="2.75" fill="var(--line)" />
        ))}
        <rect x="52" y="53" width="66" height="14" rx="5" fill="var(--apricot)" opacity="0.85" />
        <rect x="56" y="57.5" width="46" height="5.5" rx="2.75" fill="var(--ink)" />
        <circle cx="140" cy="60" r="9" fill="url(#apra)" />
        <path d="M135.5 60.5L138.8 63.6L144.6 56.6" fill="none" stroke="var(--ink)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      </g></g>
      <g transform="rotate(10 168 104)"><g data-part="front">
        <circle cx="168" cy="106" r="30" fill="var(--tile-hu-face)" />
        <circle cx="168" cy="102" r="30" fill="url(#apra)" />
        <circle cx="168" cy="102" r="22" fill="none" stroke="var(--apricot-deep)" strokeOpacity="0.5" strokeWidth="2.5" strokeDasharray="3 4" />
        <g transform="translate(149 80) scale(0.6)">
          <path d={ARCH} fill="var(--apricot-deep)" opacity="0.8" />
          <path d={KEY} fill="var(--card)" />
        </g>
      </g></g>
    </Frame>
  );
}

/** A streak: the days of a week as tiles, the practised ones in apricot, today standing taller. */
export function ArtStreak() {
  const days = ['a', 'a', 'a', 'a', 'h', 'h', 'h'] as const;
  return (
    <Frame id="ast" box="0 0 220 150">
      <ellipse cx="110" cy="141" rx="96" ry="6" fill="var(--violet-deep)" opacity="0.14" />
      {days.map((k, i) => {
        const today = i === 3;
        const h = k === 'a' ? 40 + i * 12 : 34;
        const x = 12 + i * 29;
        const tile = <Tile id="ast" x={x} y={126 - h} w={24} h={h} kind={k} r={8} />;
        return today ? (
          <g key={i} data-part="front">
            {tile}
            <path d={`M${x + 12} ${126 - h - 26}l5.4 9.4 10.6 2.2-7.2 8 1.2 10.8-10-4.4-10 4.4 1.2-10.8-7.2-8 10.6-2.2z`} fill="var(--violet)" transform={`translate(${x + 12} ${126 - h - 14}) scale(0.62) translate(${-(x + 12)} ${-(126 - h - 14)})`} />
          </g>
        ) : (
          <g key={i}>{tile}</g>
        );
      })}
    </Frame>
  );
}
