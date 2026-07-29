import { ArrowLeft, ArrowRight, BookOpen, ExternalLink, Search } from 'lucide-react';
import { useMemo, useState } from 'react';

import type { LiveReadingLibraryPage } from '../adapters/contracts';
import './extension-reading-library.css';

export interface ExtensionReadingLibraryAppProps {
  page: LiveReadingLibraryPage;
  onShowOriginal: () => void;
}

export function ExtensionReadingLibraryApp({
  page,
  onShowOriginal,
}: ExtensionReadingLibraryAppProps): JSX.Element {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const statuses = useMemo(
    () => [...new Set(page.rows.map((row) => row.statusLabel).filter(Boolean) as string[])].sort(),
    [page.rows],
  );
  const visibleRows = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return page.rows.filter(
      (row) =>
        (!normalizedQuery || row.title.toLocaleLowerCase().includes(normalizedQuery)) &&
        (!status || row.statusLabel === status),
    );
  }, [page.rows, query, status]);

  return (
    <main className="novel-compass-reading-library-app">
      <header className="extension-library-hero">
        <div>
          <p>Your live Novel Updates account</p>
          <h1>{page.title}</h1>
          <span>Keep up with every story without giving up Novel Updates’ chapter links.</span>
        </div>
        <button type="button" onClick={onShowOriginal}>
          Manage list
        </button>
      </header>

      {page.tabs.length ? (
        <nav className="extension-library-tabs" aria-label="Reading lists">
          {page.tabs.map((tab) => (
            <a aria-current={tab.selected ? 'page' : undefined} href={tab.url} key={tab.url}>
              {tab.label}
              {tab.count !== undefined ? <span>{tab.count.toLocaleString()}</span> : null}
            </a>
          ))}
        </nav>
      ) : null}

      <section className="extension-library-controls" aria-label="Filter this page">
        <label>
          <span>Search this page</span>
          <div>
            <Search aria-hidden="true" size={17} />
            <input
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search saved titles"
              type="search"
              value={query}
            />
          </div>
        </label>
        {statuses.length ? (
          <label>
            <span>Series status</span>
            <select onChange={(event) => setStatus(event.target.value)} value={status}>
              <option value="">All statuses</option>
              {statuses.map((option) => <option key={option}>{option}</option>)}
            </select>
          </label>
        ) : null}
        <p>
          Showing <strong>{visibleRows.length}</strong> of {page.rows.length} titles on page{' '}
          {page.currentPage}
        </p>
      </section>

      <section className="extension-library-results" aria-label="Saved novels">
        {visibleRows.length ? (
          <ol>
            {visibleRows.map((row) => (
              <li key={row.seriesUrl}>
                <a className="extension-library-cover" href={row.seriesUrl}>
                  {row.coverUrl ? <img alt="" loading="lazy" src={row.coverUrl} /> : <BookOpen aria-hidden="true" />}
                </a>
                <article>
                  <div className="extension-library-title-row">
                    <div>
                      {row.listLabel ? <p>{row.listLabel}</p> : null}
                      <h2><a href={row.seriesUrl}>{row.title}</a></h2>
                    </div>
                    {row.statusLabel ? <span>{row.statusLabel}</span> : null}
                  </div>
                  <dl>
                    {row.progressLabel ? <Stat label="Your progress" value={row.progressLabel} /> : null}
                    {row.updatedAt ? <Stat label="Updated" value={row.updatedAt} /> : null}
                  </dl>
                  {row.latestRelease ? (
                    row.latestRelease.url ? (
                      <a className="extension-library-latest" href={row.latestRelease.url}>
                        Continue with {row.latestRelease.label}
                        <ExternalLink aria-hidden="true" size={14} />
                      </a>
                    ) : <span className="extension-library-latest">{row.latestRelease.label}</span>
                  ) : null}
                </article>
              </li>
            ))}
          </ol>
        ) : <p className="extension-library-empty">No titles on this page match those filters.</p>}
      </section>

      <aside className="extension-library-safety">
        Moving, deleting, or updating reading progress remains in Original View so Novel Updates
        keeps ownership of its authenticated controls.
        <button type="button" onClick={onShowOriginal}>Open list controls</button>
      </aside>

      <nav className="extension-library-pagination" aria-label="Library pages">
        {page.previousUrl ? <a href={page.previousUrl}><ArrowLeft size={16} /> Previous</a> : <span />}
        <div>
          {page.pageLinks.map((link) => (
            <a aria-current={link.page === page.currentPage ? 'page' : undefined} href={link.url} key={link.page}>
              {link.page}
            </a>
          ))}
        </div>
        {page.nextUrl ? <a href={page.nextUrl}>Next <ArrowRight size={16} /></a> : <span />}
      </nav>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }): JSX.Element {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}
