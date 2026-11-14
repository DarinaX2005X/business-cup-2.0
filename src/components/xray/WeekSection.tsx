'use client';

import { useState, type FormEvent, type MouseEvent } from 'react';
import { Button } from '@/components/kit/Button';
import { Field } from '@/components/kit/Field';
import type { WeekTask } from '@/components/kit/types';
import { WeekBar } from '@/components/kit/WeekBar';
import type { XrayComputed } from '@/domain/types';
import { useT } from '@/i18n/client';
import { useProfile } from '@/lib/client/profile';
import type { MetricId } from './types';
import st from './xray.module.css';

/** The week itself: category totals over their part of the bar, the bar, the part without data and the pay. */
export function WeekSection({
  tasks,
  result,
  selectedId,
  editing,
  dragging,
  isOwner,
  salary,
  onSalary,
  onSelect,
  onMetric,
}: {
  tasks: WeekTask[];
  result: XrayComputed;
  selectedId: string | null;
  editing: boolean;
  dragging: boolean;
  isOwner: boolean;
  salary: number | null;
  onSalary: (v: number | null) => void;
  onSelect: (id: string) => void;
  onMetric: (id: MetricId) => void;
}) {
  const { t, f } = useT();

  // The category totals are drawn by the Week Bar itself; a click on one opens the hours breakdown.
  const onBarClick = (e: MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest('button')) return;
    const group = target.closest('li[data-cat]');
    if (group && group.firstElementChild?.contains(target) && group.firstElementChild.tagName === 'DIV') onMetric('hours');
  };

  return (
    <section className={st.week} aria-labelledby="week-title">
      <div className={st.secHead}>
        <h2 id="week-title" className={st.h2}>
          {isOwner ? t('xray.week.title') : t('xray.week.titleGuest')}
        </h2>
        <button type="button" className={st.textBtn} onClick={() => onMetric('hours')}>
          {t('xray.week.hoursHow')}
        </button>
      </div>
      <div className={st.barWrap} onClick={onBarClick}>
        <WeekBar
          tasks={tasks}
          selectedId={selectedId}
          onSelect={onSelect}
          editable={editing}
          dragging={dragging}
          ariaLabel={t('xray.week.barLabel')}
        />
      </div>
      <div className={st.weekFoot}>
        {result.hours.no_data > 0 ? (
          <p className={st.noData}>
            <span className={st.ndSwatch} aria-hidden="true" />
            {t('xray.week.noData', { hours: f.number(result.hours.no_data, { maximumFractionDigits: 1 }) })}
          </p>
        ) : null}
        <PayLine result={result} isOwner={isOwner} salary={salary} onSalary={onSalary} onMetric={onMetric} />
      </div>
    </section>
  );
}

function PayLine({
  result,
  isOwner,
  salary,
  onSalary,
  onMetric,
}: {
  result: XrayComputed;
  isOwner: boolean;
  salary: number | null;
  onSalary: (v: number | null) => void;
  onMetric: (id: MetricId) => void;
}) {
  const { t, f } = useT();
  const { update } = useProfile();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const annual = result.salary.annual;
  if (annual == null || result.payAtStake == null) return <p className={st.payNone}>{t('xray.week.payNone')}</p>;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const n = Math.round(Number(value.replace(/[\s,$]/g, '')));
    if (!Number.isFinite(n) || n < 1000 || n > 10_000_000) {
      setError(t('xray.week.salaryError'));
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await update({ salary: n });
      onSalary(n);
      setOpen(false);
    } catch {
      setError(t('xray.week.salaryNotSaved'));
    } finally {
      setBusy(false);
    }
  };

  const resetToMedian = async () => {
    setBusy(true);
    try {
      await update({ salary: null });
      onSalary(null);
    } catch {
      setError(t('xray.week.salaryNotSaved'));
    } finally {
      setBusy(false);
    }
  };

  const key = !isOwner ? 'xray.week.payGuest' : 'xray.week.pay';
  const [a, b] = t(key, { atStake: '\u0000', annual: '\u0001' }).split('\u0000');
  const [b1, b2] = (b ?? '').split('\u0001');
  return (
    <div className={st.pay}>
      <button type="button" className={st.payBtn} onClick={() => onMetric('pay')}>
        {a}
        <b className={st.payNum}>{f.currency(result.payAtStake)}</b>
        {b1}
        <b>{f.currency(annual)}</b>
        {b2}
      </button>
      <p className={st.paySrc}>
        {salary != null ? t('xray.week.payUser') : t('xray.week.paySource')}
        {isOwner && !open ? (
          <>
            {' '}
            <button type="button" className={st.inlineBtn} onClick={() => (salary != null ? void resetToMedian() : setOpen(true))} disabled={busy}>
              {salary != null ? t('xray.week.salaryReset') : t('xray.week.useSalary')}
            </button>
          </>
        ) : null}
      </p>
      {open ? (
        <form className={st.salaryForm} onSubmit={submit} noValidate>
          <Field
            label={t('xray.week.salaryLabel')}
            inputMode="numeric"
            autoComplete="off"
            placeholder="72000"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            error={error ?? undefined}
            autoFocus
          />
          <div className={st.salaryActions}>
            <Button type="submit" size="sm" loading={busy} loadingLabel={t('xray.week.salarySaving')}>
              {t('xray.week.salarySave')}
            </Button>
            <Button variant="quiet" size="sm" onClick={() => setOpen(false)}>
              {t('common.actions.cancel')}
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
