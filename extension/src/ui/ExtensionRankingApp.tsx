import { ArrowLeft, ArrowRight, BookOpen, CalendarDays, Star, Users } from 'lucide-react';

import type { LiveRankingPage } from '../adapters/contracts';
import './extension-ranking.css';

export interface ExtensionRankingAppProps {
  page: LiveRankingPage;
  onNavigate: (url: string) => void;
  onShowOriginal: () => void;
}

export function ExtensionRankingApp({
  page,
  onNavigate,
  onShowOriginal,
}: ExtensionRankingAppProps): JSX.Element {
  const selectedLanguages = page.filters.languages.filter((option) => option.selected);
  const selectedStatuses = page.filters.storyStatuses.filter((option) => option.selected);
  const selectedGenres = page.filters.genres.filter((option) => option.selected);

  return (
    <main className="novel-compass-ranking">
      <header className="extension-ranking-hero">
        <div>
          <p>Live Novel Updates data</p>
          <h1>{page.title}</h1>
          <span>Rankings retain Novel Updates’ own popularity and activity calculations.</span>
        </div>
        <button type="button" onClick={onShowOriginal}>
          Refine in original view
        </button>
      </header>

      <section className="extension-ranking-controls" aria-label="Ranking controls">
        <div className="extension-ranking-types">
          {page.filters.rankingTypes.map((option) => (
            <button
              aria-pressed={option.selected}
              className={option.selected ? 'is-active' : undefined}
              key={option.value}
              onClick={() =>
                onNavigate(
                  `https://www.novelupdates.com/series-ranking/?rank=${encodeURIComponent(option.value)}`,
                )
              }
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="extension-ranking-filter-summary">
          {page.filters.minimumChapters ? (
            <span>{page.filters.minimumChapters}+ chapters</span>
          ) : null}
          {selectedLanguages.map((option) => (
            <span key={`language-${option.value}`}>{option.label}</span>
          ))}
          {selectedStatuses.map((option) => (
            <span key={`status-${option.value}`}>{option.label}</span>
          ))}
          {selectedGenres.map((option) => (
            <span
              className={option.excluded ? 'is-excluded' : undefined}
              key={`genre-${option.value}`}
            >
              {option.excluded ? 'Not ' : ''}
              {option.label}
            </span>
          ))}
        </div>
      </section>

      <section className="extension-ranking-results" aria-label="Ranked novels">
        <div className="extension-ranking-results-heading">
          <div>
            <p>{page.activeRankingLabel ?? 'Current ranking'}</p>
            <h2>Top novels</h2>
          </div>
          <span>Page {page.currentPage}</span>
        </div>
        <ol start={page.rows[0]?.rank ?? 1}>
          {page.rows.map((row) => (
            <li key={`${row.rank}-${row.seriesUrl}`}>
              <span className="extension-ranking-number" aria-label={`Rank ${row.rank}`}>
                {row.rank}
              </span>
              <a className="extension-ranking-cover" href={row.seriesUrl}>
                {row.coverUrl ? <img alt="" src={row.coverUrl} /> : <BookOpen aria-hidden="true" />}
              </a>
              <article>
                <div className="extension-ranking-title-row">
                  <div>
                    {row.language ? <p>{row.language}</p> : null}
                    <h3>
                      <a href={row.seriesUrl}>{row.title}</a>
                    </h3>
                  </div>
                  {row.rating !== undefined ? (
                    <span className="extension-ranking-rating">
                      <Star aria-hidden="true" size={15} />
                      {row.rating.toFixed(1)}
                    </span>
                  ) : null}
                </div>
                {row.description ? (
                  <p className="extension-ranking-description">{row.description}</p>
                ) : null}
                {row.genres.length ? (
                  <div className="extension-ranking-genres">
                    {row.genres.map((genre) =>
                      genre.url ? (
                        <a href={genre.url} key={genre.url}>
                          {genre.label}
                        </a>
                      ) : (
                        <span key={genre.label}>{genre.label}</span>
                      ),
                    )}
                  </div>
                ) : null}
                <dl>
                  {row.chapterCount !== undefined ? (
                    <Stat label="Chapters" value={row.chapterCount.toLocaleString()} />
                  ) : null}
                  {row.readerCount !== undefined ? (
                    <Stat
                      icon={<Users size={14} />}
                      label="Readers"
                      value={row.readerCount.toLocaleString()}
                    />
                  ) : null}
                  {row.reviewCount !== undefined ? (
                    <Stat label="Reviews" value={row.reviewCount.toLocaleString()} />
                  ) : null}
                  {row.lastUpdated ? (
                    <Stat
                      icon={<CalendarDays size={14} />}
                      label="Updated"
                      value={row.lastUpdated}
                    />
                  ) : null}
                </dl>
              </article>
            </li>
          ))}
        </ol>
      </section>

      <nav className="extension-ranking-pagination" aria-label="Ranking pages">
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

function Stat({
  icon,
  label,
  value,
}: {
  icon?: JSX.Element;
  label: string;
  value: string;
}): JSX.Element {
  return (
    <div>
      <dt>
        {icon}
        {label}
      </dt>
      <dd>{value}</dd>
    </div>
  );
}
