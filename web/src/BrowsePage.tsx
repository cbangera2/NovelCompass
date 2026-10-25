import { MouseEvent, ReactNode, useEffect, useRef, useState } from 'react';
import {
  ArrowDownUp,
  BookOpen,
  Search,
  Shuffle,
} from 'lucide-react';
import {
  createDataSource,
  RecommendationDataSource,
  sourceLink,
} from './data';
import { useDataModePreference } from './dataModePreference';
import { stableRouteUrl } from './routeState';
import { BrowseNovel, BrowseSort, BrowseSortDirection, FilterOptions } from './types';
import { browseFacetUrl } from './metadataLinks';
import { ActiveFilterChips, CoreFilters } from './components/CoreFilters';
import { formatMinRating, readCoreFilterParams, writeCoreFilterParams } from './components/coreFilterParams';
import { AdvancedFilters } from './components/AdvancedFilters';
import { advancedActiveFilters, type AdvancedFilterValues } from './components/advancedFilterModel';
import { formatList, parseList } from './components/tokenInput';
import './browse.css';
import { displayNovelTitle, useDisplaySettings } from './settings';
import { Select } from './ui';
import { Card, CardHeader, DSButton, Skeleton } from './design-system';
import { hasMixedFormats, novelPageUrl, progressUnitLabel } from './novelLinks';
import { NovelCard } from './components/NovelCard';
import { registerPreviews } from './CoverPreview';
import { previewFromBrowse } from './previewData';
import { CardActions } from './components/CardActions';
import { loadLocalProfile } from './profile/store';
import { useLocalProfile } from './profile/useLocalProfile';
import { loadFilterSnapshot, loadResultLayout, parseResultLayout, saveFilterSnapshot, saveResultLayout, type ResultLayout } from './preferences';
import { ResultLayoutToggle } from './components/ResultLayoutToggle';
import { useSourceFilterState } from './sourceFilterState';

import { parseMediaTypesFromUrl, useMediaFilterState, MediaTypeChoice } from './mediaFilterState';
import { Palette, Film } from 'lucide-react';
import { FormatScopeChip } from './components/FormatScopeChip';
import { navigateTo } from './viewTransitions';

const PAGE_SIZE = 24;

export interface BrowsePageProps {
  /** Pre-initialized source for extension/embedded surfaces. */
  source?: RecommendationDataSource;
  /** Keep website route/query synchronization enabled by default. */
  syncHistory?: boolean;
  /** Keep website local filter/profile persistence enabled by default. */
  persistPreferences?: boolean;
  /** NU's finder owns only the Novel Updates novel catalog. */
  showMediaTypes?: boolean;
  fixedMediaType?: string;
  /** Use DOM-native selects so controls stay inside an extension ShadowRoot. */
  nativeControls?: boolean;
  novelUrl?: (novel: BrowseNovel) => string;
  similarUrl?: (novel: BrowseNovel) => string | null;
  heading?: string;
  eyebrow?: string;
  description?: string;
}

export default function BrowsePage({
  source: providedSource,
  syncHistory = true,
  persistPreferences = true,
  showMediaTypes = true,
  fixedMediaType,
  nativeControls = false,
  novelUrl = (novel) => novelPageUrl(novel.id, undefined, novel.media_type),
  similarUrl = (novel) => `${import.meta.env.BASE_URL}?seed=${novel.id}`,
  heading = 'Browse your next world.',
  eyebrow,
  description,
}: BrowsePageProps = {}): JSX.Element {
  const { selectedTypes, toggleType, setTypes, isAllSelected, scopeSentence } =
    useMediaFilterState();
  const { sourceParam } = useSourceFilterState();
  const { mode: dataMode } = useDataModePreference();
  const initialParams = new URLSearchParams(window.location.search);
  const defaults = {
    query: '',
    sort: 'popular',
    direction: 'desc',
    language: '',
    author: '',
    genre: '',
    tag: '',
    minRating: 0,
    maxRating: 0,
    minVotes: 0,
    minYear: 0,
    maxYear: 0,
    status: '',
    minChapters: 0,
    maxChapters: 0,
    minReaders: 0,
    maxReaders: 0,
    includeGenres: '',
    excludeGenres: '',
    includeTags: '',
    excludeTags: '',
    excludeLibrary: false,
  };
  const saved = persistPreferences ? loadFilterSnapshot('browse', defaults) : defaults;
  const savedSort: BrowseSort = ['popular', 'rating', 'votes', 'title', 'newest'].includes(
    String(saved.sort),
  )
    ? (saved.sort as BrowseSort)
    : 'popular';
  const savedDirection: BrowseSortDirection = saved.direction === 'asc' ? 'asc' : 'desc';
  const initialString = (urlKey: string, savedKey: keyof typeof saved) =>
    initialParams.has(urlKey) ? initialParams.get(urlKey) || '' : String(saved[savedKey] || '');
  const initialNumber = (key: string, savedKey: keyof typeof saved) =>
    initialParams.has(key) ? Number(initialParams.get(key) || 0) : Number(saved[savedKey] || 0);
  const [source, setSource] = useState<RecommendationDataSource | null>(null);
  const [options, setOptions] = useState<FilterOptions>({ genres: [] });
  const [items, setItems] = useState<BrowseNovel[]>([]);
  useEffect(() => registerPreviews(items.map(previewFromBrowse)), [items]);
  // The format pill only earns its space when the result set actually mixes formats.
  const mixedFormats = hasMixedFormats(items);
  const [query, setQuery] = useState(initialString('q', 'query'));
  const [sort, setSort] = useState<BrowseSort>(
    initialParams.has('sort') &&
      ['popular', 'rating', 'votes', 'title', 'newest'].includes(initialParams.get('sort') || '')
      ? (initialParams.get('sort') as BrowseSort)
      : savedSort,
  );
  const [direction, setDirection] = useState<BrowseSortDirection>(
    initialParams.has('direction')
      ? initialParams.get('direction') === 'asc'
        ? 'asc'
        : 'desc'
      : savedDirection,
  );
  const initialCore = readCoreFilterParams(initialParams, {
    language: String(saved.language || ''),
    minRating: Number(saved.minRating || 0),
  });
  const [language, setLanguage] = useState(initialCore.language);
  const [author, setAuthor] = useState(initialString('author', 'author'));
  const [genre, setGenre] = useState(initialString('genre', 'genre'));
  const [tag, setTag] = useState(initialString('tag', 'tag'));
  const [minRating, setMinRating] = useState(initialCore.minRating);
  const [maxRating, setMaxRating] = useState(initialNumber('max_rating', 'maxRating'));
  const [minVotes, setMinVotes] = useState(initialNumber('min_votes', 'minVotes'));
  const [minYear, setMinYear] = useState(initialNumber('min_year', 'minYear'));
  const [maxYear, setMaxYear] = useState(initialNumber('max_year', 'maxYear'));
  const [status, setStatus] = useState(initialString('status', 'status'));
  const [minChapters, setMinChapters] = useState(initialNumber('min_chapters', 'minChapters'));
  const [maxChapters, setMaxChapters] = useState(initialNumber('max_chapters', 'maxChapters'));
  const [minReaders, setMinReaders] = useState(initialNumber('min_readers', 'minReaders'));
  const [maxReaders, setMaxReaders] = useState(initialNumber('max_readers', 'maxReaders'));
  const [includeGenres, setIncludeGenres] = useState(
    initialString('include_genres', 'includeGenres'),
  );
  const [excludeGenres, setExcludeGenres] = useState(
    initialString('exclude_genres', 'excludeGenres'),
  );
  const [includeTags, setIncludeTags] = useState(initialString('include_tags', 'includeTags'));
  const [excludeTags, setExcludeTags] = useState(initialString('exclude_tags', 'excludeTags'));
  const [excludeLibrary, setExcludeLibrary] = useState(
    initialParams.has('exclude_library')
      ? initialParams.get('exclude_library') === '1'
      : Boolean(saved.excludeLibrary),
  );
  const [libraryIds, setLibraryIds] = useState<number[]>([]);
  const [layout, setLayoutState] = useState<ResultLayout>(
    initialParams.has('density') ? parseResultLayout(initialParams.get('density')) : loadResultLayout(),
  );
  const setLayout = (next: ResultLayout) => {
    setLayoutState(next);
    if (persistPreferences) saveResultLayout(next);
  };
  const [page, setPage] = useState(1);
  const [retryToken, setRetryToken] = useState(0);
  const [total, setTotal] = useState(0);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [tagSupported, setTagSupported] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [batchError, setBatchError] = useState('');
  const [observerSupported] = useState(
    () => typeof window !== 'undefined' && 'IntersectionObserver' in window,
  );
  const [luckyLoading, setLuckyLoading] = useState(false);
  const requestRef = useRef(0);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const loadRequestedRef = useRef(false);

  useEffect(() => {
    if (providedSource) {
      let cancelled = false;
      setSource(providedSource);
      setError('');
      providedSource
        .getOptions()
        .then((nextOptions) => !cancelled && setOptions(nextOptions))
        .catch(
          (reason) =>
            !cancelled && setError(reason.message || 'Could not load the catalog options.'),
        );
      return () => {
        cancelled = true;
      };
    }
    let cancelled = false;
    setSource(null);
    setError('');
    createDataSource(dataMode)
      .then(async (next) => {
        const nextOptions = await next.getOptions();
        if (cancelled) return;
        setSource(next);
        setOptions(nextOptions);
      })
      .catch(
        (reason) =>
          !cancelled && setError(reason.message || `Could not load the ${dataMode} data source.`),
      );
    return () => {
      cancelled = true;
    };
  }, [dataMode, providedSource]);

  useEffect(() => {
    if (!persistPreferences) return;
    saveFilterSnapshot('browse', {
      query,
      sort,
      direction,
      language,
      author,
      genre,
      tag,
      minRating,
      maxRating,
      minVotes,
      minYear,
      maxYear,
      status,
      minChapters,
      maxChapters,
      minReaders,
      maxReaders,
      includeGenres,
      excludeGenres,
      includeTags,
      excludeTags,
      excludeLibrary,
      mediaType: selectedTypes.join(','),
    });
  }, [
    persistPreferences,
    query,
    sort,
    direction,
    language,
    author,
    genre,
    tag,
    minRating,
    maxRating,
    minVotes,
    minYear,
    maxYear,
    status,
    minChapters,
    maxChapters,
    minReaders,
    maxReaders,
    includeGenres,
    excludeGenres,
    includeTags,
    excludeTags,
    excludeLibrary,
    selectedTypes,
  ]);

  useEffect(() => {
    if (!persistPreferences) {
      setLibraryIds([]);
      return;
    }
    loadLocalProfile()
      .then((profile) =>
        setLibraryIds(
          profile?.entries.flatMap((entry) => (entry.novel_id == null ? [] : [entry.novel_id])) ||
            [],
        ),
      )
      .catch(() => setLibraryIds([]));
  }, [persistPreferences]);

  useEffect(() => {
    if (!source) return;
    const requestId = ++requestRef.current;
    const timer = window.setTimeout(
      async () => {
        setLoading(true);
        if (page === 1) setError('');
        setBatchError('');
        try {
          const result = await source.browseNovels({
            query,
            sort,
            language,
            author,
            genre,
            tag,
            min_rating: minRating,
            max_rating: maxRating,
            min_votes: minVotes,
            min_year: minYear,
            max_year: maxYear,
            status,
            min_chapters: minChapters,
            max_chapters: maxChapters,
            min_readers: minReaders,
            max_readers: maxReaders,
            include_genres: includeGenres,
            exclude_genres: excludeGenres,
            include_tags: includeTags,
            exclude_tags: excludeTags,
            exclude_ids: excludeLibrary ? libraryIds.join(',') : '',
            direction,
            media_type: fixedMediaType || selectedTypes.join(','),
            source: sourceParam,
            page,
            page_size: PAGE_SIZE,
          });
          if (requestId !== requestRef.current) return;
          setItems((current) => (page === 1 ? result.items : [...current, ...result.items]));
          setTotal(result.total);
          setHasLoaded(true);
          setHasMore(result.has_more);
          setTagSupported(result.capabilities.tags);
        } catch (reason: any) {
          if (requestId === requestRef.current) {
            const message = reason.message || 'Could not browse the catalog.';
            if (page > 1) setBatchError(message);
            else setError(message);
          }
        } finally {
          if (requestId === requestRef.current) {
            setLoading(false);
            loadRequestedRef.current = false;
          }
        }
      },
      page === 1 ? 240 : 0,
    );
    return () => window.clearTimeout(timer);
  }, [
    source,
    query,
    sort,
    direction,
    language,
    author,
    genre,
    tag,
    minRating,
    maxRating,
    minVotes,
    minYear,
    maxYear,
    status,
    minChapters,
    maxChapters,
    minReaders,
    maxReaders,
    includeGenres,
    excludeGenres,
    includeTags,
    excludeTags,
    excludeLibrary,
    libraryIds,
    page,
    retryToken,
    selectedTypes,
    sourceParam,
    fixedMediaType,
  ]);

  const resetPage = (action: () => void) => {
    action();
    setPage(1);
    setBatchError('');
    loadRequestedRef.current = false;
  };

  const handleToggleFormat = (type: MediaTypeChoice) => {
    if (syncHistory) window.history.pushState(null, '', window.location.href);
    resetPage(() => toggleType(type));
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
      { rootMargin: '500px 0px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
    // requestNextPage intentionally reads the latest render state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [observerSupported, hasMore, loading, batchError, page]);

  useEffect(() => {
    if (!syncHistory) return;
    const params = new URLSearchParams();
    params.set('view', 'browse');
    const values: Record<string, string | number | boolean> = {
      q: query,
      sort,
      direction,
      author,
      genre,
      tag,
      max_rating: maxRating,
      min_votes: minVotes,
      min_year: minYear,
      max_year: maxYear,
      status,
      min_chapters: minChapters,
      max_chapters: maxChapters,
      min_readers: minReaders,
      max_readers: maxReaders,
      include_genres: includeGenres,
      exclude_genres: excludeGenres,
      include_tags: includeTags,
      exclude_tags: excludeTags,
      exclude_library: excludeLibrary,
      density: layout === 'detailed' ? 'detailed' : '',
    };
    writeCoreFilterParams(params, { language, minRating });
    Object.entries(values).forEach(([key, value]) => {
      if (value && value !== 'desc')
        params.set(key, value === true ? '1' : String(value));
    });
    if (!isAllSelected && selectedTypes.length > 0) {
      params.set('types', selectedTypes.join(','));
    }
    window.history.replaceState(null, '', stableRouteUrl(params));
  }, [
    syncHistory,
    query,
    sort,
    direction,
    language,
    author,
    genre,
    tag,
    minRating,
    maxRating,
    minVotes,
    minYear,
    maxYear,
    status,
    minChapters,
    maxChapters,
    minReaders,
    maxReaders,
    includeGenres,
    excludeGenres,
    includeTags,
    excludeTags,
    excludeLibrary,
    layout,
    selectedTypes,
    isAllSelected,
  ]);

  useEffect(() => {
    if (!syncHistory) return;
    const restore = () => {
      const params = new URLSearchParams(window.location.search);
      const text = (key: string) => params.get(key) || '';
      const number = (key: string, max = Number.MAX_SAFE_INTEGER) => {
        const value = Number(params.get(key) || 0);
        return Number.isFinite(value) ? Math.max(0, Math.min(max, value)) : 0;
      };
      setQuery(text('q'));
      const core = readCoreFilterParams(params, { language: '', minRating: 0 });
      setLanguage(core.language);
      setAuthor(text('author'));
      setGenre(text('genre'));
      setTag(text('tag'));
      setSort(
        ['popular', 'rating', 'votes', 'title', 'newest'].includes(text('sort'))
          ? (text('sort') as BrowseSort)
          : 'popular',
      );
      setDirection(text('direction') === 'asc' ? 'asc' : 'desc');
      setLayoutState(params.has('density') ? parseResultLayout(params.get('density')) : loadResultLayout());
      setMinRating(core.minRating);
      setMaxRating(number('max_rating', 5));
      setMinVotes(number('min_votes'));
      setMinYear(number('min_year'));
      setMaxYear(number('max_year'));
      setStatus(text('status'));
      setMinChapters(number('min_chapters'));
      setMaxChapters(number('max_chapters'));
      setMinReaders(number('min_readers'));
      setMaxReaders(number('max_readers'));
      setIncludeGenres(text('include_genres'));
      setExcludeGenres(text('exclude_genres'));
      setIncludeTags(text('include_tags'));
      setExcludeTags(text('exclude_tags'));
      setExcludeLibrary(text('exclude_library') === '1');
      setPage(1);
      setBatchError('');
      loadRequestedRef.current = false;
      const mediaTypes = parseMediaTypesFromUrl(params);
      if (mediaTypes) setTypes(mediaTypes);
    };
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, [setTypes, syncHistory]);

  const browseRequest = () => ({
    query,
    sort,
    language,
    author,
    genre,
    tag,
    min_rating: minRating,
    max_rating: maxRating,
    min_votes: minVotes,
    min_year: minYear,
    max_year: maxYear,
    status,
    min_chapters: minChapters,
    max_chapters: maxChapters,
    min_readers: minReaders,
    max_readers: maxReaders,
    include_genres: includeGenres,
    exclude_genres: excludeGenres,
    include_tags: includeTags,
    exclude_tags: excludeTags,
    exclude_ids: excludeLibrary ? libraryIds.join(',') : '',
    direction,
    media_type: fixedMediaType || selectedTypes.join(','),
    source: sourceParam,
  });

  const clearAll = () =>
    resetPage(() => {
      setQuery('');
      setLanguage('');
      setAuthor('');
      setGenre('');
      setTag('');
      setMinRating(0);
      setMaxRating(0);
      setMinVotes(0);
      setMinYear(0);
      setMaxYear(0);
      setStatus('');
      setMinChapters(0);
      setMaxChapters(0);
      setMinReaders(0);
      setMaxReaders(0);
      setIncludeGenres('');
      setExcludeGenres('');
      setIncludeTags('');
      setExcludeTags('');
      setExcludeLibrary(false);
      setSort('popular');
      setDirection('desc');
    });

  const applyPreset = (preset: 'rated' | 'popular' | 'hidden' | 'newest' | 'completed') =>
    resetPage(() => {
      if (syncHistory) window.history.pushState(null, '', window.location.href);
      clearAll();
      if (preset === 'rated') {
        setSort('rating');
        setMinVotes(100);
      }
      if (preset === 'popular') setSort('popular');
      if (preset === 'hidden') {
        setSort('rating');
        setMinRating(4.2);
        setMinVotes(10);
        setMaxReaders(2000);
      }
      if (preset === 'newest') setSort('newest');
      if (preset === 'completed') {
        setStatus('complete');
        setSort('popular');
      }
    });

  const feelingLucky = async () => {
    if (!source) return;
    setLuckyLoading(true);
    setError('');
    try {
      const novel = await source.getRandomNovel(browseRequest());
      navigateTo(novelUrl(novel));
    } catch (reason: any) {
      setError(reason.message || 'Could not choose a random title.');
    } finally {
      setLuckyLoading(false);
    }
  };

  const advancedValues: AdvancedFilterValues = {
    includeGenres: parseList(includeGenres),
    excludeGenres: parseList(excludeGenres),
    includeTags: parseList(includeTags),
    excludeTags: parseList(excludeTags),
    maxRating, minVotes, minYear, maxYear, minChapters, maxChapters, minReaders, maxReaders,
  };
  const applyAdvanced = (patch: Partial<AdvancedFilterValues>) =>
    resetPage(() => {
      if (patch.includeGenres) setIncludeGenres(formatList(patch.includeGenres));
      if (patch.excludeGenres) setExcludeGenres(formatList(patch.excludeGenres));
      if (patch.includeTags) setIncludeTags(formatList(patch.includeTags));
      if (patch.excludeTags) setExcludeTags(formatList(patch.excludeTags));
      if (patch.maxRating !== undefined) setMaxRating(patch.maxRating);
      if (patch.minVotes !== undefined) setMinVotes(patch.minVotes);
      if (patch.minYear !== undefined) setMinYear(patch.minYear);
      if (patch.maxYear !== undefined) setMaxYear(patch.maxYear);
      if (patch.minChapters !== undefined) setMinChapters(patch.minChapters);
      if (patch.maxChapters !== undefined) setMaxChapters(patch.maxChapters);
      if (patch.minReaders !== undefined) setMinReaders(patch.minReaders);
      if (patch.maxReaders !== undefined) setMaxReaders(patch.maxReaders);
    });

  const activeFilters = [
    query && { label: `Search: ${query}`, clear: () => setQuery('') },
    author && { label: `Author: ${author}`, clear: () => setAuthor('') },
    genre && { label: `Genre: ${genre}`, clear: () => setGenre('') },
    tag && { label: `Tag: ${tag}`, clear: () => setTag('') },
    language && { label: `Language: ${language}`, clear: () => setLanguage('') },
    minRating > 0 && { label: `Rating: ${formatMinRating(minRating)}`, clear: () => setMinRating(0) },
    status && { label: `Status: ${status}`, clear: () => setStatus('') },
    excludeLibrary && { label: 'Not in my library', clear: () => setExcludeLibrary(false) },
  ].filter(Boolean) as Array<{ label: string; clear: () => void }>;
  activeFilters.push(...advancedActiveFilters(advancedValues, applyAdvanced));

  return (
    <main className="browse-shell">
      <header className="browse-hero">
        <p className="eyebrow">
          {eyebrow || (isAllSelected ? 'The complete catalog' : `Browsing ${scopeSentence}`)}
        </p>
        <h1>{heading}</h1>
        <FormatScopeChip />
        <p>
          {description ||
            (isAllSelected
              ? 'Explore every title in this snapshot. Popularity uses list counts; highest rated uses the published rating and vote count.'
              : `Showing ${scopeSentence} from this snapshot. Toggle formats above to change scope — the same selection applies to search and recommendations.`)}
        </p>
      </header>

      <nav className="browse-presets" aria-label="Catalog views">
        {showMediaTypes && (
          <div className="segmented-media-filter" aria-label="Format selection">
            <button
              type="button"
              className={`segmented-pill ${selectedTypes.includes('novel') ? 'active' : ''}`}
              onClick={() => handleToggleFormat('novel')}
              title="Toggle Light Novels & Web Novels"
            >
              <BookOpen size={14} /> Novels
            </button>
            <button
              type="button"
              className={`segmented-pill ${selectedTypes.includes('manga') ? 'active' : ''}`}
              onClick={() => handleToggleFormat('manga')}
              title="Toggle Manga & Comics"
            >
              <Palette size={14} /> Manga
            </button>
            <button
              type="button"
              className={`segmented-pill ${selectedTypes.includes('anime') ? 'active' : ''}`}
              onClick={() => handleToggleFormat('anime')}
              title="Toggle Anime"
            >
              <Film size={14} /> Anime
            </button>
          </div>
        )}
        <DSButton variant="ghost" onClick={() => applyPreset('rated')}>
          Top rated
        </DSButton>
        <DSButton variant="ghost" onClick={() => applyPreset('popular')}>
          Most read
        </DSButton>
        <DSButton
          variant="ghost"
          onClick={() => applyPreset('hidden')}
          title="Rating ≥ 4.2, 10+ votes, fewer than 2,000 readers"
        >
          Hidden gems
        </DSButton>
        <DSButton variant="ghost" onClick={() => applyPreset('newest')}>
          Newest
        </DSButton>
        <DSButton variant="ghost" onClick={() => applyPreset('completed')}>
          Completed
        </DSButton>
      </nav>
      <Card className="browse-controls" aria-label="Catalog filters">
        <label className="browse-search">
          <span>Filter results</span>
          <div className="browse-search-input-wrap">
            <Search size={17} />
            <input
              value={query}
              onChange={(event) => resetPage(() => setQuery(event.target.value))}
              placeholder="Filter by title, alias, or author…"
            />
          </div>
        </label>
        <BrowseSelect
          native={nativeControls}
          label="Sort"
          value={sort}
          onChange={(value) => resetPage(() => setSort(value as BrowseSort))}
        >
          <option value="popular">Most popular</option>
          <option value="rating">Highest rated</option>
          <option value="votes">Most rated</option>
          <option value="newest">Newest year</option>
          <option value="title">Title A–Z</option>
        </BrowseSelect>
        <CoreFilters
          native={nativeControls}
          language={language}
          minRating={minRating}
          languages={options.languages}
          onLanguageChange={(value) => resetPage(() => setLanguage(value))}
          onMinRatingChange={(value) => resetPage(() => setMinRating(value))}
        />
        <DSButton
          variant="ghost"
          className="browse-direction"
          onClick={() =>
            resetPage(() => setDirection((value) => (value === 'desc' ? 'asc' : 'desc')))
          }
          aria-label={`Sort ${direction === 'desc' ? 'descending' : 'ascending'}`}
        >
          <ArrowDownUp size={15} /> {direction === 'desc' ? 'Descending' : 'Ascending'}
        </DSButton>
        <DSButton
          variant="primary"
          className="browse-lucky"
          disabled={!source || luckyLoading}
          onClick={feelingLucky}
        >
          <Shuffle size={16} /> {luckyLoading ? 'Choosing…' : 'Feeling lucky'}
        </DSButton>
      </Card>
      <ActiveFilterChips
        className="filter-active-row"
        filters={activeFilters.map((filter) => ({ label: filter.label, clear: () => resetPage(filter.clear) }))}
        onClearAll={clearAll}
      />
      <AdvancedFilters
        values={advancedValues}
        onChange={applyAdvanced}
        genres={options.genres}
        tags={options.tags || []}
        summaryExtra="status and library"
      >
        <section className="advanced-section">
          <div className="section-heading"><div><h3>Status and library</h3><p>Translation progress and your local library.</p></div></div>
          <div className="advanced-extra">
            <BrowseSelect
              native={nativeControls}
              label="Translation status"
              value={status}
              onChange={(value) => resetPage(() => setStatus(value))}
            >
              <option value="">Any status</option>
              <option value="complete">Completed</option>
              <option value="ongoing">Ongoing</option>
              <option value="hiatus">Hiatus</option>
            </BrowseSelect>
            <label className="browse-library-filter">
              <input
                type="checkbox"
                checked={excludeLibrary}
                disabled={!libraryIds.length}
                onChange={(event) => resetPage(() => setExcludeLibrary(event.target.checked))}
              />{' '}
              Hide titles in my local library
            </label>
          </div>
        </section>
      </AdvancedFilters>

      {!tagSupported && (
        <p className="browse-notice">
          Tag filtering is unavailable in this static snapshot, so the selected tag was not applied.
        </p>
      )}
      <div className="browse-results-header">
        <CardHeader
          title="Titles"
          eyebrow="Catalog results"
          description={
            hasLoaded
              ? `${total.toLocaleString()} matches in this snapshot`
              : 'Loading catalog status'
          }
          action={
            <ResultLayoutToggle value={layout} onChange={setLayout} />
          }
        />
      </div>
      {error && <p className="browse-error">{error}</p>}
      <section className={`browse-grid ${layout === 'compact' ? 'nc-grid' : 'density-detailed'}`} aria-busy={loading && page === 1}>
        {items.map((novel) => (
          <BrowseCard
            key={novel.id}
            novel={novel}
            layout={layout}
            coverFormat={mixedFormats}
            novelUrl={novelUrl}
            similarUrl={similarUrl}
            persistDisplaySettings={persistPreferences}
            onSelectAuthor={(authorName) => resetPage(() => setAuthor(authorName))}
            onSelectGenre={(genreName) => resetPage(() => setGenre(genreName))}
            embedded={!syncHistory}
          />
        ))}
        {loading &&
          page === 1 &&
          Array.from({ length: 6 }, (_, index) => (
            <Card className={layout === 'compact' ? 'browse-tile-skeleton' : 'browse-card browse-card-skeleton'} key={index}>
              <Skeleton />
              <div>
                <Skeleton />
                <Skeleton />
                <Skeleton />
              </div>
            </Card>
          ))}
      </section>
      {!loading && hasLoaded && !items.length && !error && (
        <p className="browse-empty">No titles match these filters.</p>
      )}
      <div ref={sentinelRef} className="browse-sentinel" aria-hidden="true" />
      <div className="browse-page-status" role="status" aria-live="polite">
        {loading && (
          <div className="browse-loading">
            <span /> Loading {page > 1 ? 'more titles' : 'catalog'}…
          </div>
        )}
        {batchError && (
          <div className="browse-batch-error">
            <span>{batchError}</span>
            <DSButton onClick={retryBatch}>Retry loading more</DSButton>
          </div>
        )}
        {hasMore && !loading && !batchError && !observerSupported && (
          <div className="browse-pagination">
            <DSButton className="browse-more" onClick={requestNextPage}>
              Load {PAGE_SIZE} more
            </DSButton>
            <span>
              Showing {items.length.toLocaleString()} of {total.toLocaleString()}
            </span>
          </div>
        )}
        {hasMore && observerSupported && !batchError && (
          <span className="sr-only">More titles load automatically as you scroll.</span>
        )}
        {hasLoaded && !hasMore && items.length > 0 && (
          <p className="browse-end">
            End of results · {items.length.toLocaleString()} titles shown
          </p>
        )}
      </div>
    </main>
  );
}

function BrowseCard({
  novel,
  layout,
  coverFormat,
  novelUrl,
  similarUrl,
  onSelectAuthor,
  onSelectGenre,
  embedded,
  persistDisplaySettings,
}: {
  novel: BrowseNovel;
  layout: ResultLayout;
  coverFormat: boolean;
  novelUrl: (novel: BrowseNovel) => string;
  similarUrl: (novel: BrowseNovel) => string | null;
  onSelectAuthor: (author: string) => void;
  onSelectGenre: (genre: string) => void;
  embedded: boolean;
  persistDisplaySettings: boolean;
}) {
  const { settings } = useDisplaySettings({ persist: persistDisplaySettings });
  const title = displayNovelTitle(novel.title, undefined, settings.titlePreference);
  const href = novelUrl(novel);
  const recommendationHref = similarUrl(novel);
  const facetClick = (handler: (value: string) => void, value: string) =>
    embedded
      ? (event: MouseEvent<HTMLAnchorElement>) => {
          event.preventDefault();
          handler(value);
        }
      : undefined;
  const item = {
    id: novel.id,
    title,
    href,
    coverUrl: novel.cover_url,
    mediaType: novel.media_type,
    source: novel.source,
    author: novel.author,
    authorHref: novel.author ? (embedded ? '#' : browseFacetUrl('author', novel.author)) : undefined,
    onAuthorClick: novel.author ? facetClick(onSelectAuthor, novel.author) : undefined,
    rating: novel.rating,
    ratingVotes: novel.rating_votes,
    readers: novel.reading_list_count,
  };
  const { entries, feedback } = useLocalProfile();
  const profileEntry = persistDisplaySettings ? entries.get(novel.id) : undefined;
  // "Hide recommendations like this" keeps the title in the catalog but fades it, so Browse stays a faithful listing.
  const dimmed = persistDisplaySettings && feedback.get(novel.id) === 'not_for_me';
  const actions = (
    <CardActions
      variant={layout === 'compact' ? 'tile' : 'row'}
      novel={{ id: novel.id, slug: novel.slug, title: novel.title }}
      label={title}
      similar={recommendationHref ? { href: recommendationHref } : undefined}
      profileActions={persistDisplaySettings}
      external={sourceLink(novel)}
    />
  );
  if (layout === 'compact') {
    return <NovelCard variant="tile" className={dimmed ? 'nc-hidden-pick' : ''} item={item} libraryStatus={profileEntry?.status} libraryRating={profileEntry?.rating} coverFormat={coverFormat} actions={actions} />;
  }
  return (
    <NovelCard
      variant="row"
      className={dimmed ? 'browse-result nc-hidden-pick' : 'browse-result'}
      item={item}
      libraryStatus={profileEntry?.status}
      libraryRating={profileEntry?.rating}
      chips={novel.genres?.slice(0, 3).map((item) => (
        <a key={item} href={embedded ? '#' : browseFacetUrl('genre', item)} onClick={facetClick(onSelectGenre, item)}>
          {item}
        </a>
      ))}
      footerNote={
        <>
          {novel.year || 'Year unknown'}
          {novel.chapters_trans ? ` · ${novel.chapters_trans} ${progressUnitLabel(novel.id, novel.media_type, true)}` : ''}
        </>
      }
      actions={actions}
    />
  );
}

function BrowseSelect({
  native,
  label,
  value,
  disabled,
  onChange,
  children,
}: {
  native: boolean;
  label: string;
  value: string | number;
  disabled?: boolean;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  if (!native) {
    return (
      <Select
        label={label}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        {children}
      </Select>
    );
  }
  return (
    <label className="browse-native-select">
      <span>{label}</span>
      <select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
        {children}
      </select>
    </label>
  );
}
