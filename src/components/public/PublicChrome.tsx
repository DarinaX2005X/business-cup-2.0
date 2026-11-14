import Link from 'next/link';
import { Wordmark } from '@/components/kit/Mark';
import { MarketingHeader } from './MarketingHeader';
import st from './public.module.css';

export interface ChromeLabels {
  home: string;
  method: string;
  jobs: string;
  start: string;
  nav: string;
}

/**
 * Header of the public pages: the shared marketing header (same logo and right side as the app).
 * `labels` and `locale` are kept for older callers; the header carries its own English copy.
 */
export function PublicHeader({ current }: { labels?: ChromeLabels; current: 'method' | 'jobs'; locale?: boolean }) {
  return <MarketingHeader current={current} />;
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
