import { describe, expect, it } from 'vitest';
import { isAppRoute, parseBlocks } from '@/components/coach/Markdown';
import { encodeWav, peaks, resample, toBase64 } from '@/components/coach/wav';
import { cleanTranscript, wavInfo } from '@/server/coach/transcribe';
import { trimHistory } from '@/server/coach/history';
import { singularTitle } from '@/server/ai/prompts/coach';
import type { CoachMessage } from '@/server/coach/types';

describe('voice WAV made in the browser', () => {
  it('encodes 16 kHz mono PCM that the server reads back with the right length', () => {
    const seconds = 2.5;
    const samples = new Float32Array(16_000 * seconds).map((_, i) => Math.sin(i / 10) * 0.5);
    const wav = encodeWav(samples, 16_000);
    const info = wavInfo(wav);
    expect(info).toEqual({ sampleRate: 16_000, channels: 1, bitsPerSample: 16, dataBytes: samples.length * 2, seconds });
    // the base64 the client sends decodes to the same bytes
    expect(Buffer.from(toBase64(wav), 'base64').equals(Buffer.from(wav))).toBe(true);
  });

  it('resamples 48 kHz to 16 kHz and keeps the duration', () => {
    const out = resample(new Float32Array(48_000).fill(0.25), 48_000, 16_000);
    expect(out.length).toBe(16_000);
    expect(out[100]).toBeCloseTo(0.25);
  });

  it('peaks are normalised loudness, loudest slice = 1', () => {
    const s = new Float32Array(2800);
    s.fill(0.1, 0, 1400);
    s.fill(0.4, 1400);
    const p = peaks(s, 28);
    expect(p).toHaveLength(28);
    expect(Math.max(...p)).toBe(1);
    expect(p[0]).toBeCloseTo(0.25, 1);
  });

  it('rejects files that are not PCM WAV', () => {
    expect(wavInfo(new Uint8Array(100))).toBeNull();
    const webm = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, ...new Array(60).fill(0)]);
    expect(wavInfo(webm)).toBeNull();
  });
});

describe('transcript cleaning', () => {
  it('turns the no-speech marker into an empty transcript', () => {
    expect(cleanTranscript('NO_SPEECH')).toBe('');
    expect(cleanTranscript(' no speech. ')).toBe('');
  });
  it('strips labels and wrapping quotes, keeps the words', () => {
    expect(cleanTranscript('Transcript: "Which task should I hand to AI first?"')).toBe('Which task should I hand to AI first?');
  });
});

describe('coach answers as Markdown', () => {
  it('links only to the app’s own routes', () => {
    expect(isAppRoute('/today')).toBe(true);
    expect(isAppRoute('/x/M9WaHl8GLiew')).toBe(true);
    expect(isAppRoute('/pivot/acute-care-nurses')).toBe(true);
    expect(isAppRoute('https://example.com')).toBe(false);
    expect(isAppRoute('//evil.com/today')).toBe(false);
    expect(isAppRoute('/x/short')).toBe(false);
    expect(isAppRoute('javascript:alert(1)')).toBe(false);
  });

  it('splits paragraphs and lists, and survives a half-arrived stream', () => {
    const blocks = parseBlocks('Start with **charting**.\n\n- Draft notes\n- Check doses\n\nThen [open Today](/today');
    expect(blocks.map((b) => b.kind)).toEqual(['p', 'ul', 'p']);
    expect(blocks[1]).toEqual({ kind: 'ul', items: ['Draft notes', 'Check doses'] });
    expect(blocks[2]).toEqual({ kind: 'p', lines: ['Then [open Today](/today'] });
  });
});

describe('history window', () => {
  const msg = (i: number): CoachMessage => ({ id: `m${i}`, role: i % 2 === 0 ? 'user' : 'coach', text: `t${i}`, at: '2026-11-15T00:00:00Z' });
  it('keeps at most 30 and never starts on an answer', () => {
    const all = Array.from({ length: 41 }, (_, i) => msg(i));
    const kept = trimHistory(all, 30);
    expect(kept.length).toBeLessThanOrEqual(30);
    expect(kept[0].role).toBe('user');
    expect(kept[kept.length - 1].id).toBe('m40');
  });
});

describe('starter question wording', () => {
  it('reads an O*NET plural title as one person', () => {
    expect(singularTitle('Acute Care Nurses')).toBe('Acute Care Nurse');
    expect(singularTitle('Nurse Practitioners')).toBe('Nurse Practitioner');
    expect(singularTitle('Software Developers')).toBe('Software Developer');
    expect(singularTitle('Secretaries')).toBe('Secretary');
    expect(singularTitle('Accountants and Auditors')).toBe('Accountants and Auditors');
  });
});

describe('coach brief: off-topic questions', () => {
  it('tells the model to decline off-topic questions in one line and offer two questions about their work', async () => {
    const { coachSystem } = await import('@/server/ai/prompts/coach');
    const { buildContext } = await import('@/server/coach/context');
    const { newProfileRecord } = await import('@/server/profile');
    const ctx = await buildContext(newProfileRecord({ id: 'p1', secretHash: 'x', locale: 'en', tz: null }));
    const system = coachSystem(ctx);
    expect(system).toMatch(/Off-topic questions/);
    expect(system).toMatch(/Decline politely in one sentence/);
    expect(system).toMatch(/exactly two example questions/);
  });
});
