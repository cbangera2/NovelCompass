import type { LiveReleasePage } from '../../adapters/contracts';

export interface ChapterListProps {
  page: LiveReleasePage;
  onInvokeAction: (actionId: string) => void;
  onNavigate: (url: string) => void;
}

export function ChapterList({ page, onInvokeAction, onNavigate }: ChapterListProps): JSX.Element {
  return (
    <section className="series-section-card" aria-labelledby="chapters-heading">
      <header className="series-section-heading">
        <div>
          <p className="series-eyebrow">Live from Novel Updates</p>
          <h2 id="chapters-heading">Latest chapters</h2>
        </div>
        <span>Page {page.currentPage}</span>
      </header>

      {page.rows.length ? (
        <ol className="chapter-list">
          {page.rows.map((release, index) => (
            <li
              key={`${release.dateLabel}-${release.group.label}-${release.chapterLabel}-${index}`}
            >
              <button
                disabled={!release.isActionAvailable}
                onClick={() => onInvokeAction(release.actionId)}
                type="button"
              >
                <span className="chapter-label">{release.chapterLabel}</span>
                <span className="chapter-group">{release.group.label}</span>
                <time dateTime={release.dateIso}>{release.dateLabel}</time>
              </button>
              {!release.isActionAvailable ? (
                <small>Open the original view to use this chapter link.</small>
              ) : null}
            </li>
          ))}
        </ol>
      ) : (
        <div className="series-empty-state">
          <h3>No chapter releases found</h3>
          <p>The original Novel Updates page may have more information.</p>
        </div>
      )}

      {page.pageLinks.length > 1 || page.previousUrl || page.nextUrl ? (
        <nav className="chapter-pagination" aria-label="Chapter pages">
          {page.previousUrl ? (
            <PageButton label="Previous" url={page.previousUrl} onNavigate={onNavigate} />
          ) : null}
          {page.pageLinks.map((link) => (
            <PageButton
              current={link.page === page.currentPage}
              key={link.page}
              label={String(link.page)}
              url={link.url}
              onNavigate={onNavigate}
            />
          ))}
          {page.nextUrl ? (
            <PageButton label="Next" url={page.nextUrl} onNavigate={onNavigate} />
          ) : null}
        </nav>
      ) : null}
    </section>
  );
}

function PageButton({
  current = false,
  label,
  url,
  onNavigate,
}: {
  current?: boolean;
  label: string;
  url: string;
  onNavigate: (url: string) => void;
}): JSX.Element {
  return (
    <button
      aria-current={current ? 'page' : undefined}
      disabled={current}
      onClick={() => onNavigate(url)}
      type="button"
    >
      {label}
    </button>
  );
}
