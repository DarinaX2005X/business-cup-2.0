'use client';

import { useId } from 'react';

/*
 * Authored art for Home's banners, in the same family as the kit's SheetStack: one light from the top
 * left, paper with a white top edge, a tight contact shadow and a soft wide one in deep violet, hatch for
 * the machine part and apricot for the person.
 */

const ink = '#1A0E58';

function Shadows({ i }: { i: (n: string) => string }) {
  return (
    <>
      <filter id={i('soft')} x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="11" />
      </filter>
      <filter id={i('tight')} x="-10%" y="-10%" width="120%" height="120%">
        <feGaussianBlur stdDeviation="2" />
      </filter>
    </>
  );
}

/** AI or me: two cards, the machine's hatched one and the person's apricot one. */
export function ChoiceCards({ className }: { className?: string }) {
  const u = useId().replace(/:/g, '');
  const i = (n: string) => `${u}${n}`;
  return (
    <svg viewBox="0 0 380 280" overflow="visible" className={className} aria-hidden="true">
      <defs>
        <Shadows i={i} />
        <pattern id={i('hatch')} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="6" height="6" fill="#EEEAFC" />
          <rect width="1.5" height="6" fill="#A39AD0" />
        </pattern>
        <linearGradient id={i('paper')} x1="0" y1="0" x2=".8" y2="1">
          <stop offset="0" stopColor="#FFFFFF" />
          <stop offset="1" stopColor="#E7E2FA" />
        </linearGradient>
        <linearGradient id={i('apricot')} x1="0" y1="0" x2=".7" y2="1">
          <stop offset="0" stopColor="#FFE0BF" />
          <stop offset=".5" stopColor="#F8B477" />
          <stop offset="1" stopColor="#E58A47" />
        </linearGradient>
      </defs>
      {/* the machine's card */}
      <g transform="translate(46 54) rotate(-9 80 100)">
        <rect x="8" y="22" width="160" height="200" rx="18" fill={ink} opacity=".38" filter={`url(#${i('soft')})`} />
        <rect x="1" y="2" width="160" height="200" rx="18" fill={ink} opacity=".25" filter={`url(#${i('tight')})`} />
        <rect width="160" height="200" rx="18" fill={`url(#${i('paper')})`} />
        <rect x="12" y="12" width="136" height="96" rx="12" fill={`url(#${i('hatch')})`} />
        <rect x="52" y="44" width="56" height="34" rx="9" fill="#F6F4FF" stroke="#8C82BE" strokeWidth="1.6" />
        <text x="80" y="68" textAnchor="middle" fontFamily="var(--font-onest), Onest, sans-serif" fontWeight="800" fontSize="18" fill="#3E3290">
          AI
        </text>
        <rect x="16" y="128" width="112" height="8" rx="4" fill="#CEC7EE" />
        <rect x="16" y="146" width="128" height="8" rx="4" fill="#DCD6F3" />
        <rect x="16" y="164" width="84" height="8" rx="4" fill="#DCD6F3" />
        <path d="M1 186V17Q1 2 17 2H144" stroke="#FFFFFF" strokeWidth="1.5" fill="none" opacity=".9" />
      </g>
      {/* the person's card, lying on top */}
      <g transform="translate(176 40) rotate(8 80 100)">
        <rect x="8" y="22" width="160" height="200" rx="18" fill={ink} opacity=".4" filter={`url(#${i('soft')})`} />
        <rect x="1" y="2" width="160" height="200" rx="18" fill="#7A3A12" opacity=".3" filter={`url(#${i('tight')})`} />
        <rect width="160" height="200" rx="18" fill={`url(#${i('apricot')})`} />
        <rect x="12" y="12" width="136" height="96" rx="12" fill="#FFFFFF" opacity=".28" />
        <text x="80" y="72" textAnchor="middle" fontFamily="var(--font-onest), Onest, sans-serif" fontWeight="800" fontSize="30" fill="#7A3A12">
          Me
        </text>
        <rect x="16" y="128" width="104" height="8" rx="4" fill="#FFFFFF" opacity=".55" />
        <rect x="16" y="146" width="126" height="8" rx="4" fill="#FFFFFF" opacity=".42" />
        <rect x="16" y="164" width="72" height="8" rx="4" fill="#FFFFFF" opacity=".42" />
        <path d="M1 186V17Q1 2 17 2H144" stroke="#FFF3E6" strokeWidth="1.6" fill="none" opacity=".95" />
      </g>
    </svg>
  );
}

/** Coach: the coach's paper note and the person's apricot voice message under it. */
export function CoachBubbles({ className }: { className?: string }) {
  const u = useId().replace(/:/g, '');
  const i = (n: string) => `${u}${n}`;
  const bars = [10, 18, 28, 16, 34, 24, 12, 30, 20, 14, 26, 10, 18];
  return (
    <svg viewBox="0 0 320 230" overflow="visible" className={className} aria-hidden="true">
      <defs>
        <Shadows i={i} />
        <linearGradient id={i('paper')} x1="0" y1="0" x2=".8" y2="1">
          <stop offset="0" stopColor="#FFFFFF" />
          <stop offset="1" stopColor="#E9E4FB" />
        </linearGradient>
        <linearGradient id={i('apricot')} x1="0" y1="0" x2=".6" y2="1">
          <stop offset="0" stopColor="#FFDDB9" />
          <stop offset=".55" stopColor="#F7AF6F" />
          <stop offset="1" stopColor="#E48945" />
        </linearGradient>
      </defs>
      <g transform="translate(18 18) rotate(-4 110 60)">
        <path d="M20 8h184q16 0 16 16v76q0 16-16 16H52l-26 22 4-22h-10q-16 0-16-16V24q0-16 16-16Z" fill={ink} opacity=".34" filter={`url(#${i('soft')})`} transform="translate(6 16)" />
        <path d="M20 0h184q16 0 16 16v76q0 16-16 16H52l-26 22 4-22h-10q-16 0-16-16V16q0-16 16-16Z" fill={`url(#${i('paper')})`} />
        <rect x="22" y="22" width="92" height="9" rx="4.5" fill="#2B2168" />
        <rect x="22" y="44" width="170" height="7" rx="3.5" fill="#CEC7EE" />
        <rect x="22" y="60" width="148" height="7" rx="3.5" fill="#CEC7EE" />
        <path d="M18 66C70 63 128 67 168 64" stroke="#F4A766" strokeWidth="14" strokeLinecap="round" fill="none" opacity=".55" />
        <rect x="22" y="76" width="120" height="7" rx="3.5" fill="#CEC7EE" />
        <path d="M5 92V16Q5 1 20 1H204" stroke="#FFFFFF" strokeWidth="1.5" fill="none" opacity=".9" />
      </g>
      <g transform="translate(96 140) rotate(3 100 30)">
        <rect x="6" y="14" width="200" height="60" rx="30" fill={ink} opacity=".36" filter={`url(#${i('soft')})`} />
        <rect x="1" y="2" width="200" height="60" rx="30" fill="#7A3A12" opacity=".28" filter={`url(#${i('tight')})`} />
        <rect width="200" height="60" rx="30" fill={`url(#${i('apricot')})`} />
        <circle cx="30" cy="30" r="17" fill="#FFF6EC" />
        <path d="M25 22.5v15l12-7.5Z" fill="#B85E22" />
        {bars.map((h, n) => (
          <rect key={n} x={58 + n * 10} y={30 - h / 2} width="5" height={h} rx="2.5" fill="#7A3A12" opacity=".5" />
        ))}
        <path d="M12 46V30Q12 1 40 1H170" stroke="#FFF3E6" strokeWidth="1.5" fill="none" opacity=".8" />
      </g>
    </svg>
  );
}

/** Map your week: a week bar on its card, hatched where AI works and apricot where the person does, with a scan passing over it. */
export function WeekCard({ className, beamClassName }: { className?: string; beamClassName?: string }) {
  const u = useId().replace(/:/g, '');
  const i = (n: string) => `${u}${n}`;
  return (
    <svg viewBox="0 0 420 260" overflow="visible" className={className} aria-hidden="true">
      <defs>
        <Shadows i={i} />
        <linearGradient id={i('paper')} x1="0" y1="0" x2=".8" y2="1">
          <stop offset="0" stopColor="#FFFFFF" />
          <stop offset="1" stopColor="#E8E3FA" />
        </linearGradient>
        <pattern id={i('dense')} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="6" height="6" fill="#ECE8FB" />
          <rect width="1.5" height="6" fill="#9E95C8" />
        </pattern>
        <pattern id={i('sparse')} width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="12" height="12" fill="#FBEBDC" />
          <rect width="1.5" height="12" fill="#C9A98C" />
        </pattern>
        <linearGradient id={i('hu')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFD9B2" />
          <stop offset=".45" stopColor="#F6AE6E" />
          <stop offset="1" stopColor="#E3874A" />
        </linearGradient>
        <linearGradient id={i('beam')} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#6E5BE6" stopOpacity="0" />
          <stop offset=".5" stopColor="#6E5BE6" stopOpacity=".35" />
          <stop offset="1" stopColor="#6E5BE6" stopOpacity="0" />
        </linearGradient>
        <clipPath id={i('bar')}>
          <rect x="30" y="70" width="320" height="64" rx="12" />
        </clipPath>
      </defs>
      <g transform="translate(20 20) rotate(-3 190 110)">
        <rect x="8" y="24" width="380" height="200" rx="22" fill={ink} opacity=".36" filter={`url(#${i('soft')})`} />
        <rect x="1" y="2" width="380" height="200" rx="22" fill={ink} opacity=".22" filter={`url(#${i('tight')})`} />
        <rect width="380" height="200" rx="22" fill={`url(#${i('paper')})`} />
        <rect x="30" y="30" width="130" height="11" rx="5.5" fill="#2B2168" />
        <g clipPath={`url(#${i('bar')})`}>
          <rect x="30" y="70" width="120" height="64" fill={`url(#${i('dense')})`} />
          <rect x="152" y="70" width="86" height="64" fill={`url(#${i('sparse')})`} />
          <rect x="240" y="70" width="110" height="64" fill={`url(#${i('hu')})`} />
          <rect x="240" y="70" width="110" height="2" fill="#FFF1E2" opacity=".9" />
          <rect className={beamClassName} x="0" y="64" width="70" height="76" fill={`url(#${i('beam')})`} />
        </g>
        <rect x="30" y="148" width="54" height="7" rx="3.5" fill="#BDB4E6" />
        <rect x="152" y="148" width="44" height="7" rx="3.5" fill="#D9C3AE" />
        <rect x="240" y="148" width="64" height="7" rx="3.5" fill="#E9B98E" />
        <rect x="30" y="166" width="34" height="7" rx="3.5" fill="#DCD6F3" />
        <rect x="152" y="166" width="30" height="7" rx="3.5" fill="#EBDDD0" />
        <rect x="240" y="166" width="40" height="7" rx="3.5" fill="#F2D7BE" />
        <path d="M1 186V18Q1 2 18 2H362" stroke="#FFFFFF" strokeWidth="1.5" fill="none" opacity=".9" />
      </g>
    </svg>
  );
}
