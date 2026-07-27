import { lazy, Suspense, useState, useEffect, FormEvent, useMemo, useRef } from 'react';
import {
  BookOpen,
  Check,
  ExternalLink,
  Heart,
  Search,
  SlidersHorizontal,
  Sparkles,
  Star,
  Users,
  X
} from 'lucide-react';
import { Menu } from '@base-ui/react/menu';
import {
  DatasetManifest,
  RecommendResponse,
  RecommendRequest,
  Recommendation,
  NovelDetail,
  NovelSearchResult
} from './types';
import {
  createDataSource,
  DataMode,
  externalMediaUrl,
  RecommendationDataSource,
  sourceDisplayName
} from './data';
import { useDataModePreference } from './dataModePreference';
import type { LocalUserProfile, ProfileEntry, ReadingStatus } from './profile/types';
import { loadLocalProfile, saveLocalProfile } from './profile/store';
import {
  buildExcludeIds,
  computeTasteProfile,
  fetchForYouRecommendations,
  type TasteSeed,
} from './profile/taste';
import { displayNovelTitle, useDisplaySettings } from './settings';
import { browseFacetUrl } from './metadataLinks';
import { Checkbox, FieldGroup, Select, Tooltip } from './ui';
import { Badge, Card, DSButton as Button } from './design-system';
import { getMediaBadgeInfo, novelPageUrl } from './novelLinks';

const NovelInsightsPanel = lazy(() => import('./NovelInsightsPanel').then((module) => ({
  default: module.NovelInsightsPanel
})));
import { parseMediaTypesFromUrl, useMediaFilterState } from './mediaFilterState';
import { loadFilterSnapshot, saveFilterSnapshot } from './preferences';
import { discoverSearchParams, parseDiscoverRoute, stableRouteUrl } from './routeState';

const DEFAULT_NOVEL: NovelSearchResult = {
  id: 6780,
  title: 'Reverend Insanity',
  slug: 'reverend-insanity',
  novelupdates_url: 'https://www.novelupdates.com/?p=6780',
  external_url: 'https://www.novelupdates.com/?p=6780',
  media_type: 'novel',
  source: 'novelupdates',
  author: 'gu zhen ren, 蛊真人',
  rating: 4.3,
  rating_votes: 1625
};

const DEFAULT_MANGA: NovelSearchResult = {
  id: 2117195,
  title: 'Oshi no Ko',
  slug: 'oshi-no-ko',
  novelupdates_url: 'https://anilist.co/manga/117195',
  external_url: 'https://anilist.co/manga/117195',
  media_type: 'manga',
  source: 'anilist',
  external_id: '117195',
  author: 'Aka Akasaka, Mengo Yokoyari',
  rating: 4.4,
  rating_votes: 2000
};

const DEFAULT_ANIME: NovelSearchResult = {
  id: 3001535,
  title: 'DEATH NOTE',
  slug: 'death-note',
  novelupdates_url: 'https://anilist.co/anime/1535',
  external_url: 'https://anilist.co/anime/1535',
  media_type: 'anime',
  source: 'anilist',
  external_id: '1535',
  author: 'Madhouse',
  rating: 4.3,
  rating_votes: 2500
};

export function getDefaultSeed(types: string[]): NovelSearchResult {
  if (types.length === 1) {
    if (types[0] === 'manga') return DEFAULT_MANGA;
    if (types[0] === 'anime') return DEFAULT_ANIME;
    if (types[0] === 'novel') return DEFAULT_NOVEL;
  }
  return DEFAULT_NOVEL;
}

export default function App(): JSX.Element {
  const {
    selectedTypes,
    mediaParam,
    scopeSentence,
    searchPlaceholder: seedSearchPlaceholder,
    includeOtherFormats,
    setIncludeOtherFormats,
    isAllSelected,
    setTypes,
  } = useMediaFilterState();
  const savedFilters = loadFilterSnapshot('discover', {
    hiddenGemMode: false, excludeHarem: false, excludeBL: false, excludeYuri: false,
    requireCompleted: false, language: '', minRating: 0, minRatingVotes: 0, maxReaders: 0,
    minYear: 0, maxYear: 0, genreStates: {} as Record<string, 'include' | 'exclude'>,
    includeTagsText: '', excludeTagsText: '', tagWeight: .8, directRecWeight: 1.2,
    listWeight: 1, structuralWeight: .6, hiddenGemStrength: .3, maxResults: 60,
    types: ''
  });
  const initialRoute = parseDiscoverRoute(new URLSearchParams(window.location.search), {
    ...savedFilters,
    genreStates: savedFilters.genreStates
  });
  const savedNumber = (value: unknown, fallback: number) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const { settings } = useDisplaySettings();
  const searchSectionRef = useRef<HTMLElement>(null);
  const resultsSentinelRef = useRef<HTMLDivElement>(null);
  const recommendationRequestRef = useRef(0);
  const autoRefreshReadyRef = useRef(false);
  const detailRequestRef = useRef(0);
  const dataSourceRef = useRef<RecommendationDataSource | null>(null);
  const [dataSource, setDataSource] = useState<RecommendationDataSource | null>(null);
  const { mode: dataMode, forcedMode, setMode: setDataMode } = useDataModePreference();
  const [dataset, setDataset] = useState<DatasetManifest | null>(null);
  const [query, setQuery] = useState(DEFAULT_NOVEL.title);
  const [selectedNovel, setSelectedNovel] = useState<NovelSearchResult | null>(DEFAULT_NOVEL);
  const [suggestions, setSuggestions] = useState<NovelSearchResult[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const [hiddenGemMode, setHiddenGemMode] = useState(Boolean(initialRoute.hiddenGemMode));
  const [excludeHarem, setExcludeHarem] = useState(Boolean(initialRoute.excludeHarem));
  const [excludeBL, setExcludeBL] = useState(Boolean(initialRoute.excludeBL));
  const [excludeYuri, setExcludeYuri] = useState(Boolean(initialRoute.excludeYuri));
  const [requireCompleted, setRequireCompleted] = useState(Boolean(initialRoute.requireCompleted));
  const [language, setLanguage] = useState(String(initialRoute.language || ''));
  const [minRating, setMinRating] = useState(savedNumber(initialRoute.minRating, 0));
  const [minRatingVotes, setMinRatingVotes] = useState(savedNumber(initialRoute.minRatingVotes, 0));
  const [maxReaders, setMaxReaders] = useState(savedNumber(initialRoute.maxReaders, 0));
  const [minYear, setMinYear] = useState(savedNumber(initialRoute.minYear, 0));
  const [maxYear, setMaxYear] = useState(savedNumber(initialRoute.maxYear, 0));
  const [genreStates, setGenreStates] = useState<Record<string, 'include' | 'exclude'>>(() =>
    Object.fromEntries(Object.entries(initialRoute.genreStates).filter(([, value]) => value === 'include' || value === 'exclude'))
  );
  const [includeTagsText, setIncludeTagsText] = useState(String(initialRoute.includeTagsText || ''));
  const [excludeTagsText, setExcludeTagsText] = useState(String(initialRoute.excludeTagsText || ''));
  const [tagWeight, setTagWeight] = useState(savedNumber(initialRoute.tagWeight, .8));
  const [directRecWeight, setDirectRecWeight] = useState(savedNumber(initialRoute.directRecWeight, 1.2));
  const [listWeight, setListWeight] = useState(savedNumber(initialRoute.listWeight, 1));
  const [structuralWeight, setStructuralWeight] = useState(savedNumber(initialRoute.structuralWeight, .6));
  const [hiddenGemStrength, setHiddenGemStrength] = useState(savedNumber(initialRoute.hiddenGemStrength, .3));
  const [maxResults, setMaxResults] = useState(savedNumber(initialRoute.maxResults, 60));
  const [routeRevision, setRouteRevision] = useState(0);
  const [genres, setGenres] = useState<string[]>([]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<RecommendResponse | null>(null);
  const [visibleCount, setVisibleCount] = useState(8);
  const [loadedLimit, setLoadedLimit] = useState(0);
  const [availableExhausted, setAvailableExhausted] = useState(false);
  const [observerSupported, setObserverSupported] = useState(true);
  const [incrementalError, setIncrementalError] = useState<string | null>(null);
  const [activeDetailId, setActiveDetailId] = useState<number | null>(null);
  const [detail, setDetail] = useState<NovelDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailEvidence, setDetailEvidence] = useState<string[]>([]);
  const [profile, setProfile] = useState<LocalUserProfile | null>(null);
  const [hideLibraryTitles, setHideLibraryTitles] = useState(true);
  const [forYouMode, setForYouMode] = useState(() =>
    new URLSearchParams(window.location.search).get('for_you') === '1'
  );
  const [forYouMeta, setForYouMeta] = useState<{
    seedsUsed: TasteSeed[];
    seedsFailed: Array<{ seed: TasteSeed; error: string }>;
    excludeCount: number;
    progress?: string;
    mode?: 'api-multi-seed' | 'client-merge';
    affinityApplied?: boolean;
  } | null>(null);

  useEffect(() => {
    loadLocalProfile().then(setProfile).catch(() => setProfile(null));
  }, []);

  useEffect(() => {
    saveFilterSnapshot('discover', { hiddenGemMode, excludeHarem, excludeBL, excludeYuri, requireCompleted,
      language, minRating, minRatingVotes, maxReaders, minYear, maxYear, genreStates, includeTagsText,
      excludeTagsText, tagWeight, directRecWeight, listWeight, structuralWeight, hiddenGemStrength, maxResults });
  }, [hiddenGemMode, excludeHarem, excludeBL, excludeYuri, requireCompleted, language, minRating,
    minRatingVotes, maxReaders, minYear, maxYear, genreStates, includeTagsText, excludeTagsText,
    tagWeight, directRecWeight, listWeight, structuralWeight, hiddenGemStrength, maxResults]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const params = discoverSearchParams({
        seed: forYouMode ? undefined : selectedNovel?.id,
        forYou: forYouMode,
        hiddenGemMode, excludeHarem, excludeBL,
        excludeYuri, requireCompleted, language, minRating, minRatingVotes, maxReaders, minYear, maxYear,
        genreStates, includeTagsText, excludeTagsText, tagWeight, directRecWeight, listWeight,
        structuralWeight, hiddenGemStrength, maxResults,
        types: isAllSelected ? '' : selectedTypes.join(','),
      });
      window.history.replaceState(null, '', stableRouteUrl(params));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [selectedNovel?.id, forYouMode, hiddenGemMode, excludeHarem, excludeBL, excludeYuri, requireCompleted, language,
    minRating, minRatingVotes, maxReaders, minYear, maxYear, genreStates, includeTagsText, excludeTagsText,
    tagWeight, directRecWeight, listWeight, structuralWeight, hiddenGemStrength, maxResults, selectedTypes, isAllSelected]);

  useEffect(() => {
    let cancelled = false;
    dataSourceRef.current = null;
    autoRefreshReadyRef.current = false;
    setDataSource(null);
    setDataset(null);
    setData(null);
    setError(null);
    createDataSource(dataMode)
      .then(async (source) => {
        const manifest = await source.getManifest();
        if (cancelled) return;
        dataSourceRef.current = source;
        setDataSource(source);
        setDataset(manifest);
        source.getOptions()
          .then((options) => { if (!cancelled) setGenres(options.genres || []); })
          .catch(() => { /* Advanced facets can remain unavailable without blocking discovery. */ });
      })
      .catch((initializationError: any) => {
        if (!cancelled) setError(initializationError.message || 'Could not load a recommendation dataset.');
      });
    return () => { cancelled = true; };
  }, [dataMode]);

  useEffect(() => {
    if (!dataSource) return;
    const trimmed = query.trim();
    if (
      trimmed.length < 2 ||
      (selectedNovel && trimmed === selectedNovel.title)
    ) {
      setSuggestions([]);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const results = await dataSource.searchNovels(trimmed, 8, controller.signal);
        setSuggestions(results);
        setShowSuggestions(true);
      } catch (searchError: any) {
        if (searchError.name !== 'AbortError') setSuggestions([]);
      }
    }, 180);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, selectedNovel, dataSource]);

  const libraryExcludeIds = useMemo(() => {
    if (!profile) return [] as number[];
    const ids = buildExcludeIds(profile);
    // When "Unread only" is off, still exclude not-for-me; keep library visible in results.
    if (hideLibraryTitles) return ids;
    return (profile.feedback || [])
      .filter((item) => item.signal === 'not_for_me')
      .map((item) => item.novel_id);
  }, [profile, hideLibraryTitles]);

  const fetchRecommendations = async (
    novel: NovelSearchResult | null = selectedNovel,
    requestedLimit = Math.min(8, maxResults),
    expanding = false,
    options: { forYou?: boolean } = {}
  ) => {
    const source = dataSourceRef.current;
    if (!source) return;
    const useForYou = options.forYou ?? forYouMode;

    const requestId = ++recommendationRequestRef.current;
    setLoading(true);
    if (!expanding) setIncrementalError(null);
    setError(null);
    setShowSuggestions(false);

    const basePayload: Omit<RecommendRequest, 'query'> = {
      limit: requestedLimit,
      hidden_gem_mode: hiddenGemMode,
      exclude_harem: excludeHarem,
      exclude_bl: excludeBL,
      exclude_yuri: excludeYuri,
      require_completed: requireCompleted,
      language,
      min_rating: minRating,
      min_rating_votes: minRatingVotes,
      max_readers: maxReaders,
      min_year: minYear,
      max_year: maxYear,
      include_genres: Object.entries(genreStates).filter(([, state]) => state === 'include').map(([genre]) => genre),
      exclude_genres: Object.entries(genreStates).filter(([, state]) => state === 'exclude').map(([genre]) => genre),
      include_tags: includeTagsText.split(',').map((tag) => tag.trim()).filter(Boolean),
      exclude_tags: excludeTagsText.split(',').map((tag) => tag.trim()).filter(Boolean),
      channel_weights: {
        tag: tagWeight,
        direct_rec: directRecWeight,
        rec_list: listWeight,
        structural: structuralWeight
      },
      hidden_gem_strength: hiddenGemStrength,
      media_type: includeOtherFormats || !mediaParam ? 'all' : mediaParam,
      exclude_novel_ids: libraryExcludeIds,
    };

    try {
      if (useForYou) {
        if (!profile) {
          setError('Import a local profile first — For You needs ratings or completed titles.');
          setForYouMeta(null);
          return;
        }
        const taste = computeTasteProfile(profile, [], {
          datasetVersion: dataset?.dataset_version,
        });
        const seeds = taste.positive_seeds;
        if (!seeds.length) {
          setError(
            'For You needs matched positive seeds (4★+, Completed, or Loved). Rate catalog-matched titles or import Completed lists.'
          );
          setForYouMeta({ seedsUsed: [], seedsFailed: [], excludeCount: libraryExcludeIds.length });
          setData(null);
          return;
        }
        setForYouMeta({
          seedsUsed: seeds,
          seedsFailed: [],
          excludeCount: taste.exclude_ids.length,
          progress: source.mode === 'api' ? 'live multi-seed…' : `0/${seeds.length}`,
        });
        // Load seed/negative details for tag affinity when cheap enough (cap 24).
        const detailIds = [
          ...seeds.map((s) => s.novel_id),
          ...taste.negative_ids.slice(0, 12),
        ].filter((id, i, all) => all.indexOf(id) === i).slice(0, 24);
        const detailResults = await Promise.allSettled(detailIds.map((id) => source.getNovel(id)));
        const details = detailResults.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
        const richTaste = computeTasteProfile(profile, details, {
          datasetVersion: dataset?.dataset_version,
        });
        const result = await fetchForYouRecommendations(source, profile, basePayload, {
          seedLimit: 12,
          taste: richTaste,
          onProgress: (done, total, seedTitle) => {
            if (requestId !== recommendationRequestRef.current) return;
            setForYouMeta((prev) => ({
              seedsUsed: prev?.seedsUsed || seeds,
              seedsFailed: prev?.seedsFailed || [],
              excludeCount: richTaste.exclude_ids.length,
              progress: `${done}/${total} · ${seedTitle}`,
              mode: prev?.mode,
              affinityApplied: prev?.affinityApplied,
            }));
          },
        });
        if (requestId !== recommendationRequestRef.current) return;
        setForYouMeta({
          seedsUsed: result.seeds_used,
          seedsFailed: result.seeds_failed,
          excludeCount: result.exclude_count,
          mode: result.mode,
          affinityApplied: result.affinity_applied,
        });
        const json: RecommendResponse = {
          seed_novel: {
            id: 0,
            title: result.mode === 'api-multi-seed' ? 'For You (live multi-seed)' : 'For You (client pool merge)',
            slug: 'for-you',
            novelupdates_url: '',
            cover_url: undefined,
          },
          count: result.recommendations.length,
          recommendations: result.recommendations,
        };
        setData(json);
        setLoadedLimit(requestedLimit);
        setAvailableExhausted(true); // multi-seed path loads a fixed merge batch
        if (!expanding) setVisibleCount(8);
        if (result.seeds_failed.length && !result.recommendations.length) {
          setError(
            `Every seed failed. Example: ${result.seeds_failed[0].seed.title} — ${result.seeds_failed[0].error}`
          );
        } else if (result.seeds_failed.length) {
          setIncrementalError(
            `${result.seeds_failed.length} seed${result.seeds_failed.length === 1 ? '' : 's'} failed (often missing static rec shards). Showing merge of ${result.seeds_used.length} successful seeds · mode=${result.mode}.`
          );
        }
        return;
      }

      const requestedQuery = novel ? String(novel.id) : selectedNovel ? String(selectedNovel.id) : query.trim();
      if (!requestedQuery) return;

      const payload: RecommendRequest = {
        ...basePayload,
        query: requestedQuery,
      };

      const json = await source.getRecommendations(payload);
      if (requestId !== recommendationRequestRef.current) return;
      setForYouMeta(null);
      setData(json);
      setLoadedLimit(requestedLimit);
      setAvailableExhausted(json.recommendations.length < requestedLimit || (expanding && json.recommendations.length <= (data?.recommendations.length || 0)));
      if (!expanding) setVisibleCount(8);
    } catch (err: any) {
      if (requestId !== recommendationRequestRef.current) return;
      if (expanding) {
        setIncrementalError(err.message || 'Could not load more recommendations.');
        setAvailableExhausted(true);
      } else {
        setError(err.message || 'Failed to fetch recommendations.');
      }
    } finally {
      if (requestId === recommendationRequestRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    if (!dataSource) return;
    const params = new URLSearchParams(window.location.search);
    const wantForYou = params.get('for_you') === '1';
    const seedId = Number(params.get('seed'));
    if (wantForYou) {
      setForYouMode(true);
      // Wait for profile load then multi-seed; profile effect may still be settling.
      loadLocalProfile()
        .then((loaded) => {
          if (loaded) setProfile(loaded);
          return fetchRecommendations(null, Math.min(40, maxResults), false, { forYou: true });
        })
        .catch(() => fetchRecommendations(null, Math.min(40, maxResults), false, { forYou: true }))
        .finally(() => { autoRefreshReadyRef.current = true; });
      return;
    }
    if (Number.isInteger(seedId) && seedId > 0) {
      dataSource.getNovel(seedId)
        .then((detail) => {
          const seed: NovelSearchResult = {
            id: detail.id,
            title: detail.title,
            slug: detail.slug,
            novelupdates_url: detail.novelupdates_url,
            external_url: detail.external_url,
            media_type: detail.media_type,
            source: detail.source,
            external_id: detail.external_id,
            author: detail.author || '',
            cover_url: detail.cover_url,
            rating: detail.rating,
            rating_votes: detail.rating_votes
          };
          chooseNovel(seed);
          return fetchRecommendations(seed);
        })
        .catch(() => {
          const fallback = getDefaultSeed(selectedTypes);
          chooseNovel(fallback);
          return fetchRecommendations(fallback);
        })
        .finally(() => { autoRefreshReadyRef.current = true; });
    } else {
      const initialSeed = getDefaultSeed(selectedTypes);
      chooseNovel(initialSeed);
      fetchRecommendations(initialSeed).finally(() => { autoRefreshReadyRef.current = true; });
    }
    // Load the initial recommendation set once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataSource]);

  useEffect(() => {
    if (!dataSource) return;
    const restore = async () => {
      const route = parseDiscoverRoute(new URLSearchParams(window.location.search), { ...savedFilters, genreStates: savedFilters.genreStates });
      setHiddenGemMode(route.hiddenGemMode); setExcludeHarem(route.excludeHarem); setExcludeBL(route.excludeBL);
      setExcludeYuri(route.excludeYuri); setRequireCompleted(route.requireCompleted); setLanguage(route.language);
      setMinRating(route.minRating); setMinRatingVotes(route.minRatingVotes); setMaxReaders(route.maxReaders);
      setMinYear(route.minYear); setMaxYear(route.maxYear); setGenreStates(route.genreStates);
      setIncludeTagsText(route.includeTagsText); setExcludeTagsText(route.excludeTagsText);
      setTagWeight(route.tagWeight); setDirectRecWeight(route.directRecWeight); setListWeight(route.listWeight);
      setStructuralWeight(route.structuralWeight); setHiddenGemStrength(route.hiddenGemStrength); setMaxResults(route.maxResults);
      if (route.types !== undefined) {
        const mediaTypes = parseMediaTypesFromUrl(route.types ? `types=${encodeURIComponent(route.types)}` : '');
        if (mediaTypes) setTypes(mediaTypes);
      }
      let seed = getDefaultSeed(selectedTypes);
      if (route.seed) {
        const detail = await dataSource.getNovel(route.seed).catch(() => null);
        if (detail) seed = {
          id: detail.id, title: detail.title, slug: detail.slug, novelupdates_url: detail.novelupdates_url,
          external_url: detail.external_url, media_type: detail.media_type, source: detail.source, external_id: detail.external_id,
          author: detail.author || '', cover_url: detail.cover_url, rating: detail.rating, rating_votes: detail.rating_votes
        };
      }
      chooseNovel(seed);
      setRouteRevision((value) => value + 1);
    };
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataSource, setTypes]);

  useEffect(() => {
    if (!autoRefreshReadyRef.current || !dataSource) return;
    if (!forYouMode && !selectedNovel) return;
    const timer = window.setTimeout(() => {
      setAvailableExhausted(false);
      if (forYouMode) {
        void fetchRecommendations(null, Math.min(40, maxResults), false, { forYou: true });
      } else {
        void fetchRecommendations(selectedNovel, Math.min(24, maxResults), false, { forYou: false });
      }
    }, 280);
    return () => window.clearTimeout(timer);
    // The selected seed is fetched explicitly when chosen. This effect only
    // reacts to recommendation controls and coalesces rapid text/slider edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataSource, forYouMode, hideLibraryTitles, libraryExcludeIds, hiddenGemMode, excludeHarem, excludeBL, excludeYuri, requireCompleted, language,
    minRating, minRatingVotes, maxReaders, minYear, maxYear, genreStates, includeTagsText,
    excludeTagsText, tagWeight, directRecWeight, listWeight, structuralWeight, hiddenGemStrength,
    maxResults, routeRevision, mediaParam, includeOtherFormats]);

  const chooseNovel = (novel: NovelSearchResult) => {
    setForYouMode(false);
    setForYouMeta(null);
    setSelectedNovel(novel);
    setQuery(novel.title);
    setSuggestions([]);
    setShowSuggestions(false);
  };
  const pushSeedRoute = (novel: NovelSearchResult) => {
    const params = new URLSearchParams(window.location.search);
    params.set('view', 'discover');
    params.set('seed', String(novel.id));
    params.delete('for_you');
    window.history.pushState(null, '', stableRouteUrl(params));
  };
  const runForYou = () => {
    setForYouMode(true);
    setHideLibraryTitles(true);
    setSelectedNovel(null);
    setQuery('For You (your library)');
    void fetchRecommendations(null, Math.min(40, maxResults), false, { forYou: true });
  };

  const useProfileEntryAsSeed = async (entry: ProfileEntry) => {
    const source = dataSourceRef.current;
    if (!source) return;
    setLoading(true);
    try {
      const resolved = await source.resolveSlugs([{ slug: entry.slug, title: entry.imported_title }]);
      const novel = resolved.get(entry.slug);
      if (!novel) throw new Error('This title is not available in the active dataset.');
      chooseNovel(novel);
      pushSeedRoute(novel);
      window.requestAnimationFrame(() => searchSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
      await fetchRecommendations(novel);
    } catch (profileError: any) {
      setError(profileError.message || 'Could not find similar titles for that profile entry.');
      setLoading(false);
    }
  };

  const profileEntries = useMemo(() => new Map(profile?.entries.map((entry) => [entry.novel_id, entry]) || []), [profile]);
  const feedbackByNovel = useMemo(() => new Map((profile?.feedback || []).map((item) => [item.novel_id, item.signal])), [profile]);

  const setNovelFeedback = async (rec: Recommendation, signal: 'love' | 'read' | 'not_for_me') => {
    const current = profile || {
      profile_id: crypto.randomUUID(),
      parser_version: 1,
      dataset_version: dataset?.dataset_version || 'unknown',
      imported_at: new Date().toISOString(),
      source_fingerprints: [],
      entries: [],
      curated_lists: [],
      feedback: []
    };
    const existingSignal = current.feedback?.find((item) => item.novel_id === rec.target_id)?.signal;
    const feedback = (current.feedback || []).filter((item) => item.novel_id !== rec.target_id);
    if (existingSignal !== signal) feedback.push({
      novel_id: rec.target_id,
      slug: rec.slug,
      title: rec.title,
      signal,
      updated_at: new Date().toISOString()
    });
    const next = { ...current, feedback };
    await saveLocalProfile(next);
    setProfile(next);
  };

  const setReadingStatus = async (rec: Recommendation, status: ReadingStatus | '') => {
    const current = profile || {
      profile_id: crypto.randomUUID(),
      parser_version: 1,
      dataset_version: dataset?.dataset_version || 'unknown',
      imported_at: new Date().toISOString(),
      source_fingerprints: [],
      entries: [],
      curated_lists: [],
      feedback: []
    };
    const entries = current.entries.filter((entry) => entry.novel_id !== rec.target_id && entry.slug !== rec.slug);
    if (status) entries.push({
      novel_id: rec.target_id,
      slug: rec.slug,
      imported_title: rec.title,
      status,
      source_file: 'recommendation'
    });
    const next = { ...current, entries };
    await saveLocalProfile(next);
    setProfile(next);
  };

  const openNovelDetail = async (novel: Recommendation) => {
    const source = dataSourceRef.current;
    if (!source) return;
    const requestId = ++detailRequestRef.current;
    setActiveDetailId(novel.target_id);
    setDetail(null);
    setDetailEvidence(novel.evidence_bullets);
    setDetailError(null);
    setDetailLoading(true);
    try {
      const body = await source.getNovel(novel.target_id);
      if (detailRequestRef.current === requestId) setDetail(body);
    } catch (detailFetchError: any) {
      if (detailRequestRef.current === requestId) {
        setDetailError(detailFetchError.message || 'Could not load this title.');
      }
    } finally {
      if (detailRequestRef.current === requestId) setDetailLoading(false);
    }
  };

  const closeNovelDetail = () => {
    detailRequestRef.current += 1;
    setActiveDetailId(null);
    setDetail(null);
    setDetailError(null);
  };

  const recommendFromDetail = () => {
    if (!detail) return;
    const nextSeed: NovelSearchResult = {
      id: detail.id,
      title: detail.title,
      slug: detail.slug,
      novelupdates_url: detail.novelupdates_url,
      author: detail.author || '',
      cover_url: detail.cover_url,
      rating: detail.rating,
      rating_votes: detail.rating_votes
    };
    chooseNovel(nextSeed);
    pushSeedRoute(nextSeed);
    closeNovelDetail();
    window.requestAnimationFrame(() => {
      searchSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    fetchRecommendations(nextSeed);
  };

  useEffect(() => {
    if (activeDetailId === null) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeNovelDetail();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [activeDetailId]);

  const handleSearch = (e: FormEvent) => {
    e.preventDefault();
    if (selectedNovel) pushSeedRoute(selectedNovel);
    fetchRecommendations();
  };

  const cycleGenre = (genre: string) => {
    setGenreStates((current) => {
      const next = { ...current };
      if (!next[genre]) next[genre] = 'include';
      else if (next[genre] === 'include') next[genre] = 'exclude';
      else delete next[genre];
      return next;
    });
  };

  const resetAdvanced = () => {
    setMinRatingVotes(0);
    setMaxReaders(0);
    setMinYear(0);
    setMaxYear(0);
    setGenreStates({});
    setIncludeTagsText('');
    setExcludeTagsText('');
    setTagWeight(0.8);
    setDirectRecWeight(1.2);
    setListWeight(1);
    setStructuralWeight(0.6);
    setHiddenGemStrength(0.3);
  };

  const resetFilters = () => {
    setHideLibraryTitles(false);
    setHiddenGemMode(false);
    setRequireCompleted(false);
    setExcludeHarem(false);
    setExcludeBL(false);
    setExcludeYuri(false);
    setLanguage('');
    setMinRating(0);
    resetAdvanced();
  };

  const activeFilters = useMemo(() => {
    const active: string[] = [];
    if (hideLibraryTitles && profile) active.push('Exclude library IDs');
    if (forYouMode) active.push('For You multi-seed');
    if (hiddenGemMode) active.push('Hidden gems');
    if (requireCompleted) active.push('Completed');
    if (excludeHarem) active.push('No harem');
    if (excludeBL) active.push('No BL');
    if (excludeYuri) active.push('No yuri');
    if (!isAllSelected && !includeOtherFormats) active.push(`Formats: ${scopeSentence}`);
    if (!isAllSelected && includeOtherFormats) active.push('Cross-format recs');
    if (language) active.push(language);
    if (minRating) active.push(`${minRating}+ rating`);
    if (minRatingVotes) active.push(`${minRatingVotes}+ votes`);
    if (maxReaders) active.push(`≤${maxReaders} readers`);
    if (minYear || maxYear) active.push('Year range');
    if (includeTagsText.trim()) active.push('Required tags');
    if (excludeTagsText.trim()) active.push('Excluded tags');
    active.push(...Object.entries(genreStates).map(([genre, state]) => `${state === 'include' ? '+' : '−'}${genre}`));
    if (tagWeight !== .8 || directRecWeight !== 1.2 || listWeight !== 1 || structuralWeight !== .6 || hiddenGemStrength !== .3) active.push('Custom ranking');
    return active;
  }, [hideLibraryTitles, forYouMode, profile, hiddenGemMode, requireCompleted, excludeHarem, excludeBL, excludeYuri, isAllSelected, includeOtherFormats, scopeSentence, language, minRating, minRatingVotes, maxReaders, minYear, maxYear, includeTagsText, excludeTagsText, genreStates, tagWeight, directRecWeight, listWeight, structuralWeight, hiddenGemStrength]);

  // Ranking already excludes library IDs when hideLibraryTitles is on; keep client filters for not_for_me edge cases.
  const filteredRecommendations = useMemo(() => (data?.recommendations || [])
    .filter((rec) => feedbackByNovel.get(rec.target_id) !== 'not_for_me')
    .filter((rec) => !hideLibraryTitles || !profileEntries.has(rec.target_id))
    .slice(0, maxResults), [data, feedbackByNovel, hideLibraryTitles, maxResults, profileEntries]);

  const loadNextRecommendationBatch = () => {
    if (loading || !data) return;
    if (visibleCount < filteredRecommendations.length) {
      setVisibleCount((count) => Math.min(count + 8, filteredRecommendations.length));
      return;
    }
    if (availableExhausted || data.recommendations.length >= maxResults) return;
    fetchRecommendations(selectedNovel, Math.min(maxResults, Math.max(loadedLimit + 24, data.recommendations.length + 24)), true);
  };

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') {
      setObserverSupported(false);
      return;
    }
    setObserverSupported(true);
    const sentinel = resultsSentinelRef.current;
    if (!sentinel || !data) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) loadNextRecommendationBatch();
    }, { rootMargin: '500px 0px' });
    observer.observe(sentinel);
    return () => observer.disconnect();
    // The explicit dependencies keep the observer synchronized with pagination
    // state without recreating it solely for the callback's function identity.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [data, visibleCount, filteredRecommendations.length, loading, availableExhausted, maxResults, loadedLimit, selectedNovel]);

  return (
    <div className="app-container">
      <header className="header">
        <div className="brand-mark"><Sparkles size={18} aria-hidden="true" /></div>
        <div>
          <div className="eyebrow">Relationship-first discovery</div>
          <h1>Find your next obsession.</h1>
          <p>
            Start with a title you loved. We trace shared tropes, recommendations, and related works
            {isAllSelected
              ? ' across the full catalog.'
              : includeOtherFormats
                ? ` from your seed, including titles outside ${scopeSentence}.`
                : ` among ${scopeSentence}.`}
          </p>
          <div className="dataset-controls">
            {dataSource && (
              <Badge tone={dataSource.mode === 'api' ? 'green' : 'violet'}>
                {dataSource.mode === 'api' ? 'Live database' : 'Static snapshot'}
                {dataset?.generated_at ? ` · ${new Date(dataset.generated_at).toLocaleDateString()}` : ''}
              </Badge>
            )}
            <label className="data-mode-select">
              <span>Data source</span>
              <select
                value={dataMode}
                onChange={(event) => setDataMode(event.target.value as DataMode)}
                aria-label="Recommendation data source"
                disabled={Boolean(forcedMode)}
              >
                <option value="auto">Automatic</option>
                <option value="api">Live API</option>
                <option value="static">Static snapshot</option>
              </select>
              {forcedMode && <small>Forced by this deployment</small>}
            </label>
          </div>
        </div>
      </header>

      <section className="search-section ds-card" ref={searchSectionRef}>
        <form onSubmit={handleSearch} className="search-input-wrapper">
          <Search className="search-icon" size={20} aria-hidden="true" />
          <div className="search-field">
            <label htmlFor="novel-search">Starting title</label>
            <input
              id="novel-search"
              type="text"
              autoComplete="off"
              placeholder={seedSearchPlaceholder}
              value={query}
              onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
              onChange={(e) => {
                setQuery(e.target.value);
                setSelectedNovel(null);
              }}
            />
          </div>
          <Button type="submit" variant="primary" className="search-button" disabled={loading || !dataSource}>
            {!dataSource ? 'Loading dataset…' : loading ? 'Finding matches…' : <><Sparkles size={16} aria-hidden="true" /> Find related</>}
          </Button>
        </form>

        {showSuggestions && suggestions.length > 0 && (
          <div className="suggestions" role="listbox" aria-label="Title matches">
            {suggestions.map((novel) => {
              const badge = getMediaBadgeInfo(novel);
              return (
                <div className="suggestion-row" key={novel.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={selectedNovel?.id === novel.id}
                    className="suggestion"
                    onClick={() => {
                      chooseNovel(novel);
                      pushSeedRoute(novel);
                      window.requestAnimationFrame(() => {
                        searchSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      });
                      void fetchRecommendations(novel);
                    }}
                  >
                    <CoverImage src={novel.cover_url} alt="" variant="suggestion" />
                    <span className="suggestion-copy">
                      <span className="suggestion-title-line">
                        <strong>{displayNovelTitle(novel.title, undefined, settings.titlePreference)}</strong>
                        <span className="suggestion-badges">
                          <span className={`search-badge format-badge ${badge.formatKey}`}>
                            {badge.formatLabel}
                          </span>
                          <span className={`search-badge source-badge ${badge.sourceKey}`}>
                            {badge.sourceLabel}
                          </span>
                        </span>
                      </span>
                      <small>{novel.author || 'Unknown author'} · ★ {novel.rating || '—'} ({novel.rating_votes} votes)</small>
                    </span>
                    <span className="select-label">Select</span>
                  </button>
                  <div className="suggestion-links">
                    <Tooltip content="View details">
                      <a href={novelPageUrl(novel.id)} aria-label={`View details for ${novel.title}`}>
                        <BookOpen size={16} aria-hidden="true" />
                      </a>
                    </Tooltip>
                    <Tooltip content={`Open on ${badge.sourceLabel}`}>
                      <a href={novel.external_url || novel.novelupdates_url} target="_blank" rel="noopener noreferrer"
                        aria-label={`Open ${novel.title} on ${badge.sourceLabel}`}>
                        <ExternalLink size={16} aria-hidden="true" />
                      </a>
                    </Tooltip>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <Card className="filter-panel" aria-label="Recommendation filters">
        <div className="filter-panel-heading">
          <div><strong>Refine matches</strong><span>{activeFilters.length ? `${activeFilters.length} active` : 'Using balanced defaults'}</span></div>
          {activeFilters.length > 0 && <Button variant="ghost" onClick={resetFilters}>Reset all</Button>}
        </div>
        <div className="filter-basics">
          <FieldGroup label="Show">
            <Tooltip
              content={
                profile
                  ? 'Merge recommendations from your top rated, completed, and loved titles'
                  : 'Import a profile first to enable personalized recommendations'
              }
            >
              <Checkbox
                label="For You"
                checked={forYouMode}
                disabled={!profile}
                onChange={(e) => {
                  if (e.currentTarget.checked) runForYou();
                  else {
                    setForYouMode(false);
                    setForYouMeta(null);
                    const seed = selectedNovel || getDefaultSeed(selectedTypes);
                    chooseNovel(seed);
                    void fetchRecommendations(seed, Math.min(8, maxResults), false, { forYou: false });
                  }
                }}
              />
            </Tooltip>
            <Tooltip content="Show titles rated 4.2★+ with lower reader counts (<2,000 readers)">
              <Checkbox label="Hidden gems" checked={hiddenGemMode} onChange={(e) => setHiddenGemMode(e.currentTarget.checked)} />
            </Tooltip>
            <Tooltip content="Show finished or fully translated titles only">
              <Checkbox label="Completed" checked={requireCompleted} onChange={(e) => setRequireCompleted(e.currentTarget.checked)} />
            </Tooltip>
            <Tooltip
              content={
                isAllSelected
                  ? 'All formats are already in scope via the format switcher'
                  : 'Allow recommendations outside the formats selected in the sidebar'
              }
            >
              <Checkbox
                label="Cross-format"
                checked={includeOtherFormats}
                disabled={isAllSelected}
                onChange={(e) => setIncludeOtherFormats(e.currentTarget.checked)}
              />
            </Tooltip>
            {profile && (
              <Tooltip content="Exclude matched library and Not-for-Me titles from recommendation ranking">
                <Checkbox
                  label="Exclude library"
                  checked={hideLibraryTitles}
                  onChange={(e) => setHideLibraryTitles(e.currentTarget.checked)}
                />
              </Tooltip>
            )}
          </FieldGroup>
          <FieldGroup label="Leave out">
            <Tooltip content="Exclude titles tagged with Harem genre or themes">
              <Checkbox label="Harem" checked={excludeHarem} onChange={(e) => setExcludeHarem(e.currentTarget.checked)} />
            </Tooltip>
            <Tooltip content="Exclude Boys' Love / Yaoi titles">
              <Checkbox label="BL" checked={excludeBL} onChange={(e) => setExcludeBL(e.currentTarget.checked)} />
            </Tooltip>
            <Tooltip content="Exclude Girls' Love / Yuri titles">
              <Checkbox label="Yuri" checked={excludeYuri} onChange={(e) => setExcludeYuri(e.currentTarget.checked)} />
            </Tooltip>
          </FieldGroup>
          <div className="filter-selects">
            <Select label="Language" value={language} onChange={(e) => setLanguage(e.currentTarget.value)}>
              <option value="">Any</option>
              <option value="korean">Korean</option>
              <option value="chinese">Chinese</option>
              <option value="japanese">Japanese</option>
            </Select>
            <Select label="Rating" value={minRating} onChange={(e) => setMinRating(Number(e.currentTarget.value))}>
              <option value="0">Any</option>
              <option value="3.5">3.5+</option>
              <option value="4">4.0+</option>
              <option value="4.3">4.3+</option>
            </Select>
            <Select label="Results" value={maxResults} onChange={(e) => { setMaxResults(Number(e.currentTarget.value)); setAvailableExhausted(false); }}>
              <option value="30">Up to 30</option>
              <option value="60">Up to 60</option>
              <option value="100">Up to 100 (pool limit)</option>
            </Select>
          </div>
        </div>
        {activeFilters.length > 0 && <div className="active-filter-chips" aria-label="Active filters">
          {activeFilters.map((filter) => <Badge tone="violet" key={filter}>{filter}</Badge>)}
        </div>}
      </Card>

      <details className="advanced-panel">
        <summary>
          <span>
            <strong><SlidersHorizontal size={16} aria-hidden="true" /> Advanced filters & ranking</strong>
            <small>Genres, tags, catalog thresholds, and algorithm weights</small>
          </span>
          <span className="summary-action">Customize</span>
        </summary>

        <div className="advanced-content">
          <section className="advanced-section">
            <div className="section-heading">
              <div>
                <h3>Genres</h3>
                <p>Click once to require, twice to exclude, three times to clear.</p>
              </div>
            </div>
            <div className="genre-chips">
              {genres.map((genre) => (
                <Button
                  type="button"
                  variant="ghost"
                  key={genre}
                  className={`genre-chip ${genreStates[genre] || ''}`}
                  onClick={() => cycleGenre(genre)}
                >
                  {genreStates[genre] === 'include' ? '+ ' : genreStates[genre] === 'exclude' ? '− ' : ''}
                  {genre}
                </Button>
              ))}
            </div>
          </section>

          <section className="advanced-section">
            <div className="section-heading">
              <div>
                <h3>Tags and catalog limits</h3>
                <p>Comma-separate exact Novel Updates tags.</p>
              </div>
            </div>
            <div className="advanced-grid">
              <label>
                Required tags
                <input value={includeTagsText} onChange={(e) => setIncludeTagsText(e.target.value)} placeholder="cunning protagonist, time loop" />
              </label>
              <label>
                Excluded tags
                <input value={excludeTagsText} onChange={(e) => setExcludeTagsText(e.target.value)} placeholder="netorare, dense protagonist" />
              </label>
              <label>
                Minimum rating votes
                <input type="number" min="0" value={minRatingVotes || ''} onChange={(e) => setMinRatingVotes(Number(e.target.value))} placeholder="Any" />
              </label>
              <label>
                Maximum readers
                <input type="number" min="0" value={maxReaders || ''} onChange={(e) => setMaxReaders(Number(e.target.value))} placeholder="Any" />
              </label>
              <label>
                Earliest year
                <input type="number" min="1900" max="2100" value={minYear || ''} onChange={(e) => setMinYear(Number(e.target.value))} placeholder="Any" />
              </label>
              <label>
                Latest year
                <input type="number" min="1900" max="2100" value={maxYear || ''} onChange={(e) => setMaxYear(Number(e.target.value))} placeholder="Any" />
              </label>
            </div>
          </section>

          <section className="advanced-section">
            <div className="section-heading">
              <div>
                <h3>Relationship recipe</h3>
                <p>Change which evidence sources matter most. Defaults are balanced for human signals.</p>
              </div>
              <Button type="button" variant="ghost" className="reset-button" onClick={resetAdvanced}>Reset defaults</Button>
            </div>
            <div className="weight-grid">
              <WeightControl label="Shared tropes" hint="Tag overlap weighted by specificity" value={tagWeight} onChange={setTagWeight} />
              <WeightControl label="Direct recommendations" hint="Title-to-title human votes" value={directRecWeight} onChange={setDirectRecWeight} />
              <WeightControl label="Curated lists" hint="Co-occurrence on recommendation lists" value={listWeight} onChange={setListWeight} />
              <WeightControl label="Author & related series" hint="Same creator, sequels, shared universe" value={structuralWeight} onChange={setStructuralWeight} />
              <WeightControl label="Hidden-gem strength" hint="How strongly to favor lower list counts" value={hiddenGemStrength} onChange={setHiddenGemStrength} max={1} />
            </div>
          </section>
        </div>
      </details>

      {error && <div className="error-message">{error}</div>}

      {data && (
        <main>
          <Card className="results-heading">
            <CoverImage src={data.seed_novel.cover_url} alt="" variant="seed" />
            <div className="results-heading-copy">
              <span className="eyebrow">
                {forYouMode ? 'For You · multi-seed library ranking' : 'Based on your starting title'}
              </span>
              <div className="seed-title-row">
                {forYouMode || data.seed_novel.id === 0 ? (
                  <h2>{data.seed_novel.title}</h2>
                ) : (
                  <>
                    <h2><a href={novelPageUrl(data.seed_novel.id, undefined, data.seed_novel.media_type)}>
                      {displayNovelTitle(data.seed_novel.title, undefined, settings.titlePreference)}
                    </a></h2>
                    {(() => {
                      const seedBadge = getMediaBadgeInfo(data.seed_novel);
                      return (
                        <span className="suggestion-badges" style={{ marginLeft: '0.35rem' }}>
                          <span className={`search-badge source-badge ${seedBadge.sourceKey}`}>
                            {seedBadge.sourceLabel}
                          </span>
                          <span className={`search-badge format-badge ${seedBadge.formatKey}`}>
                            {seedBadge.formatLabel}
                          </span>
                        </span>
                      );
                    })()}
                    <Tooltip content={`Open on ${sourceDisplayName(data.seed_novel.source, data.seed_novel.id)}`}>
                      <a className="seed-external-link" href={data.seed_novel.external_url || externalMediaUrl(data.seed_novel.id, data.seed_novel.source, data.seed_novel.external_id, data.seed_novel.media_type) || data.seed_novel.novelupdates_url} target="_blank"
                        rel="noopener noreferrer" aria-label={`Open ${data.seed_novel.title} on ${sourceDisplayName(data.seed_novel.source, data.seed_novel.id)}`}>
                        <ExternalLink size={15} aria-hidden="true" />
                      </a>
                    </Tooltip>
                  </>
                )}
              </div>
              <p>
                <span>{data.count}</span> evidence-backed matches
                {forYouMeta ? ` · ${forYouMeta.seedsUsed.length} seeds used · ${forYouMeta.excludeCount} IDs excluded` : ''}
                {forYouMeta?.mode ? ` · ${forYouMeta.mode}` : ''}
                {forYouMeta?.affinityApplied ? ' · taste affinity on' : forYouMeta ? ' · taste affinity off (no tag details)' : ''}
                {forYouMeta?.progress && loading ? ` · ${forYouMeta.progress}` : ''}
              </p>
              {forYouMeta && forYouMeta.seedsFailed.length > 0 && (
                <p className="for-you-failures">
                  {forYouMeta.seedsFailed.length} seed(s) failed (often missing static rec shards):{' '}
                  {forYouMeta.seedsFailed.slice(0, 3).map((f) => f.seed.title).join('; ')}
                  {forYouMeta.seedsFailed.length > 3 ? '…' : ''}
                </p>
              )}
              {forYouMeta && forYouMeta.seedsUsed.length > 0 && (
                <details className="for-you-seeds">
                  <summary>Seeds used ({forYouMeta.seedsUsed.length})</summary>
                  <ul>
                    {forYouMeta.seedsUsed.map((seed) => (
                      <li key={seed.novel_id}>
                        <a href={novelPageUrl(seed.novel_id)}>{seed.title}</a>
                        {' '}· w={seed.weight.toFixed(2)} · {seed.reason}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          </Card>

          <div className="results-grid">
            {filteredRecommendations.slice(0, visibleCount).map((rec, index) => {
              const badge = getMediaBadgeInfo({ id: rec.target_id, media_type: rec.media_type, source: rec.source });
              const evidenceBullets = rec.evidence_bullets.filter(Boolean);
              const compactEvidence = evidenceBullets.length < 3;
              return (
                <Card
                  key={rec.target_id || index}
                  className="novel-card"
                  onClick={(event) => {
                    if (!(event.target as HTMLElement).closest('button, a, summary, select, label')) void openNovelDetail(rec);
                  }}
                >
                  <div className="card-content">
                    <div className="card-main">
                      <div className={`card-primary${compactEvidence ? ' card-primary-compact-evidence' : ''}`}>
                        <div className="card-top">
                          <div className="card-cover">
                            <CoverImage src={rec.cover_url} alt={`Cover of ${displayNovelTitle(rec.title, undefined, settings.titlePreference)}`} variant="card" />
                            <span className="card-rank">#{index + 1}</span>
                          </div>

                          <div className="card-summary">
                            <div className="card-score"><Sparkles size={12} aria-hidden="true" /> {rec.match_score_percent}% match</div>
                            <h3 className="novel-title">
                              <a href={novelPageUrl(rec.target_id, data.seed_novel.id || undefined, rec.media_type)}>
                                {displayNovelTitle(rec.title, undefined, settings.titlePreference)}
                              </a>
                              <Tooltip content={`Open on ${sourceDisplayName(rec.source, rec.target_id)}`}>
                              <a
                                className="card-external-link"
                                href={rec.external_url || externalMediaUrl(rec.target_id, rec.source, rec.external_id, rec.media_type) || rec.novelupdates_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                aria-label={`Open ${rec.title} on ${sourceDisplayName(rec.source, rec.target_id)}`}
                              >
                                <ExternalLink size={14} aria-hidden="true" />
                              </a>
                              </Tooltip>
                            </h3>
                            <div className="novel-author">{rec.author
                              ? <a href={browseFacetUrl('author', rec.author)}>{rec.author}</a>
                              : 'Unknown author'}</div>

                            <div className="novel-meta">
                              <span title={`${rec.rating_votes} rating votes`}><Star size={13} fill="currentColor" aria-hidden="true" /> {rec.rating || '—'} <small>({rec.rating_votes})</small></span>
                              <span><Users size={13} aria-hidden="true" /> {rec.reading_list_count.toLocaleString()}</span>
                            </div>
                            <div className="card-badges">
                              <span className={`search-badge source-badge ${badge.sourceKey}`}>
                                {badge.sourceLabel}
                              </span>
                              <span className={`search-badge format-badge ${badge.formatKey}`}>
                                {badge.formatLabel}
                              </span>
                              {profileEntries.get(rec.target_id) && (
                                <span className={`library-badge status-${profileEntries.get(rec.target_id)?.status}`}>
                                  {profileEntries.get(rec.target_id)?.status.replace(/_/g, ' ')}
                                  {profileEntries.get(rec.target_id)?.rating ? ` · ${profileEntries.get(rec.target_id)?.rating}★` : ''}
                                </span>
                              )}
                              {rec.language && <a className="language-badge" href={browseFacetUrl('language', rec.language)}>{rec.language}</a>}
                              {rec.status_trans && <span>{rec.status_trans}</span>}
                            </div>
                          </div>
                        </div>

                      {evidenceBullets.length > 0 && (
                        <>
                          <div className="evidence-label">Why it matches</div>
                          <ul className={`evidence-list${compactEvidence ? ' evidence-list-compact' : ''}`}>
                            {evidenceBullets.map((bullet, i) => (
                              <li key={i} className="evidence-item">
                                <span className="evidence-bullet" aria-hidden="true">✓</span>
                                <span>{bullet}</span>
                              </li>
                            ))}
                          </ul>
                        </>
                      )}
                    </div>

                    {rec.shared_tags.length > 0 && (
                      <aside className="card-tag-rail" aria-label="Shared tropes">
                        <span className="card-tag-label">Shared tropes</span>
                        <div className="detail-chips card-tag-links">
                          {rec.shared_tags.slice(0, 3).map((tag) => (
                            <a key={tag} href={browseFacetUrl('tag', tag)}>{tag}</a>
                          ))}
                        </div>
                        {rec.shared_tags.length > 3 && (
                          <details className="card-tag-more">
                            <summary>+{rec.shared_tags.length - 3} more</summary>
                            <div className="detail-chips">
                              {rec.shared_tags.slice(3).map((tag) => (
                                <a key={tag} href={browseFacetUrl('tag', tag)}>{tag}</a>
                              ))}
                            </div>
                          </details>
                        )}
                      </aside>
                    )}
                  </div>

                  <div className="feedback-actions">
                    <Button variant="primary" className="card-primary-action" onClick={() => useProfileEntryAsSeed({
                      novel_id: rec.target_id,
                      slug: rec.slug,
                      imported_title: rec.title,
                      status: profileEntries.get(rec.target_id)?.status || 'reading',
                      source_file: 'recommendation'
                    })}><Sparkles size={14} aria-hidden="true" /> Similar</Button>
                    <Menu.Root>
                      <Tooltip content="Set reading status">
                        <Menu.Trigger className="card-icon-action"
                          aria-label={`Set reading status for ${rec.title}`}>
                          <BookOpen size={16} aria-hidden="true" />
                        </Menu.Trigger>
                      </Tooltip>
                      <Menu.Portal>
                        <Menu.Positioner sideOffset={6} align="end" className="reading-menu-positioner">
                          <Menu.Popup className="reading-menu">
                            {([
                              ['', 'Add'],
                              ['reading', 'Reading'],
                              ['completed', 'Completed'],
                              ['plan_to_read', 'Plan'],
                              ['paused', 'Paused'],
                              ['dropped', 'Dropped'],
                            ] as const).map(([status, label]) => (
                              <Menu.Item key={status || 'add'} className="reading-menu-item"
                                onClick={() => setReadingStatus(rec, status)}>
                                <span>{label}</span>
                                {(profileEntries.get(rec.target_id)?.status || '') === status &&
                                  <Check size={14} aria-hidden="true" />}
                              </Menu.Item>
                            ))}
                          </Menu.Popup>
                        </Menu.Positioner>
                      </Menu.Portal>
                    </Menu.Root>
                    <div className="card-preference-actions">
                      <Tooltip content="Love this recommendation">
                        <Button variant="ghost" className={`btn-feedback icon-only ${feedbackByNovel.get(rec.target_id) === 'love' ? 'selected' : ''}`}
                          aria-label={`Love ${rec.title}`} aria-pressed={feedbackByNovel.get(rec.target_id) === 'love'}
                          onClick={() => setNovelFeedback(rec, 'love')}><Heart size={16} aria-hidden="true" /></Button>
                      </Tooltip>
                      <Tooltip content="Hide recommendations like this">
                        <Button variant="ghost" className={`btn-feedback icon-only ${feedbackByNovel.get(rec.target_id) === 'not_for_me' ? 'selected' : ''}`}
                          aria-label={`${rec.title} is not for me`} aria-pressed={feedbackByNovel.get(rec.target_id) === 'not_for_me'}
                          onClick={() => setNovelFeedback(rec, 'not_for_me')}><X size={16} aria-hidden="true" /></Button>
                      </Tooltip>
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>

          <div className="results-sentinel" ref={resultsSentinelRef}>
            <p aria-live="polite">
              {loading
                ? 'Loading more recommendations…'
                : incrementalError
                  ? incrementalError
                : visibleCount < filteredRecommendations.length || (!availableExhausted && data.recommendations.length < maxResults)
                  ? `Showing ${Math.min(visibleCount, filteredRecommendations.length)} results · more load automatically`
                  : `Showing ${filteredRecommendations.length} · end of the available candidate pool`}
            </p>
            {!observerSupported && !loading && (visibleCount < filteredRecommendations.length || (!availableExhausted && data.recommendations.length < maxResults)) && (
              <Button variant="default" onClick={loadNextRecommendationBatch}>Load more recommendations</Button>
            )}
            {incrementalError && !loading && <Button variant="ghost" onClick={() => { setIncrementalError(null); setAvailableExhausted(false); }}>Retry automatic loading</Button>}
          </div>
        </main>
      )}

      {activeDetailId !== null && (
        <NovelDetailDialog
          detail={detail}
          loading={detailLoading}
          error={detailError}
          evidence={detailEvidence}
          onClose={closeNovelDetail}
          onRecommend={recommendFromDetail}
          profileEntry={detail ? profileEntries.get(detail.id) : undefined}
          titlePreference={settings.titlePreference}
          source={dataSource!}
        />
      )}
    </div>
  );
}

function NovelDetailDialog({
  detail,
  loading,
  error,
  evidence,
  onClose,
  onRecommend,
  profileEntry,
  titlePreference,
  source
}: {
  detail: NovelDetail | null;
  loading: boolean;
  error: string | null;
  evidence: string[];
  onClose: () => void;
  onRecommend: () => void;
  profileEntry?: ProfileEntry;
  titlePreference: 'catalog' | 'alternate';
  source: RecommendationDataSource;
}) {
  return (
    <div className="detail-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section
        className="detail-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={detail ? 'novel-detail-title' : undefined}
        aria-label={detail ? undefined : 'Title details'}
        aria-busy={loading}
      >
        <button type="button" className="detail-close" onClick={onClose} aria-label="Close title details" autoFocus>
          <X size={20} aria-hidden="true" />
        </button>

        {loading && <div className="detail-state"><Sparkles size={22} aria-hidden="true" /> Loading title details…</div>}
        {error && <div className="detail-state detail-error">{error}</div>}

        {detail && (
          <>
            <div className="detail-hero">
              <CoverImage src={detail.cover_url} alt={`Cover of ${displayNovelTitle(detail.title, detail.associated_names, titlePreference)}`} variant="detail" />
              <div className="detail-heading">
                {(() => {
                  const detailBadge = getMediaBadgeInfo(detail);
                  return (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.2rem' }}>
                      <span className={`search-badge source-badge ${detailBadge.sourceKey}`}>
                        {detailBadge.sourceLabel}
                      </span>
                      <span className={`search-badge format-badge ${detailBadge.formatKey}`}>
                        {detailBadge.formatLabel}
                      </span>
                      <span className="eyebrow" style={{ margin: 0 }}>{detail.language
                        ? <a href={browseFacetUrl('language', detail.language)}>{detail.language}</a>
                        : 'Catalog title'}{detail.year ? ` · ${detail.year}` : ''}</span>
                    </div>
                  );
                })()}
                <h2 id="novel-detail-title">{displayNovelTitle(detail.title, detail.associated_names, titlePreference)}</h2>
                <p className="detail-author">{detail.author
                  ? <a href={browseFacetUrl('author', detail.author)}>{detail.author}</a>
                  : 'Unknown author'}</p>
                {profileEntry && <span className={`detail-library-badge status-${profileEntry.status}`}>
                  In your library · {profileEntry.status.replace(/_/g, ' ')}
                  {profileEntry.rating ? ` · ${profileEntry.rating}★` : ''}
                  {profileEntry.progress ? ` · ${profileEntry.progress}` : ''}
                </span>}
                <div className="detail-stats">
                  <span><Star size={15} fill="currentColor" aria-hidden="true" /> {detail.rating || '—'} <small>{detail.rating_votes.toLocaleString()} votes</small></span>
                  <span><Users size={15} aria-hidden="true" /> {detail.reading_list_count.toLocaleString()} readers</span>
                  {(detail.status_trans || detail.chapters_trans > 0 || detail.chapters_orig > 0) && (
                    <span><BookOpen size={15} aria-hidden="true" /> {[
                      detail.status_trans,
                      detail.chapters_trans > 0 ? `${detail.chapters_trans} translated` : '',
                      detail.chapters_orig > 0 ? `${detail.chapters_orig} original` : ''
                    ].filter(Boolean).join(' · ')}</span>
                  )}
                </div>
                <div className="detail-actions">
                  <button type="button" className="detail-recommend-button" onClick={onRecommend}>
                    <Sparkles size={16} aria-hidden="true" /> Find recommendations like this
                  </button>
                  <a
                    href={detail.external_url || externalMediaUrl(detail.id, detail.source, detail.external_id, detail.media_type) || detail.novelupdates_url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    View on {sourceDisplayName(detail.source, detail.id)} <ExternalLink size={15} aria-hidden="true" />
                  </a>
                </div>
              </div>
            </div>

            <div className="detail-body">
              {detail.genres.length > 0 && (
                <section className="detail-section">
                  <h3>Genres</h3>
                  <div className="detail-chips">{detail.genres.map((genre) => <a key={genre} href={browseFacetUrl('genre', genre)}>{genre}</a>)}</div>
                </section>
              )}
              {detail.synopsis && (
                <section className="detail-section">
                  <h3>Synopsis</h3>
                  <p className="detail-synopsis">{detail.synopsis}</p>
                </section>
              )}
              {evidence.length > 0 && (
                <section className="detail-section">
                  <h3>Why it matched your starting title</h3>
                  <ul className="evidence-list detail-evidence">
                    {evidence.map((item, index) => (
                      <li key={index} className="evidence-item">
                        <span className="evidence-bullet" aria-hidden="true">✓</span><span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {detail.tags.length > 0 && (
                <section className="detail-section">
                  <h3>Tags</h3>
                  <div className="detail-chips detail-tags">{detail.tags.map((tag) => <a key={tag} href={browseFacetUrl('tag', tag)}>{tag}</a>)}</div>
                </section>
              )}
              {detail.associated_names.length > 0 && (
                <section className="detail-section">
                  <h3>Also known as</h3>
                  <p>{detail.associated_names.join(' · ')}</p>
                </section>
              )}
              <section className="detail-section detail-signals">
                <h3>Discovery signals</h3>
                <div>
                  <span><strong>{detail.direct_recommendation_count}</strong> direct recommendations</span>
                  <span><strong>{detail.recommendation_list_count}</strong> curated lists</span>
                  <span><strong>{detail.related_series_count}</strong> related series</span>
                </div>
              </section>
              <Suspense fallback={<div className="detail-loading" aria-busy="true">Loading catalog context…</div>}>
                <NovelInsightsPanel novelId={detail.id} source={source} />
              </Suspense>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function CoverImage({
  src,
  alt,
  variant
}: {
  src?: string;
  alt: string;
  variant: 'suggestion' | 'seed' | 'card' | 'detail';
}) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <span className={`cover-fallback cover-${variant}`}>
        <span>NU</span>
      </span>
    );
  }
  return (
    <img
      className={`cover-${variant}`}
      src={src}
      alt={alt}
      loading={variant === 'card' ? 'lazy' : 'eager'}
      onError={() => setFailed(true)}
    />
  );
}

function WeightControl({
  label,
  hint,
  value,
  onChange,
  max = 2
}: {
  label: string;
  hint: string;
  value: number;
  onChange: (value: number) => void;
  max?: number;
}) {
  return (
    <label className="weight-control">
      <span><strong>{label}</strong><small>{hint}</small></span>
      <span className="range-row">
        <input
          type="range"
          min="0"
          max={max}
          step="0.1"
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <output>{value.toFixed(1)}×</output>
      </span>
    </label>
  );
}
