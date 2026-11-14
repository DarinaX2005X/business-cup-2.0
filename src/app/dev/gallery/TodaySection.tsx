'use client';

import { useState } from 'react';
import { todayFixtures } from '@/components/today/__fixtures__/today';
import { ChipRadio } from '@/components/today/shared';
import type { GalleryWidth } from './Gallery';
import g from './gallery.module.css';

/*
 * Today (03.2): every screen state from src/components/today/__fixtures__, rendered by the real route
 * (`/today?fixture=<name>`, development only) inside a frame of the chosen width, so the phone layout
 * is the real one and not a squeezed desktop. Frames load as they scroll into view.
 */

const NOTES: Record<string, string> = {
  'pro-choose': 'Pro, nothing done yet: the suggested type leads, the other two wait beside it.',
  'pro-open': 'Today’s rep started and left open.',
  'pro-done': 'Day done: the result on the violet field, the countdown, practice reps, a played round.',
  generating: 'The rep is being written.',
  'slip-answer': 'Spot the slip while marking.',
  'slip-review': 'Checked: rings fill one by one, notes on the margin, the exact score step.',
  'slip-bank': 'A bank rep that replaced another type, with its source note.',
  'delegate-open': 'Delegate: writing the instructions (no rubric before the grade).',
  'delegate-run': 'Delegate: marking the AI’s result.',
  'delegate-graded': 'Delegate graded: what the instructions covered, traps, the exemplar.',
  'edge-open': 'Human edge under way.',
  'edge-graded': 'Human edge graded: notes beside the replies, a harmful line, what they did not say.',
  'free-available': 'Free with the free rep waiting.',
  'free-progress': 'Free with the free rep started.',
  'free-used': 'Free after the free rep: tomorrow behind the Pro seal.',
  'no-map': 'No week map yet.',
};

const PX: Record<GalleryWidth, number> = { '1440': 1440, '768': 768, '390': 390 };

export function TodaySection({ w }: { w: GalleryWidth }) {
  const names = Object.keys(todayFixtures);
  const [name, setName] = useState<string>('all');
  const shown = name === 'all' ? names : [name];
  const width = PX[w];
  return (
    <section id="today" className={g.section} aria-labelledby="today-h">
      <div className={g.sHead}>
        <div>
          <h2 id="today-h">Today</h2>
          <p>Every state of the Today screen, rendered by the real page from its fixtures. Actions inside the frames talk to the live API.</p>
        </div>
        <div className={g.sTools}>
          <ChipRadio label="Today state" value={name} onChange={setName} options={[{ value: 'all', label: 'All' }, ...names.map((n) => ({ value: n, label: n }))]} />
        </div>
      </div>
      {shown.map((n) => (
        <div key={`${n}-${w}`} className={g.state}>
          <div className={g.stateName}>
            {n}: {NOTES[n] ?? ''}
          </div>
          <div style={{ overflowX: 'auto', borderRadius: 20, boxShadow: 'inset 0 0 0 1px var(--line)' }}>
            <iframe
              src={`/today?fixture=${encodeURIComponent(n)}`}
              title={`Today, ${n}`}
              loading="lazy"
              style={{ display: 'block', width, maxWidth: 'none', height: w === '390' ? 844 : 900, border: 0, borderRadius: 20, background: 'var(--paper)' }}
            />
          </div>
        </div>
      ))}
    </section>
  );
}
