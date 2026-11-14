import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { validateSlip } from '@/domain/reps';
import type { BankEdge, BankSlip } from '@/server/reps';

/** A hand-checked nurse slip (3 mistakes) in bank form, built through the same validator as live output. */
export function nurseSlip(taskId: string): BankSlip {
  const document = `# Discharge Instructions
Riverside Medical Center, Unit 5 West

| Patient | Allergies | Discharge date |
| --- | --- | --- |
| Harold Benning, 71 | Penicillin (hives) | 11/14/2026 |

You were treated for community-acquired pneumonia and are ready to go home.

## Medications
- Take amoxicillin 500 mg by mouth three times daily for 5 days.
- Continue metoprolol 25 mg by mouth twice daily.
- Take acetaminophen 650 mg every 6 hours as needed for fever, no more than 3,000 mg a day.

## Follow-up
- See your PCP Dr. Alvarez for a check of your lungs.
- Your oxygen level today was 88% on room air, which is normal for going home.
- Call 911 for chest pain or severe shortness of breath.

## Activity and diet
Walk short distances several times a day and increase slowly. Drink at least 6 cups of fluids a day unless your doctor told you to limit fluids. Avoid smoking and secondhand smoke. Rest when you feel tired and do not lift more than 10 lb for the first week.

## When to call
Call the unit at 555-0142 if your temperature is above 100.4 °F, if your cough brings up blood, or if you feel more tired each day instead of less. Bring this sheet and your medication list to every visit.`;
  const v = validateSlip(
    {
      title: 'Discharge Instructions',
      brief: 'Discharge instructions for a patient going home after pneumonia, drafted from the chart.',
      docType: 'discharge instructions',
      document,
      errors: [
        { quote: 'Take amoxicillin 500 mg by mouth three times daily', type: 'compliance', explanation: 'Amoxicillin is a penicillin; the chart lists a penicillin allergy.', fix: 'Take doxycycline 100 mg by mouth twice daily' },
        { quote: 'See your PCP Dr. Alvarez for a check of your lungs', type: 'omission', explanation: 'No time frame for the follow-up visit.', fix: 'See your PCP Dr. Alvarez within 7 days for a check of your lungs' },
        { quote: 'oxygen level today was 88% on room air', type: 'fact', explanation: '88% on room air is too low to go home.', fix: 'oxygen level today was 95% on room air' },
      ],
    },
    { n: 3, types: ['fact', 'omission', 'compliance'] },
  );
  if (!v.ok) throw new Error(v.problems.join('\n'));
  return { type: 'slip', occupationCode: '29-1141.00', taskId, locale: 'en', difficulty: 2, title: v.content.title, brief: v.content.brief, docType: v.content.docType, slip: v.content.slip };
}

export function nurseEdge(taskId: string): BankEdge {
  return {
    type: 'edge',
    occupationCode: '29-1141.00',
    taskId,
    locale: 'en',
    difficulty: 1,
    title: 'Delayed discharge, upset daughter',
    brief: 'Talk with a daughter whose father has waited all day to go home.',
    edge: {
      scenario: 'It is 4 p.m. on a med-surg unit. Mr. Ortiz was told at 9 a.m. he would go home today; the discharge is still waiting on a pharmacy check.',
      personaPublic: 'Dana, the patient\'s daughter, standing at the nurses\' station with her coat on.',
      personaHidden: 'She took unpaid leave and must be at work tomorrow. She is afraid the delay means her father is sicker than anyone says.',
      goal: 'Dana knows why the discharge is delayed and agrees a realistic next step.',
      criteria: [
        { id: 'c1', text: 'Names her frustration before explaining', keywords: ['frustrating', 'understand', 'waiting all day'] },
        { id: 'c2', text: 'Explains the delay in plain words', keywords: ['pharmacy', 'medication check'] },
        { id: 'c3', text: 'Makes no promise they cannot keep', keywords: ['cannot promise', "can't promise"] },
        { id: 'c4', text: 'Agrees a concrete next step and time', keywords: ['by 5', 'I will check', 'next step'] },
      ],
      opening: 'We were told nine o\'clock. It\'s four. Nobody tells me anything. Is something wrong with my dad?',
    },
  };
}

export function writeBank(root: string, entries: (BankSlip | BankEdge)[]): void {
  const counts = new Map<string, number>();
  for (const e of entries) {
    const dir = path.join(root, e.occupationCode);
    mkdirSync(dir, { recursive: true });
    const key = `${e.occupationCode}/${e.type}`;
    const n = (counts.get(key) ?? 0) + 1;
    counts.set(key, n);
    writeFileSync(path.join(dir, `${e.type}-${n}.json`), JSON.stringify(e, null, 2));
  }
}
