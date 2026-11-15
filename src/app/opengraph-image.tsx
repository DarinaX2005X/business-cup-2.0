import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';
import { weekView } from '@/components/landing/data';
import { groupWeek } from '@/components/kit/week';

export const alt = 'Afraid AI will replace you? Become irreplaceable. The 40-hour week of a registered nurse, task by task.';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const FIELD = '#5B45DE';
const INK = '#211A4D';
const LIGHT = '#F6F5FF';
const SOFT = '#D3CFF4';
const APRICOT = '#F5A15E';

const WEDGES =
  'M2.5,48.5 A29.5 29.5 0 0 1 4.78,37.13 L18.4,43.48 A14.5 14.5 0 0 0 17.5,48.5ZM5.79,34.96 A29.5 29.5 0 0 1 12.13,26.69 L21.79,38.2 A14.5 14.5 0 0 0 19.41,41.31ZM13.97,25.15 A29.5 29.5 0 0 1 23.21,20.34 L27.1,34.85 A14.5 14.5 0 0 0 23.63,36.66ZM40.79,20.34 A29.5 29.5 0 0 1 50.03,25.15 L40.37,36.66 A14.5 14.5 0 0 0 36.9,34.85ZM51.87,26.69 A29.5 29.5 0 0 1 58.21,34.96 L44.59,41.31 A14.5 14.5 0 0 0 42.21,38.2ZM59.22,37.13 A29.5 29.5 0 0 1 61.5,48.5 L46.5,48.5 A14.5 14.5 0 0 0 45.6,43.48Z';
const KEYSTONE = 'M24.13,14.5 L39.87,14.5 L34.58,34.23 A14.5 14.5 0 0 0 29.42,34.23Z';

const LABEL = { ai_does: 'AI already does it', ai_speeds: 'AI speeds it up', human_edge: 'Your human edge', no_data: 'No data yet' } as const;

/**
 * The share image: the headline and the sample nurse week from the landing fixtures (the same data
 * as the page), drawn as the Week Bar with its patterns, so the preview explains the product by itself.
 */
export default async function Image() {
  const [bold, medium] = await Promise.all([
    readFile(join(process.cwd(), 'public/fonts/Onest-Bold.ttf')),
    readFile(join(process.cwd(), 'public/fonts/Onest-Medium.ttf')),
  ]);
  const view = weekView('en');
  const groups = groupWeek(view.tasks);
  const W = 1104;
  const GAP = 6;
  const count = groups.reduce((n, g) => n + g.tasks.length, 0);
  const unit = (W - GAP * (count - 1)) / 100;
  let x = 0;
  const heads: { x: number; hours: number; label: string; human: boolean }[] = [];
  const rects: { x: number; w: number; cat: string }[] = [];
  for (const g of groups) {
    heads.push({ x, hours: g.hours, label: LABEL[g.category], human: g.category === 'human_edge' });
    for (const t of g.tasks) {
      const w = t.share * unit;
      rects.push({ x, w, cat: t.category });
      x += w + GAP;
    }
  }

  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: FIELD, color: LIGHT, fontFamily: 'Onest', padding: '44px 48px 40px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 30, fontWeight: 700, letterSpacing: -1 }}>
          <svg width="54" height="40" viewBox="0 10 64 44">
            <path d={WEDGES} fill="#D8D5FF" />
            <path d={KEYSTONE} fill={APRICOT} />
          </svg>
          Irreplaceable
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', marginTop: 30, fontSize: 64, fontWeight: 700, letterSpacing: -2.6, lineHeight: 1.08 }}>
          <div style={{ display: 'flex' }}>Afraid AI will replace you?</div>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            Become
            <span style={{ display: 'flex', margin: '0 0 0 14px', padding: '0 14px 4px', background: APRICOT, color: INK, borderRadius: 12 }}>irreplaceable</span>
            .
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', marginTop: 'auto' }}>
          <div style={{ display: 'flex', position: 'relative', height: 92, width: W }}>
            {heads.map((h) => (
              <div key={h.label} style={{ position: 'absolute', left: h.x, top: 0, display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontSize: 44, fontWeight: 700, letterSpacing: -1.5, lineHeight: 1, color: h.human ? '#FCC58E' : LIGHT }}>{`${h.hours} h`}</span>
                <span style={{ fontSize: 22, fontWeight: 500, color: SOFT }}>{h.label}</span>
              </div>
            ))}
          </div>
          <svg width={W} height={112} viewBox={`0 0 ${W} 112`}>
            <defs>
              <pattern id="dense" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width="9" height="9" fill="#E7E6F6" />
                <rect width="2.4" height="9" fill="#908EB0" />
              </pattern>
              <pattern id="sparse" width="18" height="18" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width="18" height="18" fill="#FBE5D2" />
                <rect width="2.4" height="18" fill="#908EB0" />
              </pattern>
              <linearGradient id="human" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#FCC58E" />
                <stop offset="0.45" stopColor="#F5A15E" />
                <stop offset="1" stopColor="#E8894A" />
              </linearGradient>
            </defs>
            {rects.map((r, i) => (
              <g key={i}>
                <rect x={r.x} y={8} width={r.w} height={104} rx={12} fill={r.cat === 'human_edge' ? '#C96A2C' : '#B9B6D8'} />
                <rect
                  x={r.x}
                  y={0}
                  width={r.w}
                  height={102}
                  rx={12}
                  fill={r.cat === 'human_edge' ? 'url(#human)' : r.cat === 'ai_does' ? 'url(#dense)' : r.cat === 'ai_speeds' ? 'url(#sparse)' : FIELD}
                  stroke={r.cat === 'no_data' ? SOFT : 'none'}
                  strokeDasharray="6 6"
                  strokeWidth={2}
                />
              </g>
            ))}
          </svg>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16, fontSize: 20, fontWeight: 500, color: SOFT }}>
            <span>The 40-hour week of a registered nurse, task by task</span>
            <span>Real usage data · O*NET tasks</span>
          </div>
        </div>
      </div>
    ),
    { ...size, fonts: [{ name: 'Onest', data: bold, weight: 700, style: 'normal' }, { name: 'Onest', data: medium, weight: 500, style: 'normal' }] },
  );
}
