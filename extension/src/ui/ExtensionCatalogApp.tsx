import { ArrowLeft, ArrowRight, BookOpen, ExternalLink, Star } from 'lucide-react';

import type { LiveCatalogPage } from '../adapters/contracts';
import './extension-catalog.css';

export interface ExtensionCatalogAppProps {
  page: LiveCatalogPage;
  onShowOriginal: () => void;
}

export function ExtensionCatalogApp({
  page,
  onShowOriginal,
}: ExtensionCatalogAppProps): JSX.Element {
  return (
    <main className="novel-compass-catalog">
      <header className="extension-catalog-hero">
        <div>
          <p>Live Novel Updates catalog</p>
          <h1>{page.title}</h1>
          <span>{page.subtitle ?? 'Browse novels using Novel Updates’ current catalog.'}</span>
        </div>
        <button type="button" onClick={onShowOriginal}>
          Original view
        </button>
      </header>

      <section className="extension-catalog-results" aria-label={`${page.title} novels`}>
        <div className="extension-catalog-results-heading">
          <div>
            <p>Novel Updates results</p>
            <h2>{page.rows.length} novels on this page</h2>
          </div>
          <span>Page {page.currentPage}</span>
        </div>
        <ol>
          {page.rows.map((row) => (
            <li key={row.seriesUrl}>
              <a className="extension-catalog-cover" href={row.seriesUrl}>
                {row.coverUrl ? <img alt="" src={row.coverUrl} /> : <BookOpen aria-hidden="true" />}
              </a>
              <article>
                <div className="extension-catalog-title-row">
                  <div>
                    {row.language ? <p>{row.language}</p> : null}
                    <h3>
                      <a href={row.seriesUrl}>{row.title}</a>
                    </h3>
                  </div>
                  {row.rating !== undefined ? (
                    <span className="extension-catalog-rating">
                      <Star aria-hidden="true" size={15} />
                      {row.rating.toFixed(1)}
                    </span>
                  ) : null}
                </div>
                {row.description ? (
                  <p className="extension-catalog-description">{row.description}</p>
                ) : null}
                {row.genres.length ? (
                  <div className="extension-catalog-genres">
                    {row.genres.map((genre) => (
                      <a href={genre.url} key={genre.url ?? genre.label}>
                        {genre.label}
                      </a>
                    ))}
                  </div>
                ) : null}
                {row.latestChapter ? (
                  row.latestChapter.url ? (
                    <a className="extension-catalog-chapter" href={row.latestChapter.url}>
                      Latest: {row.latestChapter.label}
                      <ExternalLink size={13} />
                    </a>
                  ) : (
                    <span className="extension-catalog-chapter">
                      Latest: {row.latestChapter.label}
                    </span>
                  )
                ) : null}
              </article>
            </li>
          ))}
        </ol>
      </section>

      <nav className="extension-catalog-pagination" aria-label="Catalog pages">
        {page.previousUrl ? (
          <a href={page.previousUrl}>
            <ArrowLeft size={16} /> Previous
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
            Next <ArrowRight size={16} />
          </a>
        ) : (
          <span />
        )}
      </nav>
    </main>
  );
}
