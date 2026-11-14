'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/kit/Button';
import { Field } from '@/components/kit/Field';
import btn from '@/components/kit/controls.module.css';
import { initialOf } from '@/components/shell/account';
import { useAccount } from '@/components/shell/HeaderAccount';
import { LevelStone } from '@/components/shell/ShellMenus';
import { useShellRoutes } from '@/components/shell/AppShell';
import { useT } from '@/i18n/client';
import { ApiError, apiFetch } from '@/lib/client/api';
import { useProfile } from '@/lib/client/profile';
import st from './leaderboard.module.css';

interface Row {
  rank: number;
  handle: string;
  xp: number;
  you: boolean;
}

interface Board {
  week: string;
  top: Row[];
  you: { rank: number; xp: number; handle: string } | null;
  players: number;
}

/** GET /api/leaderboard; a missing service reads as an empty board (nothing is ever invented). */
function useBoard(ready: boolean) {
  const [state, setState] = useState<{ board: Board } | { error: true } | null>(null);
  const load = useCallback(() => {
    setState(null);
    apiFetch<Board>('/api/leaderboard')
      .then((b) => setState({ board: { week: b.week ?? '', top: Array.isArray(b.top) ? b.top : [], you: b.you ?? null, players: b.players ?? b.top?.length ?? 0 } }))
      .catch((err) => {
        if (err instanceof ApiError && err.status === 404) setState({ board: { week: '', top: [], you: null, players: 0 } });
        else setState({ error: true });
      });
  }, []);
  useEffect(() => {
    if (ready) load();
  }, [ready, load]);
  return { state, load };
}

function Disc({ handle }: { handle: string }) {
  return (
    <span className={st.disc} aria-hidden="true">
      {initialOf({ handle })}
    </span>
  );
}

function Place({ rank }: { rank: number }) {
  const { t } = useT();
  if (rank <= 3) {
    return (
      <span className={st.place} data-top={rank} aria-label={t('leaderboard.rank', { rank })}>
        <LevelStone level={rank} size={30} />
      </span>
    );
  }
  return (
    <span className={st.place} aria-label={t('leaderboard.rank', { rank })}>
      {rank}
    </span>
  );
}

function RowItem({ row }: { row: Row }) {
  const { t, f } = useT();
  return (
    <li className={st.row} data-you={row.you || undefined} aria-current={row.you ? 'true' : undefined}>
      <Place rank={row.rank} />
      <Disc handle={row.handle} />
      <span className={st.handle}>
        {row.handle}
        {row.you ? <span className={st.youTag}>{t('leaderboard.you')}</span> : null}
      </span>
      <span className={st.xp}>{t('leaderboard.xp', { count: f.number(row.xp) })}</span>
    </li>
  );
}

function Nickname({ handle, current }: { handle: string; current: string | null }) {
  const { t } = useT();
  const { refresh } = useProfile();
  const [value, setValue] = useState(current ?? '');
  const [state, setState] = useState<'idle' | 'busy' | 'saved' | 'cleared' | 'invalid' | 'error'>('idle');

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (state === 'busy') return;
    const v = value.trim();
    if (v && (v.length < 2 || v.length > 24)) return setState('invalid');
    setState('busy');
    try {
      await apiFetch('/api/profile', { method: 'PATCH', body: { nickname: v || null } });
      await refresh();
      setState(v ? 'saved' : 'cleared');
    } catch (err) {
      setState(err instanceof ApiError && (err.code === 'invalid_nickname' || err.code === 'invalid_input') ? 'invalid' : 'error');
    }
  };

  const message = state === 'saved' ? t('leaderboard.nick.saved') : state === 'cleared' ? t('leaderboard.nick.cleared') : null;
  return (
    <form className={st.card} onSubmit={save} noValidate>
      <h2 className={st.cardTitle}>{t('leaderboard.nick.title')}</h2>
      <p className={st.cardBody}>{t('leaderboard.nick.now', { handle })}</p>
      <Field
        label={t('leaderboard.nick.label')}
        placeholder={t('leaderboard.nick.placeholder')}
        value={value}
        maxLength={24}
        autoComplete="nickname"
        onChange={(e) => {
          setValue(e.target.value);
          if (state !== 'busy') setState('idle');
        }}
        help={t('leaderboard.nick.help')}
        error={state === 'invalid' ? t('leaderboard.nick.invalid') : state === 'error' ? t('leaderboard.nick.error') : undefined}
      />
      <Button type="submit" loading={state === 'busy'} loadingLabel={t('leaderboard.nick.saving')}>
        {t('leaderboard.nick.save')}
      </Button>
      <p className={st.saved} role="status">
        {message}
      </p>
    </form>
  );
}

export function LeaderboardScreen() {
  const { t, f } = useT();
  const shell = useShellRoutes();
  const account = useAccount(shell.account);
  const { status } = useProfile();
  const ready = status !== 'loading';
  const { state, load } = useBoard(ready);
  const board = state && 'board' in state ? state.board : null;
  const me = board?.you ?? null;
  const shownYou = board?.top.some((r) => r.you) ?? false;

  return (
    <div className={st.page}>
      <header className={st.head}>
        <h1 className={st.title}>{t('leaderboard.title')}</h1>
        <p className={st.lead}>{t('leaderboard.lead')}</p>
      </header>

      <div className={st.layout}>
        <section className={st.boardWrap} aria-labelledby="lb-list" aria-busy={!state || undefined}>
          <h2 id="lb-list" className="sr-only">
            {t('leaderboard.title')}
          </h2>
          {!state ? (
            <ol className={st.list} aria-hidden="true">
              {Array.from({ length: 6 }, (_, i) => (
                <li key={i} className={`${st.row} ${st.skel}`} />
              ))}
            </ol>
          ) : 'error' in state ? (
            <div className={st.empty} role="alert">
              <h3 className={st.cardTitle}>{t('leaderboard.error.title')}</h3>
              <p className={st.cardBody}>{t('leaderboard.error.body')}</p>
              <Button variant="secondary" onClick={load}>
                {t('leaderboard.error.retry')}
              </Button>
            </div>
          ) : board && board.top.length ? (
            <>
              <p className={st.players}>{t('leaderboard.players', { count: board.players })}</p>
              <ol className={st.list}>
                {board.top.map((r) => (
                  <RowItem key={`${r.rank}-${r.handle}`} row={r} />
                ))}
                {me && !shownYou ? (
                  <>
                    <li className={st.gap} aria-label={t('leaderboard.gap')}>
                      <i />
                      <i />
                      <i />
                    </li>
                    <RowItem row={{ ...me, you: true }} />
                  </>
                ) : null}
              </ol>
            </>
          ) : (
            <div className={st.empty}>
              <div className={st.emptyArt} aria-hidden="true">
                <LevelStone level={1} size={56} />
              </div>
              <h3 className={st.cardTitle}>{t('leaderboard.empty.title')}</h3>
              <p className={st.cardBody}>{t('leaderboard.empty.body')}</p>
              <Link href="/today" className={`${btn.btn} ${btn.b_primary}`}>
                {t('leaderboard.empty.cta')}
              </Link>
            </div>
          )}
        </section>

        <aside className={st.side}>
          {account ? (
            <>
              <div className={st.card}>
                <h2 className={st.cardTitle}>{t('leaderboard.me.title')}</h2>
                <div className={st.meRow}>
                  <span className={st.bigDisc} aria-hidden="true">
                    {initialOf(account)}
                  </span>
                  <span className={st.meText}>
                    <b>{me ? t('leaderboard.me.place', { rank: me.rank, players: board?.players ?? me.rank }) : t('leaderboard.me.none')}</b>
                    <span>{me ? t('leaderboard.me.weekXp', { count: f.number(me.xp) }) : t('leaderboard.me.noneBody')}</span>
                  </span>
                </div>
                <p className={st.meLevel}>
                  <LevelStone level={account.level.level} size={26} />
                  {t('leaderboard.me.level', { level: account.level.level, name: account.level.levelName })}
                </p>
              </div>
              <Nickname key={account.nickname ?? ''} handle={account.handle} current={account.nickname} />
            </>
          ) : account === null ? (
            <div className={st.card}>
              <h2 className={st.cardTitle}>{t('leaderboard.nick.title')}</h2>
              <p className={st.cardBody}>{t('leaderboard.nick.noProfile')}</p>
              <Link href="/start" className={`${btn.btn} ${btn.b_primary}`}>
                {t('leaderboard.nick.noProfileCta')}
              </Link>
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
