'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/kit/Button';
import { Field } from '@/components/kit/Field';
import { OpenMyWeek, useHasWeek } from '@/components/public/Returning';
import st from './landing.module.css';

/**
 * «What do you do?» and «Map my week». The landing does not search or map anything: the form
 * hands the typed title to /start (`?q=`), where the flow opens with the field filled in.
 * It is a plain GET form, so it also works before hydration.
 */
export function JobForm({ surface, label, placeholder, submit, id }: { surface: 'field' | 'paper'; label: string; placeholder: string; submit: string; id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  // A person who already has a week map gets «Open my week» here instead of the form (R3 shell).
  const hasWeek = useHasWeek();

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const q = String(new FormData(e.currentTarget).get('q') ?? '').trim();
    setBusy(true);
    router.push(q ? `/start?q=${encodeURIComponent(q)}` : '/start');
  };

  if (hasWeek) return <OpenMyWeek surface={surface} />;

  return (
    <form action="/start" method="get" className={st.form} onSubmit={onSubmit} data-surface={surface}>
      <Field
        id={id}
        name="q"
        label={label}
        placeholder={placeholder}
        surface={surface === 'field' ? 'violet' : 'paper'}
        size="lg"
        autoComplete="organization-title"
        autoCapitalize="words"
        enterKeyHint="go"
        maxLength={120}
        trailing={
          <Button type="submit" variant={surface === 'field' ? 'lavender' : 'primary'} size="lg" loading={busy} className={st.formBtn}>
            {submit}
          </Button>
        }
      />
    </form>
  );
}
