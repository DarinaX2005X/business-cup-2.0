import { isSampleName, readSample } from '@/content/samples';
import { HttpError, withApi } from '@/server/profile/http';

/** GET /api/xray/sample?name=nurse|electrician → { name, text, sample: true } (fictional sample résumé). */
export const GET = withApi(async (req: Request) => {
  const name = new URL(req.url).searchParams.get('name');
  if (!isSampleName(name)) throw new HttpError(404, 'not_found', 'Unknown sample.');
  const text = await readSample(name);
  return Response.json({ name, text, sample: true }, { headers: { 'Cache-Control': 'public, max-age=3600' } });
});
