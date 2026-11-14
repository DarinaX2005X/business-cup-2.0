'use client';

/*
 * Reads a résumé file in the browser. Only the extracted text leaves the device (as the request to
 * /api/xray/resume); the file itself is never uploaded. PDF text comes from unpdf (pdf.js), page by
 * page so the screen can say which page it is on.
 */

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
/** Fewer letters than this in a whole PDF means it is a scan or an image. */
const MIN_PDF_LETTERS = 40;

export type ReadFailure = 'word' | 'too_big' | 'unsupported' | 'pdf_no_text' | 'pdf_unavailable' | 'pdf_broken' | 'empty';

export class ReadFileError extends Error {
  constructor(readonly reason: ReadFailure) {
    super(reason);
    this.name = 'ReadFileError';
  }
}

const ext = (name: string) => name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '';

function kindOf(file: File): 'pdf' | 'text' | 'word' | 'other' {
  const e = ext(file.name);
  if (file.type === 'application/pdf' || e === 'pdf') return 'pdf';
  if (['doc', 'docx', 'odt', 'pages'].includes(e) || file.type.includes('word') || file.type.includes('opendocument.text')) return 'word';
  if (file.type.startsWith('text/') || ['txt', 'md', 'markdown', 'rtf', 'csv'].includes(e)) return 'text';
  return 'other';
}

export async function readResumeFile(file: File, onProgress: (page: number, total: number) => void): Promise<string> {
  const kind = kindOf(file);
  if (kind === 'word') throw new ReadFileError('word');
  if (kind === 'other') throw new ReadFileError('unsupported');
  if (file.size > MAX_FILE_BYTES) throw new ReadFileError('too_big');

  if (kind === 'text') {
    const text = (await file.text()).replace(/\u0000/g, '');
    if (ext(file.name) === 'rtf') return stripRtf(text);
    if (!text.trim()) throw new ReadFileError('empty');
    return text;
  }

  let unpdf: typeof import('unpdf');
  try {
    unpdf = await import('unpdf');
  } catch {
    throw new ReadFileError('pdf_unavailable');
  }
  let pdf: Awaited<ReturnType<typeof unpdf.getDocumentProxy>>;
  try {
    pdf = await unpdf.getDocumentProxy(new Uint8Array(await file.arrayBuffer()));
  } catch (err) {
    // pdf.js failing to start at all is a missing capability; a parse error is a broken file
    const msg = String((err as Error)?.message ?? err);
    throw new ReadFileError(/worker|import|module|fetch/i.test(msg) ? 'pdf_unavailable' : 'pdf_broken');
  }
  const total = pdf.numPages;
  const pages: string[] = [];
  for (let n = 1; n <= total; n++) {
    onProgress(n, total);
    const page = await pdf.getPage(n);
    const content = await page.getTextContent();
    let line = '';
    const lines: string[] = [];
    for (const item of content.items as { str?: string; hasEOL?: boolean }[]) {
      if (typeof item.str !== 'string') continue;
      line += item.str;
      if (item.hasEOL) {
        lines.push(line);
        line = '';
      }
    }
    if (line) lines.push(line);
    pages.push(lines.join('\n'));
  }
  void pdf.destroy?.();
  const text = pages.join('\n\n');
  if ((text.match(/\p{L}/gu)?.length ?? 0) < MIN_PDF_LETTERS) throw new ReadFileError('pdf_no_text');
  return text;
}

function stripRtf(rtf: string): string {
  return rtf
    .replace(/\\par[d]?/g, '\n')
    .replace(/\{\\\*[^}]*\}/g, '')
    .replace(/\\'[0-9a-f]{2}/gi, '')
    .replace(/\\[a-z]+-?\d* ?/gi, '')
    .replace(/[{}]/g, '')
    .trim();
}
