'use client';

import { Clock3 } from 'lucide-react';
import { Button } from '@/components/kit/Button';
import type { RepType } from '@/domain/types';
import { useT } from '@/i18n/client';
import type { ChoiceTask } from './api';
import { TaskTile } from './shared';
import sc from './choice.module.css';

/* Three small scenes from the product's world: a drafted sheet under the marker, a note handed to the
   machine, a conversation. Decorative; the card text says the same in words. */

function SlipArt() {
  return (
    <div className={sc.art} data-type="slip" aria-hidden="true">
      <div className={sc.sheetBack} />
      <div className={sc.sheet}>
        <i className={sc.aiTag} />
        <i className={sc.sTitle} />
        <i className={sc.line} style={{ width: '88%' }} />
        <i className={sc.line} style={{ width: '74%' }} />
        <span className={sc.markLine}>
          <i className={sc.line} style={{ width: '82%' }} />
          <b className={sc.marker} />
        </span>
        <i className={sc.line} style={{ width: '64%' }} />
        <span className={sc.margin}>1</span>
      </div>
    </div>
  );
}

function DelegateArt() {
  return (
    <div className={sc.art} data-type="delegate" aria-hidden="true">
      <div className={sc.machine}>
        <i className={sc.line} style={{ width: '70%' }} />
        <i className={sc.line} style={{ width: '86%' }} />
        <i className={sc.line} data-grow style={{ width: '58%' }} />
        <i className={sc.line} data-grow style={{ width: '76%' }} />
      </div>
      <div className={sc.slip}>
        <i className={sc.slipTo} />
        <i className={sc.line} style={{ width: '84%' }} />
        <i className={sc.line} style={{ width: '62%' }} />
      </div>
    </div>
  );
}

function EdgeArt() {
  return (
    <div className={sc.art} data-type="edge" aria-hidden="true">
      <div className={sc.bubble} data-side="them">
        <span className={sc.initial}>D</span>
        <span className={sc.bLines}>
          <i className={sc.line} style={{ width: '92%' }} />
          <i className={sc.line} style={{ width: '64%' }} />
        </span>
      </div>
      <div className={sc.bubble} data-side="you">
        <i className={sc.line} style={{ width: '88%' }} />
        <i className={sc.line} style={{ width: '52%' }} />
      </div>
      <div className={sc.bubble} data-side="them" data-typing>
        <span className={sc.initial}>D</span>
        <span className={sc.typing}>
          <i />
          <i />
          <i />
        </span>
      </div>
    </div>
  );
}

const ART: Record<RepType, () => React.JSX.Element> = { slip: SlipArt, delegate: DelegateArt, edge: EdgeArt };

export function ChoiceCards({
  tasks,
  starting,
  disabled,
  onStart,
  headingLevel = 2,
}: {
  tasks: Record<RepType, ChoiceTask>;
  /** The type being started (its button shows the pending state). */
  starting: RepType | null;
  /** Why no rep can be started now (for example all practice reps are used). */
  disabled?: string;
  onStart: (type: RepType) => void;
  headingLevel?: 2 | 3;
}) {
  const { t } = useT();
  const H = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <ul className={sc.cards}>
      {(['slip', 'delegate', 'edge'] as const).map((type) => {
        const task = tasks[type];
        const Art = ART[type];
        return (
          <li key={type} className={sc.card} data-type={type}>
            <Art />
            <div className={sc.body}>
              <H className={sc.name}>{t(`today.choice.${type}.name`)}</H>
              <p className={sc.what}>{t(`today.choice.${type}.what`)}</p>
              {task ? (
                <p className={sc.task}>
                  <TaskTile human={type === 'edge'} />
                  <span className="sr-only">{t('today.choice.fromWeek')} </span>
                  <span className={sc.taskName} title={task.taskText}>
                    {task.taskShort || task.taskText}
                  </span>
                </p>
              ) : null}
              <div className={sc.foot}>
                <span className={sc.minutes}>
                  <Clock3 size={16} strokeWidth={1.75} aria-hidden="true" />
                  {t('today.choice.minutes', { minutes: task?.minutes ?? 5 })}
                </span>
                <Button
                  loading={starting === type}
                  loadingLabel={t('today.choice.starting')}
                  disabled={!!disabled || (starting !== null && starting !== type)}
                  onClick={() => onStart(type)}
                  aria-label={`${t('today.choice.start')}: ${t(`today.choice.${type}.name`)}`}
                >
                  {t('today.choice.start')}
                </Button>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
