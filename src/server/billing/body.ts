import type { z } from 'zod';
import { HttpError } from '@/server/profile/http';

/** Like readJson, but an empty body counts as `{}` (billing calls whose fields all have defaults). */
export async function readOptionalJson<S extends z.ZodType>(req: Request, schema: S): Promise<z.infer<S>> {
  const text = await req.text();
  let raw: unknown = {};
  if (text.trim()) {
    try {
      raw = JSON.parse(text);
    } catch {
      throw new HttpError(400, 'invalid_input', 'Request body is not valid JSON.');
    }
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new HttpError(400, 'invalid_input', parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '));
  }
  return parsed.data;
}
