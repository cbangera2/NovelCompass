import { ArrowLeft, ArrowRight, BookOpen, ExternalLink } from 'lucide-react';

import type { LiveHomePage } from '../adapters/contracts';
import './extension-home.css';

export interface ExtensionHomeAppProps {
  page: LiveHomePage;
  onInvokeAction: (actionId: string) => void;
  onShowOriginal: () => void;
}

export function ExtensionHomeApp({
  page,
  onInvokeAction,
  onShowOriginal,
}: ExtensionHomeAppProps): JSX.Element {
  return (
    <main className="extension-home">
      <header className="extension-home-header">
        <div>
          <p>Live from Novel Updates</p>
          <h1>Latest releases</h1>
          <span>{page.dateLabel ?? `Page ${page.currentPage}`}</span>
        </div>
        <button type="button" onClick={onShowOriginal}>
          Original view
        </button>
      </header>

      <div className="extension-home-layout">
        <section className="extension-home-feed" aria-labelledby="latest-releases-heading">
          <div className="extension-home-section-heading">
            <div>
              <p>Recently updated</p>
              <h2 id="latest-releases-heading">{page.rows.length} chapter releases</h2>
            </div>
            <span>Page {page.currentPage}</span>
          </div>
          <div className="extension-home-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Chapter</th>
                  <th>Group</th>
                </tr>
              </thead>
              <tbody>
                {page.rows.map((row, index) => (
                  <tr key={`${row.seriesUrl}-${row.chapterLabel}-${index}`}>
                    <td>
                      <a href={row.seriesUrl}>{row.title}</a>
                    </td>
                    <td>
                      {row.chapterActionId ? (
                        <button
                          type="button"
                          onClick={() => onInvokeAction(row.chapterActionId!)}
                        >
                          {row.chapterLabel}
                          <ExternalLink aria-hidden="true" size={13} />
                        </button>
                      ) : (
                        <span>{row.chapterLabel}</span>
                      )}
                    </td>
                    <td>
                      {row.group.url ? (
                        <a href={row.group.url}>{row.group.label}</a>
                      ) : (
                        row.group.label
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {page.latestSeries.length ? (
          <aside className="extension-home-latest" aria-labelledby="latest-series-heading">
            <div className="extension-home-section-heading">
              <div>
                <p>New to the catalog</p>
                <h2 id="latest-series-heading">Latest series</h2>
              </div>
            </div>
            <ol>
              {page.latestSeries.slice(0, 10).map((series) => (
                <li key={series.url ?? series.label}>
                  <BookOpen aria-hidden="true" size={16} />
                  {series.url ? <a href={series.url}>{series.label}</a> : series.label}
                </li>
              ))}
            </ol>
          </aside>
        ) : null}
      </div>

      <nav className="extension-home-pagination" aria-label="Release pages">
        {page.previousUrl ? (
          <a href={page.previousUrl}>
            <ArrowLeft size={15} /> Previous
          </a>
        ) : (
          <span />
        )}
        <div>
          {page.pageLinks.map((link) => (
            <a
              aria-current={link.page === page.currentPage ? 'page' : undefined}
              href={link.url}
              key={link.page}
            >
              {link.page}
            </a>
          ))}
        </div>
        {page.nextUrl ? (
          <a href={page.nextUrl}>
            Next <ArrowRight size={15} />
          </a>
        ) : (
          <span />
        )}
      </nav>
    </main>
  );
}
