import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getTitlePhrases, type TitlePhrases } from '@/server/xray/data';
import { checkResume } from '@/server/xray/resume-check';
import { analyzeResume, applyPick } from '@/server/xray/resume';
import { HttpError } from '@/server/profile/http';
import { useTempStore } from '../platform/helpers';

const sample = (name: string) => readFileSync(path.join(process.cwd(), 'src', 'content', 'samples', `resume-${name}.txt`), 'utf8');

export const MENU = `TRATTORIA DEL PONTE — DINNER MENU
Est. 1998

STARTERS
Bruschetta al pomodoro — grilled country bread, ripe tomatoes, garlic, basil, olive oil  9.50
Burrata — creamy burrata with roasted peppers and aged balsamic  14.00
Calamari fritti — lightly fried squid, lemon aioli  13.00

PASTA
Tagliatelle al ragù — slow-cooked beef and pork ragù, parmigiano  19.00
Spaghetti alle vongole — clams, white wine, chili, parsley  22.00
Ravioli di zucca — butternut squash ravioli, brown butter, sage  18.50

MAINS
Branzino — whole roasted sea bass, fennel, citrus salad  29.00
Pollo al mattone — brick-pressed chicken, rosemary potatoes  24.00
Chef's special — ask your server about tonight's dish

DESSERTS
Tiramisù  9.00 · Panna cotta with berries  8.50 · Affogato  7.00
All pasta is made fresh daily. Please tell your server about any allergies.`;

const RU_RESUME = `Иванова Анна Сергеевна
Бухгалтер
Опыт работы
Январь 2018 — настоящее время. Главный бухгалтер, торговая компания, Алматы
— Веду бухгалтерский и налоговый учёт, готовлю отчётность.
— Начисляю заработную плату, оформляю больничные и отпуска.
2014 — 2017. Бухгалтер, строительная компания
— Сверка расчётов с контрагентами, работа с первичной документацией.
Образование
Экономический университет, 2014`;

let phrases: TitlePhrases;
beforeAll(async () => {
  phrases = await getTitlePhrases();
}, 60_000);

describe('résumé heuristic before the model', () => {
  it('accepts the sample résumés and a Russian résumé', () => {
    expect(checkResume(sample('nurse'), phrases).ok).toBe(true);
    expect(checkResume(sample('electrician'), phrases).ok).toBe(true);
    expect(checkResume(RU_RESUME, phrases).ok).toBe(true);
  });

  it('rejects a restaurant menu even though it is long and mentions a chef', () => {
    const r = checkResume(MENU, phrases);
    expect(r.ok).toBe(false);
    expect(r.signals.length).toBe(true);
    expect(r.signals.dates).toBe(false);
    expect(r.signals.verbs).toBe(false);
  });

  it('rejects a bare list of job titles and a short note', () => {
    expect(checkResume('Nurse, electrician, accountant, cashier', phrases).ok).toBe(false);
    expect(checkResume('hello, please map my week', phrases).ok).toBe(false);
  });
});

describe('applyPick: codes only from the candidates', () => {
  const candidates = [
    { code: '29-1141.00', title: 'Registered Nurses' },
    { code: '29-2061.00', title: 'Licensed Practical and Licensed Vocational Nurses' },
    { code: '29-1171.00', title: 'Nurse Practitioners' },
    { code: '31-1131.00', title: 'Nursing Assistants' },
  ];

  it('keeps valid codes in the model order with their reasons', () => {
    const r = applyPick({ ranked: [{ code: '29-1141.00', reason: 'You assess patients.' }, { code: '29-2061.00', reason: 'b' }], confidence: 0.86 }, candidates);
    expect(r.ranked.map((x) => x.code)).toEqual(['29-1141.00', '29-2061.00', '29-1171.00']);
    expect(r.ranked[0].reason).toBe('You assess patients.');
    expect(r.ranked[2].reason).toBe('');
    expect(r.confidence).toBe(0.86);
  });

  it('drops invented and duplicate codes; an invented first choice caps the confidence and search order stands in', () => {
    const r = applyPick(
      { ranked: [{ code: '99-9999.00', reason: 'made up' }, { code: '29-1171.00', reason: 'np' }, { code: '29-1171.00', reason: 'dup' }], confidence: 0.95 },
      candidates,
    );
    expect(r.ranked.map((x) => x.code)).toEqual(['29-1171.00', '29-1141.00', '29-2061.00']);
    expect(r.confidence).toBeLessThanOrEqual(0.3);
  });
});

describe('analyzeResume with the model mocked', () => {
  let cleanup: () => void;
  const fetchMock = vi.fn<typeof fetch>();
  const answer = (content: unknown) =>
    new Response(JSON.stringify({ id: 'gen', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(content) } }], usage: { prompt_tokens: 100, completion_tokens: 50, cost: 0.0001 } }), { status: 200 });

  beforeEach(() => {
    ({ cleanup } = useTempStore());
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('OPENROUTER_API_KEY', 'test-key');
    vi.stubEnv('AI_BUDGET_USD', '1');
    vi.stubEnv('AI_DAILY_CAP_USD', '1');
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    fetchMock.mockReset();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('a menu in résumé mode is 422 not_a_resume without a model call', async () => {
    const err = await analyzeResume({ text: MENU, mode: 'resume', locale: 'en' }).catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect(err).toMatchObject({ status: 422, code: 'not_a_resume' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('description → candidates from search → the model can only pick among them', async () => {
    fetchMock
      .mockResolvedValueOnce(
        answer({
          isWorkText: true,
          problem: null,
          title: null,
          titleEn: 'Bookkeeper',
          altTitlesEn: ['Payroll Clerk', 'Accounting Clerk'],
          seniorityYears: null,
          industry: 'restaurants',
          duties: [
            { original: 'I keep the books for three small restaurants', en: 'Keep the books for three small restaurants' },
            { original: 'do payroll', en: 'Process payroll' },
          ],
          tools: [],
        }),
      )
      .mockResolvedValueOnce(answer({ ranked: [{ code: '43-3031.00', reason: 'You keep the books and run payroll.' }, { code: '00-0000.00', reason: 'x' }], confidence: 0.8 }));
    const res = await analyzeResume({ text: 'I keep the books for three small restaurants and do payroll', mode: 'description', locale: 'en' });
    expect(res.ranked[0]).toMatchObject({ code: '43-3031.00', title: 'Bookkeeping, Accounting, and Auditing Clerks' });
    expect(res.ranked).toHaveLength(3);
    expect(res.ranked.every((r) => r.code !== '00-0000.00')).toBe(true);
    expect(res.facts.duties).toHaveLength(2);
    // The pick prompt listed only searched candidates, the first one from the English title.
    const pickBody = JSON.parse(String(fetchMock.mock.calls[1][1]!.body));
    expect(pickBody.messages[1].content).toContain('43-3031.00 | Bookkeeping');
  });

  it('text the model says is not about work → 422 with the reason', async () => {
    fetchMock.mockResolvedValueOnce(
      answer({ isWorkText: false, problem: 'a recipe', title: null, titleEn: null, altTitlesEn: [], seniorityYears: null, industry: null, duties: [], tools: [] }),
    );
    const err = await analyzeResume({ text: 'Mix flour, eggs and milk, then fry the pancakes on both sides.', mode: 'description', locale: 'en' }).catch((e) => e);
    expect(err).toMatchObject({ status: 422, code: 'unclear_description', extra: { reason: 'not_work_text', problem: 'a recipe' } });
  });

  it('a too short description is 422 before the model', async () => {
    const err = await analyzeResume({ text: 'nurse', mode: 'description', locale: 'en' }).catch((e) => e);
    expect(err).toMatchObject({ status: 422, code: 'too_short' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
