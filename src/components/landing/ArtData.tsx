import type { ReactNode } from 'react';
import st from './landing.module.css';

/*
 * The three sources as objects, in the same matter as the other illustrations: a task list for
 * O*NET, a conversation for the Anthropic Economic Index (the machine bubble hatched, the person
 * apricot), a pay slip with coins for BLS. `data-part` layers move a little when the card is hovered.
 */

function Frame({ id, children }: { id: string; children: ReactNode }) {
  return (
    <svg viewBox="0 0 200 150" className={st.art} aria-hidden="true" focusable="false">
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
      <ellipse cx="100" cy="141" rx="72" ry="6" fill="var(--violet-deep)" opacity="0.14" />
      {children}
    </svg>
  );
}

/** O*NET: the list of tasks a job is made of. */
export function ArtTasks() {
  const rows: [number, 'h' | 'a'][] = [
    [62, 'h'],
    [48, 'a'],
    [70, 'a'],
    [54, 'h'],
    [64, 'a'],
  ];
  return (
    <Frame id="dt">
      <g transform="rotate(-4 100 76)">
        <g data-part="back">
          <rect x="46" y="12" width="112" height="124" rx="12" fill="var(--violet-deep)" opacity="0.16" transform="translate(3 6)" />
          <rect x="46" y="12" width="112" height="124" rx="12" fill="var(--card)" stroke="var(--line)" strokeWidth="1.5" />
          <rect x="46" y="12" width="112" height="22" rx="12" fill="url(#dtv)" />
          <rect x="46" y="24" width="112" height="10" fill="url(#dtv)" />
          <rect x="58" y="20" width="44" height="6" rx="3" fill="var(--on-violet)" opacity="0.85" />
        </g>
        <g data-part="front">
          {rows.map(([w, k], i) => (
            <g key={i}>
              <rect x="58" y={45 + i * 17} width="12" height="12" rx="4" fill={k === 'a' ? 'url(#dta)' : 'url(#dth)'} />
              <rect x="77" y={48.5 + i * 17} width={w} height="5.5" rx="2.75" fill={i === 1 ? 'var(--ink)' : 'var(--line)'} />
            </g>
          ))}
        </g>
      </g>
    </Frame>
  );
}

/** Anthropic Economic Index: real conversations in which people use AI for work. */
export function ArtUsage() {
  return (
    <Frame id="du">
      <g data-part="back">
        <path d="M84 16H160A14 14 0 0 1 174 30V66A14 14 0 0 1 160 80H150L154 96L134 80H84A14 14 0 0 1 70 66V30A14 14 0 0 1 84 16Z" fill="var(--tile-ai-face)" transform="translate(0 5)" />
        <path d="M84 16H160A14 14 0 0 1 174 30V66A14 14 0 0 1 160 80H150L154 96L134 80H84A14 14 0 0 1 70 66V30A14 14 0 0 1 84 16Z" fill="url(#duh)" />
        <rect x="86" y="34" width="72" height="7" rx="3.5" fill="var(--card)" />
        <rect x="86" y="50" width="50" height="7" rx="3.5" fill="var(--card)" />
      </g>
      <g data-part="front">
        <path d="M40 60H112A15 15 0 0 1 127 75V109A15 15 0 0 1 112 124H66L42 140L48 124H40A15 15 0 0 1 25 109V75A15 15 0 0 1 40 60Z" fill="var(--tile-hu-face)" transform="translate(0 5)" />
        <path d="M40 60H112A15 15 0 0 1 127 75V109A15 15 0 0 1 112 124H66L42 140L48 124H40A15 15 0 0 1 25 109V75A15 15 0 0 1 40 60Z" fill="url(#dua)" />
        <rect x="42" y="78" width="66" height="7" rx="3.5" fill="var(--ink)" />
        <rect x="42" y="94" width="44" height="7" rx="3.5" fill="var(--apricot-deep)" opacity="0.6" />
      </g>
    </Frame>
  );
}

/** BLS: what the job pays. */
export function ArtPay() {
  const coin = (cx: number, cy: number) => (
    <g>
      <ellipse cx={cx} cy={cy + 6} rx="26" ry="9" fill="var(--tile-hu-face)" />
      <rect x={cx - 26} y={cy} width="52" height="6" fill="var(--tile-hu-face)" />
      <ellipse cx={cx} cy={cy} rx="26" ry="9" fill="url(#dpa)" />
      <ellipse cx={cx} cy={cy} rx="17" ry="5" fill="none" stroke="var(--apricot-deep)" strokeOpacity="0.4" strokeWidth="2" />
    </g>
  );
  return (
    <Frame id="dp">
      <g transform="rotate(5 96 70)">
        <g data-part="back">
          <rect x="40" y="18" width="104" height="112" rx="12" fill="var(--violet-deep)" opacity="0.16" transform="translate(3 6)" />
          <path d="M52 18H132A12 12 0 0 1 144 30V130L134 123L124 130L114 123L104 130L94 123L84 130L74 123L64 130L54 123L40 130V30A12 12 0 0 1 52 18Z" fill="var(--card)" stroke="var(--line)" strokeWidth="1.5" />
          <rect x="54" y="34" width="46" height="7" rx="3.5" fill="var(--ink)" />
          {[54, 70, 86].map((y, i) => (
            <g key={y}>
              <rect x="54" y={y} width={[40, 52, 34][i]} height="5.5" rx="2.75" fill="var(--line)" />
              <rect x="112" y={y} width="20" height="5.5" rx="2.75" fill="var(--line)" />
            </g>
          ))}
          <path d="M54 102H132" stroke="var(--line)" strokeWidth="1.5" strokeDasharray="4 4" />
          <rect x="104" y="109" width="28" height="7" rx="3.5" fill="url(#dpv)" />
        </g>
      </g>
      <g data-part="front">
        {coin(142, 122)}
        {coin(142, 110)}
        {coin(146, 98)}
      </g>
    </Frame>
  );
}
