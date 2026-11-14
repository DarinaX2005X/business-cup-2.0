/**
 * Extra slip check (03.3): an "omission" whose fix only adds a name, ID, code, phone number, URL or a
 * bare date is a nitpick, not a mistake a specialist would call one. A date after "by", "before",
 * "within" or "until" is a missing deadline and passes.
 */

const FILLER = new Set(['a', 'an', 'the', 'of', 'to', 'in', 'on', 'at', 'by', 'via', 'with', 'and', 'for', 'from', 'is', 'was', 'are', 'as', 'per', 'no', 'later', 'than', 'before', 'within', 'until', 'under', 'through']);
const CREDENTIALS = new Set(['rn', 'bsn', 'md', 'lpn', 'np', 'cna', 'do', 'pa', 'cpa', 'esq', 'jr', 'sr']);
const DEADLINE = /\b(by|before|within|until|no later than)\b/i;

const tokens = (s: string) => s.split(/\s+/).map((t) => t.replace(/^[("']+|[)"'.,;:]+$/g, '')).filter(Boolean);

export function weakOmissionFix(quote: string, fix: string): boolean {
  const have = new Set(tokens(quote).map((t) => t.toLowerCase()));
  const added = tokens(fix).filter((t) => !have.has(t.toLowerCase()));
  const content = added.filter((t) => !FILLER.has(t.toLowerCase()));
  if (!content.length) return false; // a fix that only rearranges is judged elsewhere
  const isDate = (t: string) => /^\d{1,2}\/\d{1,2}(\/\d{2,4})?$/.test(t);
  const detail = (t: string) =>
    CREDENTIALS.has(t.toLowerCase()) ||
    /^https?:\/\//i.test(t) ||
    isDate(t) ||
    (/\d/.test(t) && /[-#()@:/]/.test(t)) || // 555-0177, #094821, L4-0772, SRV-PAY-01
    /^[A-Z][a-z]+$/.test(t) || // a proper name that was not in the quote
    /^[A-Z0-9]{3,}$/.test(t) && /\d/.test(t); // FREESHIP2026
  if (!content.every(detail)) return false;
  if (content.some(isDate) && DEADLINE.test(fix)) return false;
  return true;
}

/** Problems for a slip's omissions, in the words of the retry message. */
export function weakOmissionProblems(errors: { type: string; quote: string; fix: string }[]): string[] {
  return errors
    .filter((e) => e.type === 'omission' && weakOmissionFix(e.quote, e.fix))
    .map((e) => `The omission "${e.quote}" is only a missing name, ID, code, number or date; an omission must be a missing item that matters for safety, money, compliance or the customer outcome (a missing dose, check, deadline or required disclosure).`);
}
