import { describe, expect, it } from 'vitest';
import { validateDelegate } from '@/server/reps';
import type { RepDelegateOutput } from '@/server/ai/prompts/rep-delegate';

/** The Delegate checks reject real problems and repair harmless formatting instead of failing a generation. */

const inputs = `Q3 vendor payments, prepared 10/02/2026 for the controller.

| Vendor | Invoice | Amount |
| --- | --- | --- |
| Northfield Supply | INV-2041 | $12,400 |
| Bluestone Freight | INV-2045 | $3,150 |
| Cedar Ridge Print | INV-2050 | $860 |

Total paid in Q3: $17,410. The AP ledger shows Bluestone Freight at $3,510 for INV-2045. Northfield Supply terms are net 30; the invoice is dated 08/14/2026 and was paid 09/10/2026. Cedar Ridge Print was paid by card. All three vendors have a W-9 on file and none is a corporation, so 1099-NEC forms are due for each vendor paid $600 or more in the year. The controller wants a short list of payments to review before the books close on 10/10/2026, with anything that does not tie flagged for follow-up and the source of each figure named.`;

const base: RepDelegateOutput = {
  title: 'Q3 vendor payment review',
  brief: 'A short review list of Q3 vendor payments for the controller.',
  scenario: 'You are closing Q3. The controller reviews the list on Friday before the books close.',
  inputs,
  goal: 'The controller sees every payment, and anything that does not tie is flagged.',
  criteria: [
    { text: 'Says the list is for the controller before the close', keywords: ['controller'] },
    { text: 'Asks for a short list format', keywords: ['list', 'bullet'] },
    { text: 'Asks to tie totals to their lines', keywords: ['tie', 'total'] },
    { text: 'Asks to name the source of each figure', keywords: ['source'] },
  ],
  traps: [
    { description: 'The total does not equal the three lines.', evidence: ['Total paid in Q3: $17,410', '| Cedar Ridge Print | INV-2050 | $860 |'], keywords: [] },
    { description: 'Bluestone amount differs between schedule and ledger.', evidence: ['bluestone freight | inv-2045 | $3,150', 'ledger shows Bluestone Freight at $3,510'], keywords: ['$3,510'] },
  ],
  exemplar:
    'Review these Q3 vendor payments for the controller before Friday\'s close. Recompute every total from its lines, compare each amount with the AP ledger, and list anything that does not tie first, naming the source of each figure. Return a short bullet list, at most 150 words.',
};

describe('validateDelegate', () => {
  it('repairs evidence copied across table cells or in another case, and takes keywords from the evidence values', () => {
    const v = validateDelegate(base);
    expect(v.ok ? [] : v.problems).toEqual([]);
    if (!v.ok) return;
    const [t1, t2] = v.content.delegate.traps;
    expect(t1.evidence).toEqual(['Total paid in Q3: $17,410', 'Cedar Ridge Print | INV-2050 | $860']);
    expect(t1.keywords).toEqual(expect.arrayContaining(['$17,410']));
    expect(t2.evidence![0]).toBe('Bluestone Freight | INV-2045 | $3,150');
  });

  it('still rejects evidence that is not in the inputs and an exemplar that names a trap value', () => {
    const bad = validateDelegate({
      ...base,
      traps: [base.traps[0], { ...base.traps[1], evidence: ['Bluestone Freight at $9,999', 'ledger shows Bluestone Freight at $3,510'] }],
      exemplar: `${base.exemplar} Check the $3,510 ledger figure.`,
    });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.problems.join(' ')).toMatch(/not in the inputs word for word/);
    expect(bad.problems.join(' ')).toMatch(/exemplar names trap values/);
  });
});
