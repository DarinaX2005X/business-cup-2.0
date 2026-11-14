import Link from 'next/link';
import { Wordmark } from '@/components/kit/Mark';
import { LocaleSwitcher } from '@/i18n/LocaleSwitcher';
import ctl from '@/components/kit/controls.module.css';
import st from './public.module.css';

export interface ChromeLabels {
  home: string;
  method: string;
  jobs: string;
  start: string;
  nav: string;
}

/** Header of the public pages: mark, the two reading destinations and the way into the product. */
export function PublicHeader({ labels, current, locale = false }: { labels: ChromeLabels; current: 'method' | 'jobs'; locale?: boolean }) {
  return (
    <header className={st.header}>
      <div className={st.headerIn}>
        <Link href="/" className={st.brand} aria-label={labels.home}>
          <Wordmark size={34} />
        </Link>
        <nav className={st.nav} aria-label={labels.nav}>
          <Link href="/method" className={st.navLink} aria-current={current === 'method' ? 'page' : undefined}>
            {labels.method}
          </Link>
          <Link href="/jobs" className={st.navLink} aria-current={current === 'jobs' ? 'page' : undefined}>
            {labels.jobs}
          </Link>
        </nav>
        <div className={st.headerEnd}>
          {locale ? <LocaleSwitcher className={st.locale} id="public-locale" /> : null}
          <Link href="/start" className={`${ctl.btn} ${ctl.b_primary} ${ctl.s_sm} ${st.headerCta}`}>
            {labels.start}
          </Link>
        </div>
      </div>
    </header>
  );
}

export interface FooterSource {
  id: string;
  name: string;
  version: string;
  license: string;
  url: string;
}

export function PublicFooter({ title, sources, methodLabel, note }: { title: string; sources: FooterSource[]; methodLabel: string; note: string }) {
  return (
    <footer className={st.footer}>
      <div className={st.footerIn}>
        <div className={st.footerBrand}>
          <Wordmark size={30} />
          <p>{note}</p>
          <Link href="/method#sources" className={st.textLink}>
            {methodLabel}
          </Link>
        </div>
        <div>
          <h2 className={st.footerTitle}>{title}</h2>
          <ul className={st.footerSources}>
            {sources.map((s) => (
              <li key={s.id}>
                <a href={s.url} target="_blank" rel="noreferrer" className={st.textLink}>
                  {s.name}
                </a>
                <span>
                  {s.version}, {s.license}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </footer>
  );
}
