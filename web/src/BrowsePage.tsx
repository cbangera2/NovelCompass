import { useEffect, useRef, useState } from 'react';
import { BookOpen, ExternalLink, Search, Shuffle, SlidersHorizontal, Star, Users, X } from 'lucide-react';
import { configuredDataMode, createDataSource, RecommendationDataSource } from './data';
import { BrowseNovel, BrowseSort, FilterOptions, NovelDetail } from './types';
import { browseFacetUrl } from './metadataLinks';
import './browse.css';
import { displayNovelTitle, useDisplaySettings } from './settings';
import { Button, FieldGroup, Select } from './ui';

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
  const [total, setTotal] = useState(0);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [tagSupported, setTagSupported] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState<NovelDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [luckyLoading, setLuckyLoading] = useState(false);
  const requestRef = useRef(0);

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
      setError('');
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
        if (requestId === requestRef.current) setError(reason.message || 'Could not browse novels.');
      } finally {
        if (requestId === requestRef.current) setLoading(false);
      }
    }, query ? 180 : 0);
    return () => window.clearTimeout(timer);
  }, [source, query, sort, language, author, genre, tag, minRating, minVotes, page]);

  const resetPage = (action: () => void) => {
    action();
    setPage(1);
  };

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

      <section className="browse-controls" aria-label="Catalog filters">
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
        <Button variant="primary" className="browse-lucky" disabled={!source || luckyLoading} onClick={feelingLucky}>
          <Shuffle size={16} /> {luckyLoading ? 'Choosing…' : 'Feeling lucky'}
        </Button>
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
      </section>
      {activeFilters.length > 0 && <div className="browse-active-filters" aria-label="Active filters">
        {activeFilters.map((filter) => <Button variant="ghost" key={filter.label} onClick={() => resetPage(filter.clear)}>{filter.label}<X size={12} /></Button>)}
        <Button variant="ghost" className="clear-all" onClick={clearAll}>Clear all</Button>
      </div>}

      {!tagSupported && <p className="browse-notice">Tag filtering is unavailable in this static snapshot, so the selected tag was not applied.</p>}
      <div className="browse-heading"><div><BookOpen /><h2>Novels</h2></div><span>{hasLoaded ? `${total.toLocaleString()} matches` : 'Catalog status unavailable'}</span></div>
      {error && <p className="browse-error">{error}</p>}
      <section className="browse-grid">
        {items.map((novel) => <BrowseCard key={novel.id} novel={novel} onOpen={() => openDetail(novel.id)} />)}
      </section>
      {!loading && hasLoaded && !items.length && !error && <p className="browse-empty">No novels match these filters.</p>}
      {loading && <div className="browse-loading" role="status"><span /> Loading {page > 1 ? 'more novels' : 'catalog'}…</div>}
      {hasMore && !loading && <div className="browse-pagination"><Button className="browse-more" onClick={() => setPage((value) => value + 1)}>Load {PAGE_SIZE} more</Button><span>Showing {items.length.toLocaleString()} of {total.toLocaleString()}</span></div>}

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

function BrowseCard({ novel, onOpen }: { novel: BrowseNovel; onOpen: () => void }) {
  const { settings } = useDisplaySettings();
  const title = displayNovelTitle(novel.title, undefined, settings.titlePreference);
  return <article className="browse-card">
    <button className="browse-cover" onClick={onOpen}>
      {novel.cover_url ? <img src={novel.cover_url} alt="" loading="lazy" /> : <BookOpen />}
    </button>
    <div>
      <button className="browse-title" onClick={onOpen}>{title}</button>
      <p>{novel.author ? <a href={browseFacetUrl('author', novel.author)}>{novel.author}</a> : 'Unknown author'}</p>
      <div className="browse-meta"><span><Star size={14} /> {novel.rating ? novel.rating.toFixed(1) : '—'} <small>({novel.rating_votes.toLocaleString()})</small></span>
        <span><Users size={14} /> {novel.reading_list_count.toLocaleString()}</span></div>
      <div className="browse-chips">{novel.genres?.slice(0, 3).map((item) => <a key={item} href={browseFacetUrl('genre', item)}>{item}</a>)}</div>
      <footer><button onClick={onOpen}>Details</button><a href={novel.novelupdates_url} target="_blank" rel="noopener noreferrer" aria-label={`${title} on Novel Updates`}><ExternalLink size={15} /></a></footer>
    </div>
  </article>;
}
