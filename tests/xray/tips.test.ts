import { describe, expect, it } from 'vitest';
import { applyTips, heuristicShort, tipsResponse } from '@/server/xray/tips';
import { fixture } from '../domain/helpers';

const nurse = fixture('29-1141.00');
const byCat = (cat: string) => nurse.tasks.find((t) => t.evidence.category === cat)!;

describe('short labels without the model', () => {
  it.each([
    ["Record patients' medical information and vital signs.", "Record patients' medical information"],
    ['Maintain accurate, detailed reports and records.', 'Maintain accurate, detailed reports'],
    ['Administer medications to patients and monitor patients for reactions or side effects.', 'Administer medications'],
    ['Code documents according to company procedures.', 'Code documents according'],
  ])('%s → %s', (text, short) => {
    expect(heuristicShort(text)).toBe(short);
  });
});

describe('tips post-processing', () => {
  const speeds = byCat('ai_speeds');
  const edge = byCat('human_edge');

  it('picks the tip by the data category, drops unknown ids and runaway text', () => {
    const record = applyTips(
      {
        tasks: [
          { taskId: speeds.id, short: 'Charting.', tipHand: 'Dictate your notes and ask for a draft; check doses.', tipEdge: 'ignored', text: null },
          { taskId: edge.id, short: 'Medication rounds', tipHand: 'should be ignored', tipEdge: 'You see the patient react.', text: null },
          { taskId: 'unknown', short: 'x', tipHand: 'x', tipEdge: null, text: null },
          { taskId: nurse.tasks[2].id, short: 'A label that is far too long to be a short label', tipHand: 'x'.repeat(400), tipEdge: null, text: null },
        ],
      },
      nurse,
      'en',
    );
    expect(record.tasks[speeds.id]).toMatchObject({ short: 'Charting', tip: 'Dictate your notes and ask for a draft; check doses.', kind: 'hand', edgeTip: null });
    expect(record.tasks[edge.id]).toMatchObject({ tip: 'You see the patient react.', kind: 'edge' });
    expect(record.tasks.unknown).toBeUndefined();
    expect(record.tasks[nurse.tasks[2].id]).toMatchObject({ short: null, tip: null });

    const tips = tipsResponse(record, nurse);
    expect(Object.keys(tips).sort()).toEqual([speeds.id, edge.id].sort());
  });

  it('keeps translations only for ru/kk', () => {
    const item = { taskId: speeds.id, short: 'Ведение записей', tipHand: 'Совет', tipEdge: null, text: 'Записывать данные пациентов.' };
    expect(applyTips({ tasks: [item] }, nurse, 'ru').tasks[speeds.id].text).toBe('Записывать данные пациентов.');
    expect(applyTips({ tasks: [item] }, nurse, 'en').tasks[speeds.id].text).toBeNull();
  });
});
