'use client';

import { useId } from 'react';

/*
 * Authored art from the product's world. One light from the top left on every piece.
 * SheetStack: three work sheets, the top one drafted by AI (hatched edge, AI stamp),
 * one line under an apricot marker, and the marker pen that made it.
 */
export function SheetStack({ className, title }: { className?: string; title?: string }) {
  const u = useId().replace(/:/g, '');
  const i = (n: string) => `${u}${n}`;
  return (
    <svg viewBox="0 0 520 360" className={className} role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      <defs>
        <linearGradient id={i('p1')} x1="0" y1="0" x2=".9" y2="1">
          <stop offset="0" stopColor="#FFFFFF" />
          <stop offset=".55" stopColor="#F8F6FF" />
          <stop offset="1" stopColor="#E8E3FA" />
        </linearGradient>
        <linearGradient id={i('p2')} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#F1EEFD" />
          <stop offset="1" stopColor="#D9D2F5" />
        </linearGradient>
        <linearGradient id={i('p3')} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#E4DFFA" />
          <stop offset="1" stopColor="#C7BEEE" />
        </linearGradient>
        <linearGradient id={i('fold')} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FFFFFF" />
          <stop offset="1" stopColor="#D6CFF3" />
        </linearGradient>
        <linearGradient id={i('pen')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#6E5BE6" />
          <stop offset=".35" stopColor="#4A35C2" />
          <stop offset="1" stopColor="#2E1F86" />
        </linearGradient>
        <linearGradient id={i('cap')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFD3A8" />
          <stop offset=".4" stopColor="#F5A563" />
          <stop offset="1" stopColor="#D9793A" />
        </linearGradient>
        <linearGradient id={i('tip')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#F7B57A" />
          <stop offset="1" stopColor="#C9692C" />
        </linearGradient>
        <pattern id={i('hatch')} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="5" height="5" fill="#ECE8FB" />
          <rect width="1.4" height="5" fill="#9E95C8" />
        </pattern>
        <filter id={i('soft')} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="12" />
        </filter>
        <filter id={i('tight')} x="-10%" y="-10%" width="120%" height="120%">
          <feGaussianBlur stdDeviation="2" />
        </filter>
        <clipPath id={i('top')}>
          <path d="M12 0H238Q250 0 250 12V286L214 322H12Q0 322 0 310V12Q0 0 12 0Z" />
        </clipPath>
      </defs>
      <g transform="translate(150 56) rotate(-11 125 160)">
        <rect x="10" y="22" width="250" height="322" rx="12" fill="#1E1160" opacity=".35" filter={`url(#${i('soft')})`} />
        <rect width="250" height="322" rx="12" fill={`url(#${i('p3')})`} />
        <rect x="26" y="36" width="96" height="9" rx="4.5" fill="#B4A9E6" />
      </g>
      <g transform="translate(178 40) rotate(6 125 160)">
        <rect x="10" y="22" width="250" height="322" rx="12" fill="#1E1160" opacity=".35" filter={`url(#${i('soft')})`} />
        <rect x="1" y="2" width="250" height="322" rx="12" fill="#1E1160" opacity=".25" filter={`url(#${i('tight')})`} />
        <rect width="250" height="322" rx="12" fill={`url(#${i('p2')})`} />
        <rect x="26" y="34" width="110" height="10" rx="5" fill="#A99EE0" />
        <rect x="26" y="62" width="190" height="6" rx="3" fill="#C9C1EE" />
        <rect x="26" y="80" width="170" height="6" rx="3" fill="#C9C1EE" />
      </g>
      <g transform="translate(118 30) rotate(-3 125 160)">
        <path d="M24 30H262Q274 30 274 42V316L238 352H24Q12 352 12 340V42Q12 30 24 30Z" fill="#1A0E58" opacity=".42" filter={`url(#${i('soft')})`} />
        <path d="M13 3H239Q251 3 251 15V289L215 325H13Q1 325 1 313V15Q1 3 13 3Z" fill="#1A0E58" opacity=".3" filter={`url(#${i('tight')})`} />
        <g clipPath={`url(#${i('top')})`}>
          <rect width="250" height="322" fill={`url(#${i('p1')})`} />
          <rect width="250" height="14" fill={`url(#${i('hatch')})`} />
          <rect y="14" width="250" height="1" fill="#D7D0F2" />
          <rect x="26" y="38" width="118" height="11" rx="5.5" fill="#2B2168" />
          <rect x="26" y="58" width="74" height="7" rx="3.5" fill="#BDB4E6" />
          <rect x="26" y="82" width="198" height="1.2" fill="#E0DAF5" />
          <rect x="26" y="100" width="188" height="7" rx="3.5" fill="#CEC7EE" />
          <rect x="26" y="120" width="170" height="7" rx="3.5" fill="#CEC7EE" />
          <rect x="26" y="140" width="194" height="7" rx="3.5" fill="#CEC7EE" />
          <path d="M19 164.5 C 70 161, 150 165.5, 212 162" stroke="#F4A766" strokeWidth="18" strokeLinecap="round" fill="none" opacity=".9" />
          <path d="M22 158.5 C 80 156, 150 159.5, 206 157" stroke="#FFD8B0" strokeWidth="2.5" strokeLinecap="round" fill="none" opacity=".7" />
          <rect x="26" y="160" width="182" height="7" rx="3.5" fill="#3E3290" />
          <rect x="26" y="180" width="160" height="7" rx="3.5" fill="#CEC7EE" />
          <rect x="26" y="200" width="186" height="7" rx="3.5" fill="#CEC7EE" />
          <rect x="26" y="220" width="120" height="7" rx="3.5" fill="#CEC7EE" />
          <rect x="26" y="248" width="196" height="7" rx="3.5" fill="#CEC7EE" />
          <rect x="26" y="268" width="150" height="7" rx="3.5" fill="#CEC7EE" />
        </g>
        <g transform="translate(174 32) rotate(9)">
          <rect width="54" height="32" rx="7" fill={`url(#${i('hatch')})`} stroke="#8C82BE" strokeWidth="1.6" />
          <text x="27" y="22" textAnchor="middle" fontFamily="var(--font-onest), Onest, sans-serif" fontWeight="800" fontSize="16" fill="#3E3290" stroke="#F6F4FF" strokeWidth="4" paintOrder="stroke">
            AI
          </text>
        </g>
        <path d="M250 286L214 322L219 292Q220 288 224 287Z" fill="#1A0E58" opacity=".18" filter={`url(#${i('tight')})`} />
        <path d="M250 286L214 322L218 291Q219 287 223 286Z" fill={`url(#${i('fold')})`} />
        <path d="M1 300V15Q1 3 13 3H238" stroke="#FFFFFF" strokeWidth="1.5" fill="none" opacity=".9" />
      </g>
      <g transform="translate(336 214) rotate(38)">
        <rect x="6" y="20" width="176" height="30" rx="15" fill="#140A48" opacity=".45" filter={`url(#${i('soft')})`} />
        <path d="M0 12 L20 6 L20 26 L0 20 Z" fill={`url(#${i('tip')})`} />
        <rect x="18" y="1" width="18" height="30" rx="3" fill="#2A1C7C" />
        <rect x="32" y="0" width="112" height="32" rx="9" fill={`url(#${i('pen')})`} />
        <rect x="38" y="5" width="98" height="3.5" rx="1.75" fill="#FFFFFF" opacity=".28" />
        <rect x="132" y="-2" width="44" height="36" rx="10" fill={`url(#${i('cap')})`} />
        <rect x="138" y="3" width="32" height="3.5" rx="1.75" fill="#FFFFFF" opacity=".55" />
        <rect x="150" y="30" width="22" height="7" rx="3" fill="#D9793A" />
      </g>
    </svg>
  );
}

/** Large arch outlines a step darker than the field, cropped by the block's edges. */
export function FieldArches({ className }: { className?: string }) {
  const u = useId().replace(/:/g, '');
  const wedges =
    'M2.5,48.5 A29.5 29.5 0 0 1 4.78,37.13 L18.4,43.48 A14.5 14.5 0 0 0 17.5,48.5ZM5.79,34.96 A29.5 29.5 0 0 1 12.13,26.69 L21.79,38.2 A14.5 14.5 0 0 0 19.41,41.31ZM13.97,25.15 A29.5 29.5 0 0 1 23.21,20.34 L27.1,34.85 A14.5 14.5 0 0 0 23.63,36.66ZM40.79,20.34 A29.5 29.5 0 0 1 50.03,25.15 L40.37,36.66 A14.5 14.5 0 0 0 36.9,34.85ZM51.87,26.69 A29.5 29.5 0 0 1 58.21,34.96 L44.59,41.31 A14.5 14.5 0 0 0 42.21,38.2ZM59.22,37.13 A29.5 29.5 0 0 1 61.5,48.5 L46.5,48.5 A14.5 14.5 0 0 0 45.6,43.48Z M24.13,14.5 L39.87,14.5 L34.58,34.23 A14.5 14.5 0 0 0 29.42,34.23Z';
  return (
    <svg className={className} viewBox="0 0 1200 700" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <symbol id={`${u}a`} viewBox="0 0 64 64">
          <path d={wedges} fill="var(--field-shade)" />
        </symbol>
      </defs>
      <use href={`#${u}a`} x="700" y="-120" width="900" height="900" />
      <use href={`#${u}a`} x="-260" y="380" width="620" height="620" />
    </svg>
  );
}
