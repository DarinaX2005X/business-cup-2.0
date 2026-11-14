// File I/O helpers for the data build: streaming CSV/TSV, minimal zip extraction, hashing, downloads.
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { inflateRawSync } from 'node:zlib';

/**
 * Stream a CSV file (RFC 4180 quotes, CRLF or LF) and call onRow for every record after the header.
 * `prefilter` sees the raw line text before parsing and can skip most rows of a 200 MB file cheaply;
 * it is only applied to lines without quotes spanning a newline.
 */
export async function streamCsv(
  file: string,
  onRow: (row: string[], header: string[]) => void,
  prefilter?: (line: string) => boolean,
): Promise<void> {
  let header: string[] | null = null;
  let carry = '';
  const handleLine = (line: string) => {
    if (line.endsWith('\r')) line = line.slice(0, -1);
    if (line === '') return;
    if (header === null) {
      header = parseCsvLine(line.replace(/^﻿/, ''));
      return;
    }
    if (prefilter && !prefilter(line)) return;
    onRow(parseCsvLine(line), header);
  };
  for await (const chunk of createReadStream(file, { encoding: 'utf8', highWaterMark: 1 << 20 })) {
    const text = carry + (chunk as string);
    let start = 0;
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text.charCodeAt(i);
      if (ch === 34) inQuotes = !inQuotes; // "
      else if (ch === 10 && !inQuotes) {
        handleLine(text.slice(start, i));
        start = i + 1;
      }
    }
    carry = text.slice(start);
  }
  if (carry) handleLine(carry);
}

export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let i = 0;
  const n = line.length;
  while (i <= n) {
    if (line[i] === '"') {
      let v = '';
      i++;
      while (i < n) {
        if (line[i] === '"') {
          if (line[i + 1] === '"') {
            v += '"';
            i += 2;
          } else {
            i++;
            break;
          }
        } else v += line[i++];
      }
      out.push(v);
      i++; // comma
    } else {
      const j = line.indexOf(',', i);
      const end = j < 0 ? n : j;
      out.push(line.slice(i, end));
      i = end + 1;
    }
    if (i > n) break;
  }
  return out;
}

/** O*NET text tables: tab-separated, UTF-8, CRLF, no quoting. Returns rows as objects keyed by header. */
export function readTsv(file: string): Record<string, string>[] {
  const lines = readFileSync(file, 'utf8').replace(/^﻿/, '').split(/\r?\n/);
  const header = lines[0].split('\t');
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const cells = lines[i].split('\t');
    const row: Record<string, string> = {};
    for (let k = 0; k < header.length; k++) row[header[k]] = cells[k] ?? '';
    rows.push(row);
  }
  return rows;
}

/** Extract every file of a zip archive (stored or deflate) into `outDir`. No external dependency. */
export function unzip(zipFile: string, outDir: string): string[] {
  const buf = readFileSync(zipFile);
  // End of central directory: signature 0x06054b50, searched backwards.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error(`${zipFile}: not a zip archive`);
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const written: string[] = [];
  for (let k = 0; k < count; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error(`${zipFile}: bad central directory`);
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue;
    if (name.includes('..')) throw new Error(`${zipFile}: unsafe entry ${name}`);
    const lNameLen = buf.readUInt16LE(localOffset + 26);
    const lExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    const data = buf.subarray(dataStart, dataStart + compSize);
    const content = method === 0 ? data : method === 8 ? inflateRawSync(data) : null;
    if (!content) throw new Error(`${zipFile}: unsupported compression ${method} for ${name}`);
    const target = join(outDir, name);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
    written.push(target);
  }
  return written;
}

export async function sha256File(file: string): Promise<string> {
  const h = createHash('sha256');
  for await (const chunk of createReadStream(file)) h.update(chunk as Buffer);
  return h.digest('hex');
}

export function sha256(text: string | Buffer): string {
  return createHash('sha256').update(text).digest('hex');
}

/** Download `url` to `file` (atomic rename), with a finite timeout. */
export async function download(url: string, file: string, timeoutMs = 15 * 60_000): Promise<void> {
  mkdirSync(dirname(file), { recursive: true });
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`download failed ${res.status} ${url}`);
  const tmp = `${file}.part`;
  await pipeline(Readable.fromWeb(res.body as import('node:stream/web').ReadableStream), createWriteStream(tmp));
  renameSync(tmp, file);
}

export function fileSize(file: string): number {
  return existsSync(file) ? statSync(file).size : 0;
}
