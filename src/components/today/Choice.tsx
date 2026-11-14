'use client';

import { Clock3 } from 'lucide-react';
import { Button } from '@/components/kit/Button';
import type { RepType } from '@/domain/types';
import { useT } from '@/i18n/client';
import type { ChoiceTask } from './api';
import sc from './choice.module.css';

const TYPES: RepType[] = ['slip', 'delegate', 'edge'];

/** Today's suggested type: the same date rotation the engine uses for tomorrow's rep. */
export function suggestedType(day: string | undefined): RepType {
  const t = day ? Date.parse(`${day}T00:00:00Z`) : Date.now();
  const n = Math.floor((Number.isFinite(t) ? t : Date.now()) / 86_400_000);
  return TYPES[((n % 3) + 3) % 3];
}

/*
 * The three types are three different objects: a drafted sheet to mark, a note to the machine, a
 * conversation. Each is drawn with the person's real task from their week. The suggested one leads at
 * full size; the other two wait as quiet rows beside it.
 */

function SheetObject({ task }: { task: ChoiceTask }) {
  const { t } = useT();
  return (
    <div className={sc.obj} data-type="slip" aria-hidden="true">
      <div className={sc.sheetUnder} />
      <div className={sc.sheet}>
        <div className={sc.sheetHead}>
          <span className={sc.sheetTitle}>{task.taskShort}</span>
          <span className={sc.aiTag}>
            <i />
            {t('today.choice.drafted')}
          </span>
        </div>
        <p className={sc.sheetText}>{task.taskText}</p>
        <span className={sc.ring}>?</span>
      </div>
    </div>
  );
}

function NoteObject({ task }: { task: ChoiceTask }) {
  const { t } = useT();
  return (
    <div className={sc.obj} data-type="delegate" aria-hidden="true">
      <div className={sc.note}>
        <div className={sc.noteTo}>
          <i />
          {t('today.delegate.to')}
        </div>
        <p className={sc.noteTask}>{task.taskText}</p>
        <p className={sc.noteCaret}>
          {t('today.choice.yourWords')}
          <b />
        </p>
      </div>
    </div>
  );
}

function TalkObject({ task }: { task: ChoiceTask }) {
  const { t } = useT();
  return (
    <div className={sc.obj} data-type="edge" aria-hidden="true">
      <div className={sc.talk}>
        <div className={sc.them}>
          <span className={sc.initial} />
          <p>{task.taskText}</p>
        </div>
        <div className={sc.you}>
          {t('today.choice.yourReply')}
          <b />
        </div>
      </div>
    </div>
  );
}

const OBJECT = { slip: SheetObject, delegate: NoteObject, edge: TalkObject } as const;

/** A small glyph of the same object for the quieter rows. */
function Glyph({ type }: { type: RepType }) {
  return (
    <span className={sc.glyph} data-type={type} aria-hidden="true">
      <i />
      <i />
    </span>
  );
}

export function ChoiceCards({
  tasks,
  day,
  starting,
  disabled,
  onStart,
  headingLevel = 2,
}: {
  tasks: Record<RepType, ChoiceTask>;
  /** Local day of the hub, for today's suggestion. */
  day?: string;
  /** The type being started (its button shows the pending state). */
  starting: RepType | null;
  disabled?: boolean;
  onStart: (type: RepType) => void;
  headingLevel?: 2 | 3;
}) {
  const { t } = useT();
  const H = headingLevel === 2 ? 'h2' : 'h3';
  const lead = suggestedType(day);
  const others = TYPES.filter((x) => x !== lead);
  const leadTask = tasks[lead];
  const Obj = OBJECT[lead];
  const busy = (type: RepType) => starting !== null && starting !== type;

  return (
    <div className={sc.choice}>
      <section className={sc.lead} data-type={lead} aria-labelledby={`choice-${lead}`}>
        <div className={sc.leadText}>
          <H id={`choice-${lead}`} className={sc.leadName}>
            {t(`today.choice.${lead}.name`)}
          </H>
          <p className={sc.leadWhat}>{t(`today.choice.${lead}.what`)}</p>
          {leadTask ? (
            <p className={sc.task}>
              <span className={sc.taskLabel}>{t('today.choice.fromWeek')}</span>
              <span className={sc.taskName} title={leadTask.taskText}>
                {leadTask.taskShort || leadTask.taskText}
              </span>
            </p>
          ) : null}
          <div className={sc.leadFoot}>
            <Button size="lg" loading={starting === lead} loadingLabel={t('today.choice.starting')} disabled={disabled || busy(lead)} onClick={() => onStart(lead)} aria-label={`${t('today.choice.start')}: ${t(`today.choice.${lead}.name`)}`}>
              {t('today.choice.start')}
            </Button>
            <span className={sc.minutes}>
              <Clock3 size={16} strokeWidth={1.75} aria-hidden="true" />
              {t('today.choice.minutes', { minutes: leadTask?.minutes ?? 5 })}
            </span>
          </div>
        </div>
        {leadTask ? <Obj task={leadTask} /> : null}
      </section>

      <section className={sc.alts} aria-labelledby="choice-others">
        <h3 id="choice-others" className={sc.altsTitle}>
          {t('today.choice.others')}
        </h3>
        <ul className={sc.altList}>
          {others.map((type) => {
            const task = tasks[type];
            return (
              <li key={type} className={sc.alt} data-type={type}>
                <Glyph type={type} />
                <div className={sc.altText}>
                  <span className={sc.altName}>{t(`today.choice.${type}.name`)}</span>
                  <span className={sc.altWhat}>{t(`today.choice.${type}.what`)}</span>
                  {task ? (
                    <span className={sc.altTask}>
                      <span className="sr-only">{t('today.choice.fromWeek')} </span>
                      {task.taskShort || task.taskText}
                      <span className={sc.altMin}>{t('today.choice.minutes', { minutes: task.minutes })}</span>
                    </span>
                  ) : null}
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  loading={starting === type}
                  loadingLabel={t('today.choice.starting')}
                  disabled={disabled || busy(type)}
                  onClick={() => onStart(type)}
                  aria-label={`${t('today.choice.start')}: ${t(`today.choice.${type}.name`)}`}
                >
                  {t('today.choice.start')}
                </Button>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
