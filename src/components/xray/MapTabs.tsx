'use client';

import { useRef, type KeyboardEvent } from 'react';
import { useT } from '@/i18n/client';
import st from './xray.module.css';

export const MAP_TABS = ['overview', 'tasks', 'plan', 'skills', 'next'] as const;
export type MapTab = (typeof MAP_TABS)[number];
export const isMapTab = (v: unknown): v is MapTab => typeof v === 'string' && (MAP_TABS as readonly string[]).includes(v);

/**
 * The sections of the map under its top block: a sticky row of tabs, kept in the URL as `?tab=`.
 * Arrow keys move between tabs (WAI-ARIA tabs with automatic activation).
 */
export function MapTabs({ tab, onTab }: { tab: MapTab; onTab: (t: MapTab) => void }) {
  const { t } = useT();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent, i: number) => {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const n = (i + d + MAP_TABS.length) % MAP_TABS.length;
    onTab(MAP_TABS[n]);
    refs.current[n]?.focus();
  };
  return (
    <div className={st.tabsBar}>
      <div className={st.tabs} role="tablist" aria-label={t('xray.tabs.label')}>
        {MAP_TABS.map((id, i) => (
          <button
            key={id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            id={`tab-${id}`}
            type="button"
            role="tab"
            aria-selected={tab === id}
            aria-controls={`panel-${id}`}
            tabIndex={tab === id ? 0 : -1}
            className={st.tab}
            onClick={() => onTab(id)}
            onKeyDown={(e) => onKey(e, i)}
          >
            {t(`xray.tabs.${id}`)}
          </button>
        ))}
      </div>
    </div>
  );
}

/** A tab's panel: one sentence that says what this part is for, then its content. */
export function TabPanel({ id, lead, children }: { id: MapTab; lead: string; children: React.ReactNode }) {
  return (
    <section id={`panel-${id}`} role="tabpanel" aria-labelledby={`tab-${id}`} className={st.panel}>
      <p className={st.panelLead}>{lead}</p>
      {children}
    </section>
  );
}
