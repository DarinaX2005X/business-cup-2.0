import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';
import { CATEGORIES, type Category, type Locale } from '@/domain/types';
import { getT } from '@/i18n/server';
import { isLocale } from '@/i18n/config';
import { loadBundle } from '@/server/xray/data';
import { isXrayId, viewXray } from '@/server/xray/records';
import { cardDomain, CARD_SIZE } from '../meta';

export const runtime = 'nodejs';

/*
 * GET /api/og/score?x=<xrayId>[&l=en|ru|kk][&download=1]: the share card of a week map, 1200×630 PNG.
 * The same violet field as the map's conclusion block: the job title, the week as the Week Bar with its
 * materials (hatched machine tiles, solid apricot human tiles with a lit top edge), the three category hours
 * and the score in a circle. Only what a guest of the map may see: no name, pay or résumé text.
 * Satori has no SVG <pattern> in HTML, so hatching is repeating-linear-gradient on blocks.
 * Cached for an hour per map version (`v` in the URL changes with `updatedAt`, see ../meta.ts).
 */

const fonts = Promise.all([
  readFile(join(process.cwd(), 'public/fonts/Onest-Bold.ttf')),
  readFile(join(process.cwd(), 'public/fonts/Onest-Medium.ttf')),
]);

const C = {
  field: '#5B45DE',
  ink: '#211A4D',
  light: '#F6F5FF',
  soft: '#D3CFF4',
  apricot: '#F5A15E',
  apricotHi: '#FCC58E',
  apricotLow: '#E8894A',
  apricotFace: '#B9622A',
  machine: '#908EB0',
  machineField: '#E7E6F6',
  speedField: '#FBE5D2',
  face: '#3E2FA8',
};

const W = 1104; // inner width (1200 − 2 × 48)
const GAP = 7;
const BAR_H = 150;
const FACE = 9;

const hatch = (pitch: number) => `repeating-linear-gradient(135deg, ${C.machine} 0px, ${C.machine} 2.6px, transparent 2.6px, transparent ${pitch}px)`;

/** The front face of a tile (and the swatch next to each number). */
function front(cat: Category): Record<string, string> {
  if (cat === 'ai_does') return { backgroundColor: C.machineField, backgroundImage: hatch(9) };
  if (cat === 'ai_speeds') return { backgroundColor: C.speedField, backgroundImage: hatch(18) };
  if (cat === 'human_edge') return { backgroundImage: `linear-gradient(180deg, #FFE3C4 0px, ${C.apricotHi} 5px, ${C.apricot} 48%, ${C.apricotLow} 100%)` };
  return { border: `2.5px dashed ${C.soft}` };
}

const faceColor = (cat: Category) => (cat === 'human_edge' ? C.apricotFace : cat === 'no_data' ? 'transparent' : C.face);

const MARK =
  'M2.5,48.5 A29.5 29.5 0 0 1 4.78,37.13 L18.4,43.48 A14.5 14.5 0 0 0 17.5,48.5ZM5.79,34.96 A29.5 29.5 0 0 1 12.13,26.69 L21.79,38.2 A14.5 14.5 0 0 0 19.41,41.31ZM13.97,25.15 A29.5 29.5 0 0 1 23.21,20.34 L27.1,34.85 A14.5 14.5 0 0 0 23.63,36.66ZM40.79,20.34 A29.5 29.5 0 0 1 50.03,25.15 L40.37,36.66 A14.5 14.5 0 0 0 36.9,34.85ZM51.87,26.69 A29.5 29.5 0 0 1 58.21,34.96 L44.59,41.31 A14.5 14.5 0 0 0 42.21,38.2ZM59.22,37.13 A29.5 29.5 0 0 1 61.5,48.5 L46.5,48.5 A14.5 14.5 0 0 0 45.6,43.48Z';
const KEYSTONE = 'M24.13,14.5 L39.87,14.5 L34.58,34.23 A14.5 14.5 0 0 0 29.42,34.23Z';

/** Long titles get a smaller size, and anything past two lines is cut with an ellipsis. */
function titleFit(raw: string): { text: string; size: number } {
  const text = raw.replace(/\s+/g, ' ').trim();
  const cut = text.length > 84 ? `${text.slice(0, 82).replace(/\s+\S*$/, '')}…` : text;
  return { text: cut, size: cut.length > 52 ? 52 : 64 };
}

function notFound() {
  return new Response('Week map not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get('x');
  if (!isXrayId(id)) return notFound();
  const view = await viewXray(id, null).catch(() => null);
  if (!view) return notFound();
  const { xray } = view;
  const bundle = await loadBundle(xray.occupationCode);
  if (!bundle) return notFound();

  const lang = url.searchParams.get('l');
  const locale: Locale = isLocale(lang) ? lang : xray.locale;
  const etag = `W/"${xray.id}-${xray.version}-${xray.updatedAt}-${locale}"`;
  const cache = 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400';
  if (req.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers: { ETag: etag, 'Cache-Control': cache } });

  const t = getT(locale);
  const hoursText = (h: number) => t('pivot.og.hours', { hours: t.f.number(h, { maximumFractionDigits: 1 }) });

  // Tiles: one per task, grouped by category in the reading order, largest first inside a group.
  const byId = new Map(bundle.tasks.map((task) => [task.id, task]));
  const tiles = CATEGORIES.flatMap((cat) =>
    xray.shares
      .filter((s) => byId.get(s.taskId)?.evidence.category === cat)
      .sort((a, b) => b.share - a.share)
      .map((s) => ({ cat, share: s.share })),
  );
  const total = tiles.reduce((n, x) => n + x.share, 0) || 100;
  const unit = (W - GAP * Math.max(0, tiles.length - 1)) / total;

  const title = titleFit(xray.jobTitle);
  const [bold, medium] = await fonts;

  const image = new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: C.field, color: C.light, fontFamily: 'Onest', padding: '40px 48px 36px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 26, fontWeight: 700, letterSpacing: -0.8 }}>
          <svg width="44" height="31" viewBox="0 10 64 44">
            <path d={MARK} fill="#D8D5FF" />
            <path d={KEYSTONE} fill={C.apricot} />
          </svg>
          Irreplaceable
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 18, gap: 40 }}>
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
            <div style={{ display: 'flex', fontSize: title.size, fontWeight: 700, letterSpacing: title.size * -0.035, lineHeight: 1.04, maxWidth: 860 }}>{title.text}</div>
            <div style={{ display: 'flex', marginTop: 12, fontSize: 24, fontWeight: 500, color: C.soft }}>{t('pivot.og.week')}</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 176 }}>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                width: 138,
                height: 138,
                borderRadius: 69,
                backgroundImage: `linear-gradient(180deg, ${C.apricotHi}, ${C.apricot} 55%, ${C.apricotLow})`,
                boxShadow: `0 7px 0 ${C.apricotFace}`,
                color: C.ink,
              }}
            >
              <span style={{ fontSize: 60, fontWeight: 700, letterSpacing: -2.5, lineHeight: 1 }}>{t.f.number(xray.score)}</span>
              <span style={{ fontSize: 17, fontWeight: 500, marginTop: 2 }}>{t('pivot.og.outOf')}</span>
            </div>
            <span style={{ display: 'flex', marginTop: 14, fontSize: 18, fontWeight: 500, color: C.soft, textAlign: 'center' }}>{t('pivot.og.score')}</span>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', marginTop: 'auto' }}>
          <div style={{ display: 'flex', width: W, height: BAR_H + FACE, gap: GAP }}>
            {tiles.map((tile, i) => (
              <div key={i} style={{ display: 'flex', position: 'relative', width: tile.share * unit, height: BAR_H + FACE }}>
                <div style={{ position: 'absolute', left: 0, top: FACE, width: '100%', height: BAR_H, borderRadius: 14, backgroundColor: faceColor(tile.cat) }} />
                <div style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: BAR_H, borderRadius: 14, ...front(tile.cat) }} />
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', marginTop: 26, gap: 32 }}>
            {(['ai_does', 'ai_speeds', 'human_edge'] as const).map((cat) => (
              <div key={cat} style={{ display: 'flex', alignItems: 'center', gap: 16, flex: 1 }}>
                <div style={{ display: 'flex', width: 34, height: 34, borderRadius: 9, flexShrink: 0, boxShadow: `0 4px 0 ${faceColor(cat)}`, ...front(cat) }} />
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontSize: 44, fontWeight: 700, letterSpacing: -1.6, lineHeight: 1, color: cat === 'human_edge' ? C.apricotHi : C.light }}>{hoursText(xray.hours[cat])}</span>
                  <span style={{ fontSize: 21, fontWeight: 500, color: C.soft, marginTop: 4 }}>{t(`pivot.og.cat.${cat}`)}</span>
                </div>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', marginTop: 24, fontSize: 22, fontWeight: 500, color: C.soft }}>
            <span style={{ color: C.light, fontWeight: 700 }}>{t('pivot.og.cta')}</span>
            <span style={{ margin: '0 10px' }}>·</span>
            <span>{cardDomain(url)}</span>
          </div>
        </div>
      </div>
    ),
    {
      ...CARD_SIZE,
      fonts: [
        { name: 'Onest', data: bold, weight: 700, style: 'normal' },
        { name: 'Onest', data: medium, weight: 500, style: 'normal' },
      ],
    },
  );

  const headers = new Headers(image.headers);
  headers.set('Cache-Control', cache);
  headers.set('ETag', etag);
  if (url.searchParams.get('download') === '1') {
    headers.set('Content-Disposition', `attachment; filename="week-map-${bundle.slug}.png"`);
  }
  return new Response(image.body, { status: 200, headers });
}
