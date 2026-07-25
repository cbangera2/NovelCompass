import { useEffect, useRef, useState } from 'react';
import { BookOpen, ExternalLink, Search, Shuffle, SlidersHorizontal, Star, Users, X } from 'lucide-react';
import { configuredDataMode, createDataSource, RecommendationDataSource } from './data';
import { BrowseNovel, BrowseSort, FilterOptions, NovelDetail } from './types';
import { browseFacetUrl } from './metadataLinks';
import './browse.css';
import { displayNovelTitle, useDisplaySettings } from './settings';
import { FieldGroup, Select, Tooltip } from './ui';
import { Badge, Card, CardHeader, DSButton, Skeleton } from './design-system';
import { NovelInsightsPanel } from './NovelInsightsPanel';
import { novelPageUrl } from './novelLinks';

const PAGE_SIZE = 24;

export default function BrowsePage(): JSX.Element {
  const { settings } = useDisplaySettings();
  const initialParams = new URLSearchParams(window.location.search);
  const [source, setSource] = useState<RecommendationDataSource | null>(null);
  const [options, setOptions] = useState<FilterOptions>({ genres: [] });
  const [items, setItems] = useState<BrowseNovel[]>([]);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<BrowseSort>('popular');
  const [language, setLanguage] = useState(initialParams.get('language') || '');
  const [author, setAuthor] = useState(initialParams.get('author') || '');
  const [genre, setGenre] = useState(initialParams.get('genre') || '');
  const [tag, setTag] = useState(initialParams.get('tag') || '');
  const [minRating, setMinRating] = useState(0);
  const [minVotes, setMinVotes] = useState(0);
  const [page, setPage] = useState(1);
  const [retryToken, setRetryToken] = useState(0);
  const [total, setTotal] = useState(0);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [tagSupported, setTagSupported] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [batchError, setBatchError] = useState('');
  const [observerSupported] = useState(() => typeof window !== 'undefined' && 'IntersectionObserver' in window);
  const [detail, setDetail] = useState<NovelDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [luckyLoading, setLuckyLoading] = useState(false);
  const requestRef = useRef(0);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const loadRequestedRef = useRef(false);

  useEffect(() => {
    createDataSource(configuredDataMode()).then(async (next) => {
      setSource(next);
      setOptions(await next.getOptions());
    }).catch((reason) => setError(reason.message || 'Could not load the catalog.'));
  }, []);

  useEffect(() => {
    if (!source) return;
    const requestId = ++requestRef.current;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      if (page === 1) setError('');
      setBatchError('');
      try {
        const result = await source.browseNovels({
          query, sort, language, author, genre, tag, min_rating: minRating,
          min_votes: minVotes, page, page_size: PAGE_SIZE
        });
        if (requestId !== requestRef.current) return;
        setItems((current) => page === 1 ? result.items : [...current, ...result.items]);
        setTotal(result.total);
        setHasLoaded(true);
        setHasMore(result.has_more);
        setTagSupported(result.capabilities.tags);
      } catch (reason: any) {
        if (requestId === requestRef.current) {
          const message = reason.message || 'Could not browse novels.';
          if (page > 1) setBatchError(message);
          else setError(message);
        }
      } finally {
        if (requestId === requestRef.current) {
          setLoading(false);
          loadRequestedRef.current = false;
        }
      }
    }, query ? 180 : 0);
    return () => window.clearTimeout(timer);
  }, [source, query, sort, language, author, genre, tag, minRating, minVotes, page, retryToken]);

  const resetPage = (action: () => void) => {
    action();
    setPage(1);
    setBatchError('');
    loadRequestedRef.current = false;
  };

  const requestNextPage = () => {
    if (loading || !hasMore || loadRequestedRef.current) return;
    loadRequestedRef.current = true;
    setPage((value) => value + 1);
  };

  const retryBatch = () => {
    if (loading || loadRequestedRef.current) return;
    loadRequestedRef.current = true;
    setBatchError('');
    setRetryToken((value) => value + 1);
  };

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!observerSupported || !sentinel || !hasMore || batchError) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) requestNextPage();
      },
      { rootMargin: '500px 0px' }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
    // requestNextPage intentionally reads the latest render state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [observerSupported, hasMore, loading, batchError, page]);

  const browseRequest = () => ({
    query, sort, language, author, genre, tag,
    min_rating: minRating, min_votes: minVotes
  });

  const clearAll = () => resetPage(() => {
    setQuery(''); setLanguage(''); setAuthor(''); setGenre(''); setTag('');
    setMinRating(0); setMinVotes(0); setSort('popular');
  });

  const feelingLucky = async () => {
    if (!source) return;
    setLuckyLoading(true);
    setError('');
    try {
      const novel = await source.getRandomNovel(browseRequest());
      await openDetail(novel.id);
    } catch (reason: any) {
      setError(reason.message || 'Could not choose a random novel.');
    } finally {
      setLuckyLoading(false);
    }
  };

  const activeFilters = [
    query && { label: `Search: ${query}`, clear: () => setQuery('') },
    author && { label: `Author: ${author}`, clear: () => setAuthor('') },
    genre && { label: `Genre: ${genre}`, clear: () => setGenre('') },
    tag && { label: `Tag: ${tag}`, clear: () => setTag('') },
    language && { label: `Language: ${language}`, clear: () => setLanguage('') },
    minRating > 0 && { label: `Rating: ${minRating}★+`, clear: () => setMinRating(0) },
    minVotes > 0 && { label: `Votes: ${minVotes.toLocaleString()}+`, clear: () => setMinVotes(0) }
  ].filter(Boolean) as Array<{ label: string; clear: () => void }>;

  const openDetail = async (id: number) => {
    if (!source) return;
    setDetail(null);
    setDetailLoading(true);
    try {
      setDetail(await source.getNovel(id));
    } catch (reason: any) {
      setError(reason.message || 'Novel details are unavailable in this dataset.');
    } finally {
      setDetailLoading(false);
    }
  };

  return (
    <main className="browse-shell">
      <header className="browse-hero">
        <p className="eyebrow">The complete catalog</p>
        <h1>Browse your next world.</h1>
        <p>Explore every title in this snapshot. Popularity uses reading-list counts; highest rated uses the published rating and vote count.</p>
      </header>

      <Card className="browse-controls" aria-label="Catalog filters">
        <label className="browse-search"><Search size={17} /><input value={query}
          onChange={(event) => resetPage(() => setQuery(event.target.value))}
          placeholder="Search titles, aliases, or authors…" /></label>
        <Select label="Sort" value={sort} onChange={(event) => resetPage(() => setSort(event.target.value as BrowseSort))}>
          <option value="popular">Most popular</option>
          <option value="rating">Highest rated</option>
          <option value="votes">Most rated</option>
          <option value="newest">Newest year</option>
          <option value="title">Title A–Z</option>
        </Select>
        <DSButton variant="primary" className="browse-lucky" disabled={!source || luckyLoading} onClick={feelingLucky}>
          <Shuffle size={16} /> {luckyLoading ? 'Choosing…' : 'Feeling lucky'}
        </DSButton>
        <details className="browse-advanced">
          <summary><SlidersHorizontal size={16} /> More filters</summary>
          <FieldGroup label="Catalog metadata">
            <Select label="Genre" value={genre} onChange={(event) => resetPage(() => setGenre(event.target.value))}>
              <option value="">All genres</option>{options.genres.map((item) => <option key={item}>{item}</option>)}
            </Select>
            <Select label="Tag" value={tag} disabled={!options.tags?.length} onChange={(event) => resetPage(() => setTag(event.target.value))}>
              <option value="">All tags</option>{options.tags?.map((item) => <option key={item}>{item}</option>)}
            </Select>
            <Select label="Language" value={language} onChange={(event) => resetPage(() => setLanguage(event.target.value))}>
              <option value="">All languages</option>{options.languages?.map((item) => <option key={item}>{item}</option>)}
            </Select>
            <Select label="Minimum rating" value={minRating} onChange={(event) => resetPage(() => setMinRating(Number(event.target.value)))}>
              <option value="0">Any rating</option><option value="3">3★ and up</option><option value="4">4★ and up</option><option value="4.5">4.5★ and up</option>
            </Select>
            <Select label="Minimum votes" value={minVotes} onChange={(event) => resetPage(() => setMinVotes(Number(event.target.value)))}>
              <option value="0">Any vote count</option><option value="10">10+ votes</option><option value="100">100+ votes</option><option value="1000">1,000+ votes</option>
            </Select>
          </FieldGroup>
        </details>
      </Card>
      {activeFilters.length > 0 && <div className="browse-active-filters" aria-label="Active filters">
        {activeFilters.map((filter) => <DSButton variant="ghost" key={filter.label} onClick={() => resetPage(filter.clear)}>{filter.label}<X size={12} /></DSButton>)}
        <DSButton variant="ghost" className="clear-all" onClick={clearAll}>Clear all</DSButton>
      </div>}

      {!tagSupported && <p className="browse-notice">Tag filtering is unavailable in this static snapshot, so the selected tag was not applied.</p>}
      <div className="browse-results-header">
        <CardHeader title="Novels" eyebrow="Catalog results" description={hasLoaded ? `${total.toLocaleString()} matches in this snapshot` : 'Loading catalog status'} />
      </div>
      {error && <p className="browse-error">{error}</p>}
      <section className="browse-grid" aria-busy={loading && page === 1}>
        {items.map((novel) => <BrowseCard key={novel.id} novel={novel} onQuickLook={() => openDetail(novel.id)} />)}
        {loading && page === 1 && Array.from({ length: 6 }, (_, index) => <Card className="browse-card browse-card-skeleton" key={index}><Skeleton /><div><Skeleton /><Skeleton /><Skeleton /></div></Card>)}
      </section>
      {!loading && hasLoaded && !items.length && !error && <p className="browse-empty">No novels match these filters.</p>}
      <div ref={sentinelRef} className="browse-sentinel" aria-hidden="true" />
      <div className="browse-page-status" role="status" aria-live="polite">
        {loading && <div className="browse-loading"><span /> Loading {page > 1 ? 'more novels' : 'catalog'}…</div>}
        {batchError && <div className="browse-batch-error"><span>{batchError}</span><DSButton onClick={retryBatch}>Retry loading more</DSButton></div>}
        {hasMore && !loading && !batchError && !observerSupported && (
          <div className="browse-pagination"><DSButton className="browse-more" onClick={requestNextPage}>Load {PAGE_SIZE} more</DSButton><span>Showing {items.length.toLocaleString()} of {total.toLocaleString()}</span></div>
        )}
        {hasMore && observerSupported && !batchError && <span className="sr-only">More novels load automatically as you scroll.</span>}
        {hasLoaded && !hasMore && items.length > 0 && <p className="browse-end">End of results · {items.length.toLocaleString()} novels shown</p>}
      </div>

      {(detailLoading || detail) && <div className="browse-modal-backdrop" onMouseDown={() => setDetail(null)}>
        <article className="browse-modal" onMouseDown={(event) => event.stopPropagation()}>
          <button className="browse-close" onClick={() => setDetail(null)} aria-label="Close details"><X /></button>
          {detailLoading && !detail ? <p>Loading details…</p> : detail && <>
            {detail.cover_url && <img src={detail.cover_url} alt="" />}
            <div><p className="eyebrow">{detail.language
              ? <a href={browseFacetUrl('language', detail.language)}>{detail.language}</a>
              : 'Language unknown'}{detail.year ? ` · ${detail.year}` : ''}</p>
              <h2>{displayNovelTitle(detail.title, detail.associated_names, settings.titlePreference)}</h2><p>{detail.author
                ? <a href={browseFacetUrl('author', detail.author)}>{detail.author}</a>
                : 'Unknown author'}</p>
              <p>{detail.synopsis || 'No synopsis is available in this dataset.'}</p>
              <div className="browse-chips">{detail.genres.map((item) => <a key={item} href={browseFacetUrl('genre', item)}>{item}</a>)}</div>
              <div className="browse-chips browse-tag-chips">{detail.tags.map((item) => <a key={item} href={browseFacetUrl('tag', item)}>{item}</a>)}</div>
              {source && <NovelInsightsPanel novelId={detail.id} source={source} onPeer={openDetail} />}
              <footer>
                <a href={`${import.meta.env.BASE_URL}?seed=${detail.id}`}>Find similar</a>
                <a href={detail.novelupdates_url} target="_blank" rel="noopener noreferrer">Novel Updates <ExternalLink size={14} /></a>
              </footer>
            </div>
          </>}
        </article>
      </div>}
    </main>
  );
}

function BrowseCard({ novel, onQuickLook }: { novel: BrowseNovel; onQuickLook: () => void }) {
  const { settings } = useDisplaySettings();
  const title = displayNovelTitle(novel.title, undefined, settings.titlePreference);
  return <Card className="browse-card">
    <a className="browse-cover" href={novelPageUrl(novel.id)}>
      {novel.cover_url ? <img src={novel.cover_url} alt="" loading="lazy" /> : <BookOpen />}
    </a>
    <div>
      <a className="browse-title" href={novelPageUrl(novel.id)}>{title}</a>
      <p>{novel.author ? <a href={browseFacetUrl('author', novel.author)}>{novel.author}</a> : 'Unknown author'}</p>
      <div className="browse-meta"><Badge tone="amber"><Star size={14} /> {novel.rating ? novel.rating.toFixed(1) : '—'} <small>({novel.rating_votes.toLocaleString()})</small></Badge>
        <Badge><Users size={14} /> {novel.reading_list_count.toLocaleString()}</Badge></div>
      <div className="browse-chips">{novel.genres?.slice(0, 3).map((item) => <a key={item} href={browseFacetUrl('genre', item)}>{item}</a>)}</div>
      <footer className="browse-card-actions">
        <DSButton variant="ghost" className="browse-quick-look" onClick={onQuickLook}>
          <Search size={14} aria-hidden="true" /> Quick look
        </DSButton>
        <Tooltip content="Open the full novel page">
          <DSButton as="a" variant="ghost" className="browse-icon-action" href={novelPageUrl(novel.id)} aria-label={`Open the full page for ${title}`}>
            <BookOpen size={16} aria-hidden="true" />
          </DSButton>
        </Tooltip>
        <Tooltip content="Open on Novel Updates">
          <DSButton as="a" variant="ghost" className="browse-icon-action" href={novel.novelupdates_url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${title} on Novel Updates`}>
            <ExternalLink size={16} aria-hidden="true" />
          </DSButton>
        </Tooltip>
      </footer>
    </div>
  </Card>;
}
