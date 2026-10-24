import { useEffect, useMemo, useState } from 'react';
import { BookOpen, Search, Sparkles } from 'lucide-react';
import type { RecommendationDataSource } from '../data';
import type { NovelSearchResult } from '../types';
import { Card, DSButton } from '../design-system';
import { Tooltip } from '../ui';
import { novelPageUrl } from '../novelLinks';
import { NovelCard } from '../components/NovelCard';
import { StatusBadge } from '../components/StatusBadge';
import { ResultLayoutToggle } from '../components/ResultLayoutToggle';
import { loadResultLayout, saveResultLayout, type ResultLayout } from '../preferences';
import type { LocalUserProfile, ProfileEntry, ReadingStatus } from './types';

export const STATUS_LABELS: Record<ReadingStatus, string> = {
  reading: 'Reading',
  completed: 'Completed',
  plan_to_read: 'Plan to read',
  dropped: 'Dropped',
  paused: 'Paused',
};

function appUrl(params = ''): string {
  return `${import.meta.env.BASE_URL}${params}`;
}

export function ProfileLibrary({
  profile,
  source,
  counts,
}: {
  profile: LocalUserProfile;
  source: RecommendationDataSource | null;
  counts: Record<ReadingStatus, number>;
}): JSX.Element {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'all' | ReadingStatus>('all');
  const [rating, setRating] = useState(0);
  const [visibleCount, setVisibleCount] = useState(60);
  const [catalog, setCatalog] = useState<Map<string, NovelSearchResult>>(new Map());
  const [layout, setLayoutState] = useState<ResultLayout>(loadResultLayout);
  const setLayout = (next: ResultLayout) => {
    setLayoutState(next);
    saveResultLayout(next);
  };

  const entries = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return profile.entries
      .filter((entry) => status === 'all' || entry.status === status)
      .filter((entry) => !rating || (entry.rating || 0) >= rating)
      .filter((entry) => !needle || entry.imported_title.toLocaleLowerCase().includes(needle) || entry.slug.includes(needle))
      .sort((a, b) => (b.rating || 0) - (a.rating || 0) || a.imported_title.localeCompare(b.imported_title));
  }, [profile, query, rating, status]);
  const visibleEntries = useMemo(() => entries.slice(0, visibleCount), [entries, visibleCount]);

  useEffect(() => {
    setVisibleCount(60);
  }, [query, rating, status]);

  useEffect(() => {
    if (!source || !visibleEntries.length) {
      setCatalog(new Map());
      return;
    }
    let cancelled = false;
    source.resolveSlugs(visibleEntries.filter((entry) => entry.novel_id != null).map((entry) => ({
      slug: entry.slug,
      title: entry.imported_title,
    }))).then((resolved) => {
      if (!cancelled) setCatalog(resolved);
    }).catch(() => {
      if (!cancelled) setCatalog(new Map());
    });
    return () => { cancelled = true; };
  }, [source, visibleEntries]);

  const open = (entry: ProfileEntry) => {
    if (entry.novel_id != null) window.location.href = novelPageUrl(entry.novel_id);
  };

  const statusChips: Array<['all' | ReadingStatus, string, number]> = [
    ['all', 'All', profile.entries.length],
    ...(Object.keys(STATUS_LABELS) as ReadingStatus[]).map((value): ['all' | ReadingStatus, string, number] => [value, STATUS_LABELS[value], counts[value]]),
  ];

  return (
    <Card className="profile-library-section">
      <div className="profile-library-heading">
        <div><span className="eyebrow">Personal shelf</span><h2>Library</h2></div>
        <div className="profile-library-heading-actions">
          <span className="profile-library-count">{entries.length.toLocaleString()} shown</span>
          <ResultLayoutToggle value={layout} onChange={setLayout} />
        </div>
      </div>
      <div className="profile-status-chips" role="group" aria-label="Filter by status">
        {statusChips.map(([value, label, count]) => (
          <button
            key={value}
            type="button"
            aria-pressed={status === value}
            disabled={value !== 'all' && count === 0}
            onClick={() => setStatus(value)}
          >
            {label} <small>{count.toLocaleString()}</small>
          </button>
        ))}
      </div>
      <div className="profile-library-controls">
        <label><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search your library…" aria-label="Search your library" /></label>
        <select value={rating} onChange={(event) => setRating(Number(event.target.value))} aria-label="Minimum rating">
          <option value="0">Any rating</option>
          <option value="3">3★ and up</option>
          <option value="4">4★ and up</option>
          <option value="5">5★ only</option>
        </select>
      </div>
      {layout === 'compact' ? (
        <div className="nc-grid profile-library-tiles">
          {visibleEntries.map((entry) => {
            const meta = catalog.get(entry.slug);
            if (entry.novel_id == null) {
              return (
                <article key={entry.slug} className="nc nc-tile profile-tile-unmatched">
                  <span className="nc-cover">
                    <span className="nc-cover-fallback" aria-hidden="true">{entry.imported_title.slice(0, 1) || <BookOpen />}</span>
                    <StatusBadge status={entry.status} variant="overlay" />
                  </span>
                  <strong className="nc-title" title={entry.imported_title}>{entry.imported_title}</strong>
                  <small className="nc-caption">Not in this snapshot</small>
                </article>
              );
            }
            return (
              <NovelCard
                key={entry.slug}
                variant="tile"
                item={{
                  id: entry.novel_id,
                  title: entry.imported_title,
                  href: novelPageUrl(entry.novel_id),
                  coverUrl: meta?.cover_url,
                  mediaType: meta?.media_type,
                  source: meta?.source,
                  author: meta?.author,
                  rating: entry.rating,
                }}
                libraryStatus={entry.status}
                coverFormat
                caption={entry.progress || undefined}
                actions={(
                  <Tooltip content="Find similar titles">
                    <DSButton
                      as="a"
                      variant="ghost"
                      className="browse-icon-action"
                      href={appUrl(`?seed=${entry.novel_id}`)}
                      aria-label={`Find titles similar to ${entry.imported_title}`}
                    >
                      <Sparkles size={16} aria-hidden="true" />
                    </DSButton>
                  </Tooltip>
                )}
              />
            );
          })}
        </div>
      ) : (
        <div className="profile-entry-grid">
          {visibleEntries.map((entry) => {
            const meta = catalog.get(entry.slug);
            const body = (
              <>
                <div className="profile-entry-cover">
                  {meta?.cover_url
                    ? <img src={meta.cover_url} alt="" loading="lazy" />
                    : <BookOpen size={18} aria-hidden="true" />}
                </div>
                <div>
                  <span className={`profile-status status-${entry.status}`}>{STATUS_LABELS[entry.status]}</span>
                  <h3>{entry.imported_title}</h3>
                  <p>
                    {entry.rating ? `${entry.rating}★` : 'No personal rating'}
                    {entry.progress ? ` · ${entry.progress}` : ''}
                  </p>
                </div>
              </>
            );
            return (
              <article key={entry.slug} className={`profile-entry ${entry.novel_id == null ? 'unmatched' : ''}`} data-preview-id={entry.novel_id ?? undefined}>
                {entry.novel_id != null
                  ? <button className="profile-entry-open" onClick={() => open(entry)} aria-label={`Open details for ${entry.imported_title}`}>{body}</button>
                  : <div className="profile-entry-open">{body}</div>}
                {entry.novel_id != null
                  ? <a href={appUrl(`?seed=${entry.novel_id}`)}><Sparkles size={14} /> Find similar</a>
                  : <span className="profile-unmatched">Not in this snapshot</span>}
              </article>
            );
          })}
        </div>
      )}
      {!entries.length && <p className="profile-no-results">No library titles match those filters.</p>}
      {visibleCount < entries.length && <button className="profile-load-more" onClick={() => setVisibleCount((count) => count + 60)}>Show 60 more</button>}
    </Card>
  );
}
