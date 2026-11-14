/* A Spot-the-slip document for the gallery, with offsets computed from the text itself. */

import type { CharRange, ReviewMark, SlipError } from '../types';

export const repDocument = `# Discharge summary
Ward 4B, drafted for review

| Patient | Allergies | Admitted |
| --- | --- | --- |
| R. Lindqvist, 74 | Penicillin (rash, 2019) | 6 Nov 2026 |

Admitted with community-acquired pneumonia, right lower lobe on chest X-ray. Treated with IV clarithromycin, switched to oral on day 3. Her daughter will stay with her for the first week.

Temperature has been normal for 48 hours, with no fever since 8 November.

## Plan on discharge
- Discharge medication: amoxicillin 500 mg three times daily for 5 days.
- Oxygen saturation 88% on room air, stable for discharge home.
- Repeat chest X-ray in 2 weeks to confirm the consolidation has cleared.
- GP review within 7 days, sooner if breathless.`;

function at(quote: string): [number, number] {
  const start = repDocument.indexOf(quote);
  if (start < 0) throw new Error(`fixture quote not found: ${quote}`);
  return [start, start + quote.length];
}

const q1 = 'amoxicillin 500 mg three times daily for 5 days';
const q2 = 'Oxygen saturation 88% on room air';
const q3 = 'Repeat chest X-ray in 2 weeks';
const qFalse = 'no fever since 8 November';
const qFalse2 = 'GP review within 7 days';

export const repErrors: SlipError[] = [
  { quote: q1, start: at(q1)[0], end: at(q1)[1], type: 'compliance', explanation: 'Amoxicillin is a penicillin, and the allergy list says penicillin.', fix: 'Use doxycycline 100 mg twice daily for 5 days.' },
  { quote: q2, start: at(q2)[0], end: at(q2)[1], type: 'fact', explanation: 'Without lung disease she should be at 92% or more on room air before going home.', fix: 'Keep her in until saturation holds at 92% or more.' },
  { quote: q3, start: at(q3)[0], end: at(q3)[1], type: 'fact', explanation: 'A repeat X-ray is usually booked about 6 weeks after pneumonia, not 2.', fix: 'Repeat chest X-ray in 6 weeks.' },
];

/** What a person might have highlighted before checking. */
export const repUserRanges: CharRange[] = [at(q1), at(q2), at(qFalse), at(qFalse2)];

export const repMarks: ReviewMark[] = [
  { id: 'f1', kind: 'found', start: at(q1)[0], end: at(q1)[1], n: 1, title: 'Caught', body: repErrors[0].explanation },
  { id: 'f2', kind: 'found', start: at(q2)[0], end: at(q2)[1], n: 2, title: 'Caught', body: repErrors[1].explanation },
  { id: 'm3', kind: 'missed', start: at(q3)[0], end: at(q3)[1], n: 3, title: 'Slipped past', body: repErrors[2].explanation },
  { id: 'x1', kind: 'first_false', start: at(qFalse)[0], end: at(qFalse)[1], title: 'Not on our list', body: 'This matches the observation chart, so it costs you nothing.' },
  { id: 'x2', kind: 'false', start: at(qFalse2)[0], end: at(qFalse2)[1], title: 'Not a mistake', body: 'Seven days is the usual window after pneumonia.' },
];
