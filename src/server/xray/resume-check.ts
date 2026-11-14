import { normTitle } from '@/domain/text';
import type { TitlePhrases } from './data';

/**
 * Cheap check before spending a model call on "résumé" mode (02.1.2): a résumé shows at least two of
 * dates/years, known job titles, action verbs or résumé sections, and length over 300 characters.
 * Length and job titles alone are not enough (a restaurant menu is long and can mention a chef),
 * so at least one of dates or verbs/sections must be present too.
 */

export interface ResumeSignals {
  dates: boolean;
  titles: boolean;
  verbs: boolean;
  length: boolean;
}

export interface ResumeCheck {
  ok: boolean;
  signals: ResumeSignals;
}

export const MIN_RESUME_LENGTH = 300;

const YEAR_RE = /(?<!\d)(19[5-9]\d|20[0-4]\d)(?!\d)/g;
const RANGE_RE = /(?<!\d)(19[5-9]\d|20[0-4]\d)\s*(?:[-–—]|to|по|до)\s*(?:(?:19[5-9]\d|20[0-4]\d)|present|current|now|today|настоящее|н\.?\s?в\.?|қазір|бүгін)/i;
const MONTH_YEAR_RE =
  /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(?:19|20)\d{2}\b|(?:январ|феврал|март|апрел|ма[йя]|июн|июл|август|сентябр|октябр|ноябр|декабр|қаңтар|ақпан|наурыз|сәуір|мамыр|маусым|шілде|тамыз|қыркүйек|қазан|қараша|желтоқсан)[а-яәіңғүұқөһ]*\s+(?:19|20)\d{2}/i;
const EXPERIENCE_RE =
  /\d+\+?\s*(?:years?|yrs)\s+(?:of\s+)?(?:experience|as|in)\b|(?:опыт|стаж)[^.\n]{0,40}?\d+\s*(?:лет|года|год)|\d+\s*(?:лет|года|год)\s+(?:опыта|стажа)|\d+\s*жыл/i;

const VERB_STEMS = [
  // English
  'manag', 'led', 'lead', 'develop', 'coordinat', 'administer', 'assess', 'implement', 'maintain', 'supervis', 'train',
  'install', 'repair', 'design', 'organiz', 'organis', 'monitor', 'analyz', 'analys', 'reconcil', 'deliver', 'provid',
  'conduct', 'perform', 'handl', 'oversaw', 'oversee', 'improv', 'reduc', 'negotiat', 'document', 'collaborat',
  'responsib', 'ensur', 'achiev', 'launch', 'taught', 'teach', 'advis', 'inspect', 'diagnos', 'operat', 'schedul',
  'resolv', 'support', 'educat', 'troubleshoot', 'evaluat', 'mentor', 'review', 'draft', 'audit', 'record',
  // Russian
  'руковод', 'разработ', 'внедр', 'организ', 'обеспеч', 'провод', 'контрол', 'координ', 'обуч', 'сопровожд',
  'подготов', 'анализ', 'ведени', 'оформл', 'монтаж', 'ремонт', 'обслуж', 'выполн', 'отвеча', 'консульт',
  // Kazakh
  'басқар', 'ұйымдаст', 'жүргіз', 'дайында', 'қамтамасыз', 'бақыла', 'үйрет', 'орында',
];
const VERB_RE = new RegExp(`(?<![\\p{L}])(${VERB_STEMS.join('|')})\\p{L}*`, 'giu');

const SECTION_RE =
  /(?:^|\n)\s*(?:work\s+experience|professional\s+experience|experience|employment(?:\s+history)?|education|skills|responsibilities|summary|certifications?|licenses?|опыт\s+работы|образование|навыки|обязанности|сертификаты|жұмыс\s+тәжірибесі|тәжірибе|білімі|дағдылар|міндеттері)\s*:?\s*(?:\n|$)/gi;

export function checkResume(text: string, phrases: TitlePhrases): ResumeCheck {
  const years = new Set(text.match(YEAR_RE) ?? []);
  const dates = years.size >= 2 || RANGE_RE.test(text) || MONTH_YEAR_RE.test(text) || EXPERIENCE_RE.test(text);

  const verbStems = new Set<string>();
  for (const m of text.matchAll(VERB_RE)) verbStems.add(m[1].toLowerCase());
  const sections = new Set((text.match(SECTION_RE) ?? []).map((s) => s.trim().toLowerCase().replace(/:$/, '')));
  const verbs = verbStems.size >= 3 || sections.size >= 2;

  const titles = countTitleHits(text, phrases);
  const signals: ResumeSignals = {
    dates,
    titles: titles.multi >= 1 || titles.single >= 2,
    verbs,
    length: text.trim().length > MIN_RESUME_LENGTH,
  };
  const count = Object.values(signals).filter(Boolean).length;
  return { ok: count >= 2 && (signals.dates || signals.verbs), signals };
}

function countTitleHits(text: string, phrases: TitlePhrases): { multi: number; single: number } {
  const multi = new Set<string>();
  const single = new Set<string>();
  // Line by line so a title never spans two unrelated lines.
  for (const line of text.split(/\n+/)) {
    const words = normTitle(line).main.split(' ').filter(Boolean);
    for (let i = 0; i < words.length; i++) {
      if (phrases.single.has(words[i])) single.add(words[i]);
      for (let n = 2; n <= 4 && i + n <= words.length; n++) {
        const phrase = words.slice(i, i + n).join(' ');
        if (phrases.multi.has(phrase)) multi.add(phrase);
      }
    }
  }
  return { multi: multi.size, single: single.size };
}
