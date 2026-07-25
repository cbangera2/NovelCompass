import { useEffect, useRef, useState } from 'react';
import { ArrowDownUp, BookOpen, ExternalLink, LayoutGrid, List, Search, Shuffle, SlidersHorizontal, Sparkles, Star, Users, X } from 'lucide-react';
import { createDataSource, RecommendationDataSource } from './data';
import { useDataModePreference } from './dataModePreference';
import { stableRouteUrl } from './routeState';
import { BrowseNovel, BrowseSort, BrowseSortDirection, FilterOptions } from './types';
import { browseFacetUrl } from './metadataLinks';
import './browse.css';
import { displayNovelTitle, useDisplaySettings } from './settings';
import { FieldGroup, Select, Tooltip } from './ui';
import { Badge, Card, CardHeader, DSButton, Skeleton } from './design-system';
import { novelPageUrl } from './novelLinks';
import { loadLocalProfile } from './profile/store';
import { loadFilterSnapshot, saveFilterSnapshot } from './preferences';

const PAGE_SIZE = 24;

export default function BrowsePage(): JSX.Element {
  const { mode: dataMode } = useDataModePreference();
  const initialParams = new URLSearchParams(window.location.search);
  const saved = loadFilterSnapshot('browse', {
    query: '', sort: 'popular', direction: 'desc', language: '', author: '', genre: '', tag: '',
    minRating: 0, maxRating: 0, minVotes: 0, minYear: 0, maxYear: 0, status: '',
    minChapters: 0, maxChapters: 0, minReaders: 0, maxReaders: 0, includeGenres: '',
    excludeGenres: '', includeTags: '', excludeTags: '', excludeLibrary: false, density: 'grid'
  });
  const savedSort: BrowseSort = ['popular', 'rating', 'votes', 'title', 'newest'].includes(String(saved.sort))
    ? saved.sort as BrowseSort : 'popular';
  const savedDirection: BrowseSortDirection = saved.direction === 'asc' ? 'asc' : 'desc';
  const savedDensity: 'grid' | 'list' = saved.density === 'list' ? 'list' : 'grid';
  const initialString = (urlKey: string, savedKey: keyof typeof saved) => initialParams.has(urlKey) ? initialParams.get(urlKey) || '' : String(saved[savedKey] || '');
  const initialNumber = (key: string, savedKey: keyof typeof saved) => initialParams.has(key) ? Number(initialParams.get(key) || 0) : Number(saved[savedKey] || 0);
  const [source, setSource] = useState<RecommendationDataSource | null>(null);
  const [options, setOptions] = useState<FilterOptions>({ genres: [] });
  const [items, setItems] = useState<BrowseNovel[]>([]);
  const [query, setQuery] = useState(initialString('q', 'query'));
  const [sort, setSort] = useState<BrowseSort>(initialParams.has('sort') && ['popular', 'rating', 'votes', 'title', 'newest'].includes(initialParams.get('sort') || '') ? initialParams.get('sort') as BrowseSort : savedSort);
  const [direction, setDirection] = useState<BrowseSortDirection>(initialParams.has('direction') ? (initialParams.get('direction') === 'asc' ? 'asc' : 'desc') : savedDirection);
  const [language, setLanguage] = useState(initialString('language', 'language'));
  const [author, setAuthor] = useState(initialString('author', 'author'));
  const [genre, setGenre] = useState(initialString('genre', 'genre'));
  const [tag, setTag] = useState(initialString('tag', 'tag'));
  const [minRating, setMinRating] = useState(initialNumber('min_rating', 'minRating'));
  const [maxRating, setMaxRating] = useState(initialNumber('max_rating', 'maxRating'));
  const [minVotes, setMinVotes] = useState(initialNumber('min_votes', 'minVotes'));
  const [minYear, setMinYear] = useState(initialNumber('min_year', 'minYear'));
  const [maxYear, setMaxYear] = useState(initialNumber('max_year', 'maxYear'));
  const [status, setStatus] = useState(initialString('status', 'status'));
  const [minChapters, setMinChapters] = useState(initialNumber('min_chapters', 'minChapters'));
  const [maxChapters, setMaxChapters] = useState(initialNumber('max_chapters', 'maxChapters'));
  const [minReaders, setMinReaders] = useState(initialNumber('min_readers', 'minReaders'));
  const [maxReaders, setMaxReaders] = useState(initialNumber('max_readers', 'maxReaders'));
  const [includeGenres, setIncludeGenres] = useState(initialString('include_genres', 'includeGenres'));
  const [excludeGenres, setExcludeGenres] = useState(initialString('exclude_genres', 'excludeGenres'));
  const [includeTags, setIncludeTags] = useState(initialString('include_tags', 'includeTags'));
  const [excludeTags, setExcludeTags] = useState(initialString('exclude_tags', 'excludeTags'));
  const [excludeLibrary, setExcludeLibrary] = useState(initialParams.has('exclude_library') ? initialParams.get('exclude_library') === '1' : Boolean(saved.excludeLibrary));
  const [libraryIds, setLibraryIds] = useState<number[]>([]);
  const [density, setDensity] = useState<'grid' | 'list'>(initialParams.has('density') ? (initialParams.get('density') === 'list' ? 'list' : 'grid') : savedDensity);
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
  const [luckyLoading, setLuckyLoading] = useState(false);
  const requestRef = useRef(0);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const loadRequestedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setSource(null);
    setError('');
    createDataSource(dataMode).then(async (next) => {
      const nextOptions = await next.getOptions();
      if (cancelled) return;
      setSource(next);
      setOptions(nextOptions);
    }).catch((reason) => !cancelled && setError(reason.message || `Could not load the ${dataMode} data source.`));
    return () => { cancelled = true; };
  }, [dataMode]);

  useEffect(() => {
    saveFilterSnapshot('browse', { query, sort, direction, language, author, genre, tag, minRating, maxRating,
      minVotes, minYear, maxYear, status, minChapters, maxChapters, minReaders, maxReaders,
      includeGenres, excludeGenres, includeTags, excludeTags, excludeLibrary, density });
  }, [query, sort, direction, language, author, genre, tag, minRating, maxRating, minVotes, minYear, maxYear,
    status, minChapters, maxChapters, minReaders, maxReaders, includeGenres, excludeGenres, includeTags,
    excludeTags, excludeLibrary, density]);

  useEffect(() => {
    loadLocalProfile().then((profile) => setLibraryIds(
      profile?.entries.flatMap((entry) => entry.novel_id == null ? [] : [entry.novel_id]) || []
    )).catch(() => setLibraryIds([]));
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
          max_rating: maxRating, min_votes: minVotes, min_year: minYear, max_year: maxYear,
          status, min_chapters: minChapters, max_chapters: maxChapters,
          min_readers: minReaders, max_readers: maxReaders,
          include_genres: includeGenres, exclude_genres: excludeGenres,
          include_tags: includeTags, exclude_tags: excludeTags,
          exclude_ids: excludeLibrary ? libraryIds.join(',') : '', direction,
          page, page_size: PAGE_SIZE
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
    }, page === 1 ? 240 : 0);
    return () => window.clearTimeout(timer);
  }, [source, query, sort, direction, language, author, genre, tag, minRating, maxRating, minVotes, minYear, maxYear, status, minChapters, maxChapters, minReaders, maxReaders, includeGenres, excludeGenres, includeTags, excludeTags, excludeLibrary, libraryIds, page, retryToken]);

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

  useEffect(() => {
    const params = new URLSearchParams();
    params.set('view', 'browse');
    const values: Record<string, string | number | boolean> = {
      q: query, sort, direction, language, author, genre, tag,
      min_rating: minRating, max_rating: maxRating, min_votes: minVotes,
      min_year: minYear, max_year: maxYear, status,
      min_chapters: minChapters, max_chapters: maxChapters,
      min_readers: minReaders, max_readers: maxReaders,
      include_genres: includeGenres, exclude_genres: excludeGenres,
      include_tags: includeTags, exclude_tags: excludeTags,
      exclude_library: excludeLibrary, density
    };
    Object.entries(values).forEach(([key, value]) => {
      if (value && value !== 'desc' && value !== 'grid') params.set(key, value === true ? '1' : String(value));
    });
    window.history.replaceState(null, '', stableRouteUrl(params));
  }, [query, sort, direction, language, author, genre, tag, minRating, maxRating, minVotes, minYear, maxYear, status, minChapters, maxChapters, minReaders, maxReaders, includeGenres, excludeGenres, includeTags, excludeTags, excludeLibrary, density]);

  const browseRequest = () => ({
    query, sort, language, author, genre, tag,
    min_rating: minRating, max_rating: maxRating, min_votes: minVotes,
    min_year: minYear, max_year: maxYear, status,
    min_chapters: minChapters, max_chapters: maxChapters,
    min_readers: minReaders, max_readers: maxReaders,
    include_genres: includeGenres, exclude_genres: excludeGenres,
    include_tags: includeTags, exclude_tags: excludeTags,
    exclude_ids: excludeLibrary ? libraryIds.join(',') : '', direction
  });

  const clearAll = () => resetPage(() => {
    setQuery(''); setLanguage(''); setAuthor(''); setGenre(''); setTag('');
    setMinRating(0); setMaxRating(0); setMinVotes(0); setMinYear(0); setMaxYear(0);
    setStatus(''); setMinChapters(0); setMaxChapters(0); setMinReaders(0); setMaxReaders(0);
    setIncludeGenres(''); setExcludeGenres(''); setIncludeTags(''); setExcludeTags('');
    setExcludeLibrary(false); setSort('popular'); setDirection('desc');
  });

  const applyPreset = (preset: 'rated' | 'popular' | 'hidden' | 'newest' | 'completed') => resetPage(() => {
    clearAll();
    if (preset === 'rated') { setSort('rating'); setMinVotes(100); }
    if (preset === 'popular') setSort('popular');
    if (preset === 'hidden') { setSort('rating'); setMinRating(4.2); setMinVotes(10); setMaxReaders(2000); }
    if (preset === 'newest') setSort('newest');
    if (preset === 'completed') { setStatus('complete'); setSort('popular'); }
  });

  const feelingLucky = async () => {
    if (!source) return;
    setLuckyLoading(true);
    setError('');
    try {
      const novel = await source.getRandomNovel(browseRequest());
      window.location.href = novelPageUrl(novel.id);
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
    maxRating > 0 && { label: `Rating ≤ ${maxRating}★`, clear: () => setMaxRating(0) },
    minVotes > 0 && { label: `Votes: ${minVotes.toLocaleString()}+`, clear: () => setMinVotes(0) },
    minYear > 0 && { label: `From ${minYear}`, clear: () => setMinYear(0) },
    maxYear > 0 && { label: `Through ${maxYear}`, clear: () => setMaxYear(0) },
    status && { label: `Status: ${status}`, clear: () => setStatus('') },
    minChapters > 0 && { label: `${minChapters}+ chapters`, clear: () => setMinChapters(0) },
    maxChapters > 0 && { label: `≤ ${maxChapters} chapters`, clear: () => setMaxChapters(0) },
    minReaders > 0 && { label: `${minReaders.toLocaleString()}+ readers`, clear: () => setMinReaders(0) },
    maxReaders > 0 && { label: `≤ ${maxReaders.toLocaleString()} readers`, clear: () => setMaxReaders(0) },
    includeGenres && { label: `Genres: ${includeGenres}`, clear: () => setIncludeGenres('') },
    excludeGenres && { label: `Without genres: ${excludeGenres}`, clear: () => setExcludeGenres('') },
    includeTags && { label: `Tags: ${includeTags}`, clear: () => setIncludeTags('') },
    excludeTags && { label: `Without tags: ${excludeTags}`, clear: () => setExcludeTags('') },
    excludeLibrary && { label: 'Not in my library', clear: () => setExcludeLibrary(false) }
  ].filter(Boolean) as Array<{ label: string; clear: () => void }>;

  return (
    <main className="browse-shell">
      <header className="browse-hero">
        <p className="eyebrow">The complete catalog</p>
        <h1>Browse your next world.</h1>
        <p>Explore every title in this snapshot. Popularity uses reading-list counts; highest rated uses the published rating and vote count.</p>
      </header>

      <nav className="browse-presets" aria-label="Catalog views">
        <DSButton variant="ghost" onClick={() => applyPreset('rated')}>Top rated</DSButton>
        <DSButton variant="ghost" onClick={() => applyPreset('popular')}>Most read</DSButton>
        <DSButton variant="ghost" onClick={() => applyPreset('hidden')} title="Rating ≥ 4.2, 10+ votes, fewer than 2,000 readers">Hidden gems</DSButton>
        <DSButton variant="ghost" onClick={() => applyPreset('newest')}>Newest</DSButton>
        <DSButton variant="ghost" onClick={() => applyPreset('completed')}>Completed</DSButton>
      </nav>
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
        <DSButton variant="ghost" className="browse-direction" onClick={() => resetPage(() => setDirection((value) => value === 'desc' ? 'asc' : 'desc'))}
          aria-label={`Sort ${direction === 'desc' ? 'descending' : 'ascending'}`}>
          <ArrowDownUp size={15} /> {direction === 'desc' ? 'Descending' : 'Ascending'}
        </DSButton>
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
            <Select label="Translation status" value={status} onChange={(event) => resetPage(() => setStatus(event.target.value))}>
              <option value="">Any status</option><option value="complete">Completed</option><option value="ongoing">Ongoing</option><option value="hiatus">Hiatus</option>
            </Select>
            <NumberFilter label="Earliest year" value={minYear} onChange={(value) => resetPage(() => setMinYear(value))} />
            <NumberFilter label="Latest year" value={maxYear} onChange={(value) => resetPage(() => setMaxYear(value))} />
            <NumberFilter label="Maximum rating" value={maxRating} max={5} step={0.1} onChange={(value) => resetPage(() => setMaxRating(value))} />
            <NumberFilter label="Minimum chapters" value={minChapters} onChange={(value) => resetPage(() => setMinChapters(value))} />
            <NumberFilter label="Maximum chapters" value={maxChapters} onChange={(value) => resetPage(() => setMaxChapters(value))} />
            <NumberFilter label="Minimum readers" value={minReaders} onChange={(value) => resetPage(() => setMinReaders(value))} />
            <NumberFilter label="Maximum readers" value={maxReaders} onChange={(value) => resetPage(() => setMaxReaders(value))} />
          </FieldGroup>
          <FieldGroup label="Exact comma-separated facets">
            <label className="browse-text-filter"><span>Include genres</span><input value={includeGenres} onChange={(event) => resetPage(() => setIncludeGenres(event.target.value))} placeholder="Fantasy, Adventure" /></label>
            <label className="browse-text-filter"><span>Exclude genres</span><input value={excludeGenres} onChange={(event) => resetPage(() => setExcludeGenres(event.target.value))} placeholder="Harem" /></label>
            <label className="browse-text-filter"><span>Include tags</span><input value={includeTags} onChange={(event) => resetPage(() => setIncludeTags(event.target.value))} placeholder="Time Loop" /></label>
            <label className="browse-text-filter"><span>Exclude tags</span><input value={excludeTags} onChange={(event) => resetPage(() => setExcludeTags(event.target.value))} placeholder="Netorare" /></label>
            <label className="browse-library-filter"><input type="checkbox" checked={excludeLibrary} disabled={!libraryIds.length} onChange={(event) => resetPage(() => setExcludeLibrary(event.target.checked))} /> Hide titles in my local library</label>
          </FieldGroup>
        </details>
      </Card>
      {activeFilters.length > 0 && <div className="browse-active-filters" aria-label="Active filters">
        {activeFilters.map((filter) => <DSButton variant="ghost" key={filter.label} onClick={() => resetPage(filter.clear)}>{filter.label}<X size={12} /></DSButton>)}
        <DSButton variant="ghost" className="clear-all" onClick={clearAll}>Clear all</DSButton>
      </div>}

      {!tagSupported && <p className="browse-notice">Tag filtering is unavailable in this static snapshot, so the selected tag was not applied.</p>}
      <div className="browse-results-header">
        <CardHeader title="Novels" eyebrow="Catalog results" description={hasLoaded ? `${total.toLocaleString()} matches in this snapshot` : 'Loading catalog status'}
          action={<div className="browse-density" aria-label="Result density">
            <DSButton variant={density === 'grid' ? 'primary' : 'ghost'} onClick={() => setDensity('grid')} aria-label="Grid view"><LayoutGrid size={16} /></DSButton>
            <DSButton variant={density === 'list' ? 'primary' : 'ghost'} onClick={() => setDensity('list')} aria-label="List view"><List size={16} /></DSButton>
          </div>} />
      </div>
      {error && <p className="browse-error">{error}</p>}
      <section className={`browse-grid density-${density}`} aria-busy={loading && page === 1}>
        {items.map((novel) => <BrowseCard key={novel.id} novel={novel} />)}
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

    </main>
  );
}

function BrowseCard({ novel }: { novel: BrowseNovel }) {
  const { settings } = useDisplaySettings();
  const title = displayNovelTitle(novel.title, undefined, settings.titlePreference);
  const open = () => { window.location.href = novelPageUrl(novel.id); };
  return <Card className="browse-card" role="link" tabIndex={0} onClick={(event) => {
    if (!(event.target as HTMLElement).closest('a, button')) open();
  }} onKeyDown={(event) => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); }
  }}>
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
        <span>{novel.year || 'Year unknown'}{novel.chapters_trans ? ` · ${novel.chapters_trans} ch.` : ''}</span>
        <Tooltip content="Find similar novels">
          <DSButton as="a" variant="ghost" className="browse-icon-action" href={`${import.meta.env.BASE_URL}?seed=${novel.id}`} aria-label={`Find novels similar to ${title}`}>
            <Sparkles size={16} aria-hidden="true" />
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

function NumberFilter({ label, value, onChange, max, step = 1 }: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  max?: number;
  step?: number;
}) {
  return <label className="browse-number-filter"><span>{label}</span><input type="number" min="0" max={max} step={step}
    value={value || ''} placeholder="Any" onChange={(event) => onChange(Number(event.target.value) || 0)} /></label>;
}
