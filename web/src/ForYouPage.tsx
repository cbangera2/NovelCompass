import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, Eye, EyeOff, SlidersHorizontal, Sparkles, Star } from 'lucide-react';
import { DSButton, Skeleton } from './design-system';
import { formatStatusLabel, hasUsableCover, novelPageUrl } from './novelLinks';
import { loadLocalProfile, subscribeLocalProfile } from './profile/store';
import { computeTasteProfile, type TasteProfile } from './profile/taste';
import type { LocalUserProfile, ReadingStatus } from './profile/types';
import { planLibraryRows, type LibrarySeed } from './forYouLibrary';
import type { NovelDetail } from './types';
import { isStaticSource, staticLibraryRow, staticListRow, rankListsByLibrary, staticLists } from './forYouStatic';
import { cleanListTitle } from './forYouNames';
import { registerPreviews, type PreviewData } from './CoverPreview';
import './for-you.css';
import { FormatScopeChip } from './components/FormatScopeChip';

export interface ListSummary {
  id: number;
  title: string;
  curator?: string | null;
  items: number;
  theme?: string[];
}

export interface RowRec {
  target_id: number;
  title: string;
  cover_url?: string;
  media_type?: string;
  rating: number;
  rating_votes: number;
  status_trans: string;
  match_score_percent: number;
  evidence_bullets: string[];
  shared_tags: string[];
  on_lists?: string[];
}

export interface RowData {
  title: string;
  subtitle: string;
  seeds: Array<{ id: number; title: string }>;
  recommendations: RowRec[];
}

type RowState = { status: 'loading' } | { status: 'error'; message: string } | ({ status: 'ready' } & RowData);

interface RowJob {
  key: string;
  fallbackTitle: string;
  heading?: string; // overrides the server's title
  blurb?: string; // overrides the seed-title subtitle
  load: (limit: number, signal: AbortSignal) => Promise<RowData>;
}

const STATUS_LABELS: Record<ReadingStatus, string> = {
  reading: 'Reading',
  completed: 'Completed',
  plan_to_read: 'Plan to read',
  dropped: 'Dropped',
  paused: 'Paused',
};

const ROW_LIMIT = 24;
const GRID_LIMIT = 150; // /api/for-you/row's cap; ranking quality falls off well before this
const GRID_BATCH = 30;
const BLEND_LISTS = 4; // the 'Top picks' row blends the best-matching shelves only

async function loadLists(): Promise<ListSummary[]> {
  if (await isStaticSource()) return staticLists();
  const response = await fetch('/api/for-you/lists');
  if (!response.ok) throw new Error(`Server returned ${response.status}`);
  const lists: ListSummary[] = (await response.json()).lists;
  // Theme tags come from the precomputed snapshot; the live API doesn't compute them.
  const themes = new Map((await staticLists().catch(() => [] as ListSummary[])).map((l) => [l.id, l.theme]));
  liveListSizes = new Map(lists.map((l) => [l.id, l.items]));
  return lists.map((l) => ({ ...l, theme: themes.get(l.id) }));
}

async function postJson<T>(url: string, body: unknown, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw new Error(detail?.detail || `Server returned ${response.status}`);
  }
  return response.json();
}

let liveListSizes = new Map<number, number>();

async function fetchListRow(
  listIds: number[],
  blend: boolean,
  hideKnown: boolean,
  excludeIds: number[],
  listTitles: Record<number, string>,
  limit: number,
  signal: AbortSignal,
): Promise<RowData> {
  if (await isStaticSource()) return staticListRow(listIds, blend, hideKnown, excludeIds, listTitles, limit);
  // Fast path: list rows are precomputed, so serve them from the snapshot (files + one id lookup) and only
  // fall back to the engine when a list isn't in it or has changed since it was built.
  try {
    return await staticListRow(listIds, blend, hideKnown, excludeIds, listTitles, limit, liveListSizes);
  } catch { /* not in the snapshot or stale: compute live */ }
  return postJson(
    '/api/for-you/row',
    { list_ids: listIds, blend, hide_known: hideKnown, exclude_novel_ids: excludeIds, list_titles: listTitles, limit },
    signal,
  );
}

/** Like/avoid tags from the library. Detail fetches are best-effort so one failure never blocks the rows. */
async function loadLibraryTaste(
  profile: LocalUserProfile,
  seeds: LibrarySeed[],
  negativeIds: number[],
  signal: AbortSignal,
): Promise<TasteProfile> {
  const ids = [...new Set([...seeds.slice(0, 10).map((s) => s.id), ...negativeIds])];
  if (await isStaticSource()) return computeTasteProfile(profile, []); // static rows don't use tag affinity
  const results = await Promise.allSettled(
    ids.map((id) =>
      fetch(`/api/novels/${id}`, { signal }).then((r) => (r.ok ? (r.json() as Promise<NovelDetail>) : Promise.reject(new Error(String(r.status))))),
    ),
  );
  const details = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
  // computeTasteProfile only treats dropped / low-rated as negative; here paused counts too.
  const entries = profile.entries.map((e) => (e.status === 'paused' ? { ...e, status: 'dropped' as const } : e));
  return computeTasteProfile({ ...profile, entries }, details);
}

async function fetchLibraryRow(
  title: string,
  subtitle: string,
  seeds: LibrarySeed[],
  taste: Promise<TasteProfile>,
  excludeIds: number[],
  limit: number,
  signal: AbortSignal,
): Promise<RowData> {
  if (await isStaticSource()) return staticLibraryRow(title, subtitle, seeds, excludeIds, limit);
  const t = await taste.catch(() => null);
  const data = await postJson<{ recommendations: RowRec[] }>(
    '/api/recommend/for-you',
    {
      seeds: seeds.map((s) => ({ id: s.id, weight: s.weight, title: s.title })),
      exclude_novel_ids: excludeIds,
      liked_tags: (t?.liked_tags ?? []).map((f) => ({ name: f.name, weight: f.weight })),
      avoid_tags: (t?.avoid_tags ?? []).map((f) => ({ name: f.name, weight: f.weight })),
      media_type: 'novel',
      limit,
    },
    signal,
  );
  const top = Math.max(1, ...data.recommendations.map((r) => r.match_score_percent));
  return {
    title,
    subtitle,
    seeds: seeds.map((s) => ({ id: s.id, title: s.title })),
    // Absolute percents are close together for multi-seed rows; show strength relative to the row's best.
    recommendations: data.recommendations.map((r) => ({ ...r, match_score_percent: Math.round((100 * r.match_score_percent) / top) })),
  };
}

function Cover({ rec, status, eager }: { rec: RowRec; status?: ReadingStatus; eager?: boolean }) {
  const [failed, setFailed] = useState(false);
  const onList = rec.on_lists ?? [];
  return (
    <div className="fy-cover">
      {hasUsableCover(rec.cover_url) && !failed ? (
        <img src={rec.cover_url} alt="" loading={eager ? 'eager' : 'lazy'} fetchPriority={eager ? 'high' : 'auto'} decoding="async" width={168} height={252} onError={() => setFailed(true)} />
      ) : (
        <span aria-hidden="true">{rec.title.slice(0, 1)}</span>
      )}
      {status && <span className={`fy-status status-${status}`}>{STATUS_LABELS[status]}</span>}
      {onList.length > 0 && <span className="fy-known" title={`On your list: ${onList.join(', ')}`}>On your list</span>}
      <div className="fy-stats">
        <span className="fy-rating" title={`${rec.rating_votes.toLocaleString()} votes`}><Star size={12} />{rec.rating ? rec.rating.toFixed(1) : '—'}</span>
        {rec.status_trans && <span>{formatStatusLabel(rec.status_trans)}</span>}
        <span className="fy-match">{Math.round(rec.match_score_percent)}%</span>
      </div>
    </div>
  );
}

/** Feed the shared cover hover card so For You picks preview instantly, match data and all. */
function previewFor(rec: RowRec): PreviewData {
  return {
    id: rec.target_id,
    title: rec.title,
    rating: rec.rating,
    rating_votes: rec.rating_votes,
    media_type: rec.media_type,
    status_trans: rec.status_trans,
    statsOnCover: true,
    matchPercent: rec.match_score_percent,
    sharedTags: rec.shared_tags,
    bullets: rec.evidence_bullets,
  };
}

function RecCard({ rec, library, eager }: { rec: RowRec; library: Map<number, ReadingStatus>; eager?: boolean }) {
  return (
    <a className="fy-card" data-preview-id={rec.target_id} href={novelPageUrl(rec.target_id, undefined, rec.media_type)}>
      <Cover rec={rec} status={library.get(rec.target_id)} eager={eager} />
      <strong title={rec.title}>{rec.title}</strong>
      <div className="fy-strength" title={`${rec.match_score_percent}% of this row's strongest match`}>
        <i style={{ width: `${Math.max(6, rec.match_score_percent)}%` }} />
      </div>
      <small>{rec.evidence_bullets[0]}</small>
    </a>
  );
}

function seedLine(data: RowData) {
  const names = data.seeds.slice(0, 3).map((s) => s.title).join(', ');
  return `${data.subtitle}: ${names}${data.seeds.length > 3 ? ` +${data.seeds.length - 3} more` : ''}`;
}

function Row({
  state,
  fallbackTitle,
  heading,
  blurb,
  library,
  onSeeAll,
  onVisible,
}: {
  state: RowState;
  fallbackTitle: string;
  heading?: string;
  blurb?: string;
  library: Map<number, ReadingStatus>;
  onSeeAll: () => void;
  onVisible: () => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const section = useRef<HTMLElement>(null);
  const visibleRef = useRef(onVisible);
  visibleRef.current = onVisible;
  useEffect(() => {
    const node = section.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => { if (entries.some((e) => e.isIntersecting)) { visibleRef.current(); observer.disconnect(); } },
      { rootMargin: '500px 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const scroll = (direction: number) =>
    track.current?.scrollBy({ left: direction * track.current.clientWidth * 0.85, behavior: 'smooth' });

  return (
    <section className="fy-row" ref={section}>
      <header>
        <div>
          <h2>{heading ?? (state.status === 'ready' ? state.title : fallbackTitle)}</h2>
          {state.status === 'ready' && <p title={state.seeds.map((s) => s.title).join(', ')}>{blurb ?? seedLine(state)}</p>}
        </div>
        {state.status === 'ready' && (
          <div className="fy-row-nav">
            <DSButton variant="ghost" onClick={onSeeAll}>See all</DSButton>
            <DSButton variant="ghost" className="fy-scroll-btn" aria-label="Scroll left" onClick={() => scroll(-1)}><ChevronLeft size={18} /></DSButton>
            <DSButton variant="ghost" className="fy-scroll-btn" aria-label="Scroll right" onClick={() => scroll(1)}><ChevronRight size={18} /></DSButton>
          </div>
        )}
      </header>
      {state.status === 'error' && <p className="fy-error">Couldn't load this row: {state.message}</p>}
      <div className="fy-track" ref={track}>
        {state.status === 'loading' &&
          Array.from({ length: 7 }, (_, i) => <Skeleton key={i} className="fy-card-skeleton" />)}
        {state.status === 'ready' && state.recommendations.map((rec, i) => <RecCard key={rec.target_id} rec={rec} library={library} eager={i < 7} />)}
        {state.status === 'ready' && state.recommendations.length === 0 && <p className="fy-empty">Nothing left to show after filtering.</p>}
      </div>
    </section>
  );
}

/** One row's picks as a grid. Fetches the full capped set, then reveals it in batches as you scroll. */
function RowGrid({
  job,
  preview,
  library,
  onBack,
}: {
  job: RowJob;
  preview: RowState;
  library: Map<number, ReadingStatus>;
  onBack: () => void;
}) {
  const [state, setState] = useState<RowState>(preview);
  const [fullyLoaded, setFullyLoaded] = useState(false);
  const [shown, setShown] = useState(GRID_BATCH);
  const sentinel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    window.scrollTo({ top: 0 });
    const controller = new AbortController();
    job.load(GRID_LIMIT, controller.signal)
      .then((data) => { setState({ status: 'ready', ...data }); setFullyLoaded(true); })
      .catch((error) => { if (!controller.signal.aborted) setState({ status: 'error', message: error.message }); });
    return () => controller.abort();
  }, [job]);

  const total = state.status === 'ready' ? state.recommendations.length : 0;
  useEffect(() => {
    const node = sentinel.current;
    if (!node || shown >= total) return;
    const observer = new IntersectionObserver(
      (entries) => { if (entries.some((e) => e.isIntersecting)) setShown((n) => n + GRID_BATCH); },
      { rootMargin: '600px 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [shown, total]);

  return (
    <section className="fy-row fy-grid-view">
      <header>
        <div>
          <DSButton variant="ghost" className="fy-back" onClick={onBack}><ArrowLeft size={16} /> Back to rows</DSButton>
          <h2>{job.heading ?? (state.status === 'ready' ? state.title : job.fallbackTitle)}</h2>
          {state.status === 'ready' && <p title={state.seeds.map((s) => s.title).join(', ')}>{job.blurb ?? seedLine(state)}</p>}
        </div>
      </header>
      {state.status === 'error' && <p className="fy-error">Couldn't load this row: {state.message}</p>}
      <div className="fy-grid">
        {state.status === 'loading' && Array.from({ length: 12 }, (_, i) => <Skeleton key={i} className="fy-card-skeleton" />)}
        {state.status === 'ready' && state.recommendations.slice(0, shown).map((rec) => <RecCard key={rec.target_id} rec={rec} library={library} />)}
      </div>
      {state.status === 'ready' && shown < total && <div ref={sentinel} className="fy-sentinel" aria-hidden="true" />}
      {state.status === 'ready' && !fullyLoaded && <p className="fy-end">Loading more picks…</p>}
      {state.status === 'ready' && fullyLoaded && shown >= total && (
        <p className="fy-end">
          {total >= GRID_LIMIT ? `That's the top ${GRID_LIMIT}.` : `That's all ${total} picks.`} Quality drops past this point.
        </p>
      )}
    </section>
  );
}

export default function ForYouPage(): JSX.Element {
  const [lists, setLists] = useState<ListSummary[] | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [hideKnown, setHideKnown] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [shelvesOpen, setShelvesOpen] = useState(false);
  const [profile, setProfile] = useState<LocalUserProfile | null>(null);
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [listError, setListError] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [response, profile] = await Promise.all([loadLists(), loadLocalProfile().catch(() => null)]);
        const data = { lists: response };
        if (cancelled) return;
        setLists(data.lists);
        // Every named list becomes a shelf. Order: your own lists, then the closest matches to your library, then the rest.
        const curated = data.lists.filter((l) => l.curator);
        const mine = new Set((profile?.curated_lists ?? []).map((l) => l.id));
        const matched = await rankListsByLibrary(curated, profile?.entries ?? []).catch(() => [] as number[]);
        if (cancelled) return;
        const priority = [...curated.filter((l) => mine.has(l.id)).map((l) => l.id), ...matched];
        const order = [...new Set([...priority, ...curated.map((l) => l.id)])];
        setSelected(order);
      } catch (error) {
        if (!cancelled) setListError(error instanceof Error ? error.message : 'Could not load your lists');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    loadLocalProfile().then(setProfile).catch(() => setProfile(null));
    return subscribeLocalProfile(setProfile);
  }, []);

  // Library titles by catalog ID. "Seen" excludes plan-to-read, which you haven't read yet.
  const library = useMemo(() => {
    const map = new Map<number, ReadingStatus>();
    for (const entry of profile?.entries ?? []) if (entry.novel_id != null) map.set(entry.novel_id, entry.status);
    return map;
  }, [profile]);
  const seenIds = useMemo(
    () => [...library].filter(([, status]) => status !== 'plan_to_read').map(([id]) => id).sort((a, b) => a - b),
    [library],
  );
  const seenKey = seenIds.join(',');
  // The profile knows your lists' real names; the DB may only hold a placeholder for imported ones.
  const profileTitles = useMemo(
    () => Object.fromEntries((profile?.curated_lists ?? []).map((list) => [list.id, list.title])),
    [profile],
  );
  const plan = useMemo(() => planLibraryRows(profile), [profile]);
  const planKey = JSON.stringify(plan);

  const selectedKey = selected.join(',');
  const jobs = useMemo<RowJob[]>(() => {
    const out: RowJob[] = [];
    const exclude = hideKnown ? seenIds : [];
    const libraryJobs: Array<{ key: string; title: string; subtitle: string; seeds: LibrarySeed[] }> = [
      { key: 'lib-rated', title: 'Because you rated highly', subtitle: 'Seeded by your top-rated titles', seeds: plan.rated },
      { key: 'lib-finished', title: 'From what you finished', subtitle: 'Seeded by titles you completed', seeds: plan.finished },
    ];
    if (profile) {
      // One shared taste lookup per job set; created lazily so it only runs if a library row loads.
      let taste: Promise<TasteProfile> | null = null;
      const getTaste = (signal: AbortSignal) =>
        (taste ??= loadLibraryTaste(profile, [...plan.rated, ...plan.finished], plan.negativeIds, signal));
      for (const lj of libraryJobs.filter((j) => j.seeds.length)) {
        out.push({
          key: lj.key,
          fallbackTitle: lj.title,
          load: (limit, signal) => fetchLibraryRow(lj.title, lj.subtitle, lj.seeds, getTaste(signal), exclude, limit, signal),
        });
      }
    }
    if (selected.length > 1) {
      out.push({
        key: 'blend',
        fallbackTitle: 'Top picks for you',
        load: (limit, signal) => fetchListRow(selected.slice(0, BLEND_LISTS), true, hideKnown, exclude, profileTitles, limit, signal),
      });
    }
    for (const id of selected) {
      out.push({
        key: `list-${id}`,
        fallbackTitle: 'Because you love this list',
        load: (limit, signal) => fetchListRow([id], false, hideKnown, exclude, profileTitles, limit, signal),
      });
    }
    return out;
    // plan/profile are covered by planKey; seenIds by seenKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey, hideKnown, seenKey, profileTitles, planKey]);

  const [epoch, setEpoch] = useState(0); // bumped when jobs change so rows remount and re-arm their visibility trigger
  // Rows load when they near the viewport, so a visit only pays for what is actually scrolled to.
  const loader = useRef<{ controller: AbortController; requested: Set<string> }>({ controller: new AbortController(), requested: new Set() });
  useEffect(() => {
    const controller = new AbortController();
    loader.current = { controller, requested: new Set() };
    setEpoch((n) => n + 1);
    setRows(Object.fromEntries(jobs.map((j) => [j.key, { status: 'loading' } as RowState])));
    return () => controller.abort();
  }, [jobs]);
  const requestRow = (job: RowJob) => {
    const { controller, requested } = loader.current;
    if (requested.has(job.key)) return;
    requested.add(job.key);
    job.load(ROW_LIMIT, controller.signal)
      .then((data) => {
        registerPreviews(data.recommendations.map(previewFor));
        setRows((prev) => ({ ...prev, [job.key]: { status: 'ready', ...data } }));
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setRows((prev) => ({ ...prev, [job.key]: { status: 'error', message: error.message } }));
      });
  };

  const titles = useMemo(
    () => new Map((lists ?? []).map((l) => [l.id, profileTitles[l.id] ?? l.title])),
    [lists, profileTitles],
  );
  const toggle = (id: number) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const expandedJob = expanded ? jobs.find((j) => j.key === expanded) : undefined;
  const hasLibraryRows = plan.rated.length > 0 || plan.finished.length > 0;
  const headingFor = (job: RowJob) =>
    job.key.startsWith('list-') ? cleanListTitle(titles.get(Number(job.key.slice(5))) ?? '', Number(job.key.slice(5))) || undefined : undefined;
  const blurbFor = (job: RowJob) => {
    if (job.key === 'blend') return `A mix of your top ${Math.min(selected.length, BLEND_LISTS)} shelves`;
    if (!job.key.startsWith('list-')) return undefined;
    const list = (lists ?? []).find((l) => l.id === Number(job.key.slice(5)));
    if (!list) return undefined;
    const parts = [list.curator ? `Curated by ${list.curator}` : '', ...(list.theme ?? []).slice(0, 3)];
    return parts.filter(Boolean).join(' · ') || undefined;
  };
  const fallbackTitle = (job: RowJob) =>
    job.key.startsWith('list-') ? `Because you love ${titles.get(Number(job.key.slice(5))) ?? 'this list'}` : job.fallbackTitle;

  if (expandedJob) {
    return (
      <main className="fy-shell">
        <RowGrid
          job={{ ...expandedJob, fallbackTitle: fallbackTitle(expandedJob), heading: headingFor(expandedJob), blurb: blurbFor(expandedJob) }}
          preview={rows[expandedJob.key] ?? { status: 'loading' }}
          library={library}
          onBack={() => setExpanded(null)}
        />
      </main>
    );
  }

  return (
    <main className="fy-shell">
      <header className="fy-hero">
        <p className="eyebrow"><Sparkles size={14} /> For You</p>
        <h1>Picked from what you love</h1>
        <FormatScopeChip />
        <p>
          Rows start from your library (what you rated highly or finished) and from your lists, using their top titles as seeds.
          Titles from your library show their reading status and titles from your lists are badged, so you can sanity-check
          the picks; the toggle hides what you've read.
        </p>
      </header>

      <div className="fy-controls">
        <DSButton variant="outline" onClick={() => setShelvesOpen((v) => !v)} aria-expanded={shelvesOpen}>
          <SlidersHorizontal size={15} /> Shelves · {selected.length}
        </DSButton>
        <DSButton variant="outline" onClick={() => setHideKnown((v) => !v)} aria-pressed={hideKnown}>
          {hideKnown ? <EyeOff size={15} /> : <Eye size={15} />} {hideKnown ? `Hiding ${seenIds.length.toLocaleString()} I've read` : 'Showing titles I\'ve read'}
        </DSButton>
      </div>
      {shelvesOpen && (
        <div className="fy-lists" role="group" aria-label="Shelves">
          {(lists ?? []).filter((list) => list.curator || selected.includes(list.id) || showAll).map((list) => (
            <button
              key={list.id}
              className={selected.includes(list.id) ? 'active' : ''}
              onClick={() => toggle(list.id)}
              aria-pressed={selected.includes(list.id)}
              title={list.theme?.length ? `${titles.get(list.id) ?? list.title} · ${list.items} titles · ${list.theme.join(', ')}` : undefined}
            >
              {cleanListTitle(titles.get(list.id) ?? list.title, list.id)}
            </button>
          ))}
          {(lists ?? []).some((list) => !list.curator) && (
            <button className="fy-more" onClick={() => setShowAll((v) => !v)}>
              {showAll ? 'Hide unnamed lists' : 'Show unnamed lists'}
            </button>
          )}
        </div>
      )}

      {listError && <p className="fy-error">{listError}. For You needs the live API or a For You snapshot.</p>}
      {profile && !hasLibraryRows && (
        <p className="fy-empty fy-library-empty">
          No library rows yet: none of your matched titles are rated 4★+ or completed. Rate titles or mark them Completed on your{' '}
          <a href="?view=profile">profile</a> and rows seeded from your library will appear here.
        </p>
      )}
      {!profile && (
        <p className="fy-empty fy-library-empty">
          Import your library on your <a href="?view=profile">profile</a> to get rows seeded from what you rated highly or finished.
        </p>
      )}
      {lists && !selected.length && <p className="fy-empty">Pick at least one list above to build list rows.</p>}
      {jobs.map((job) => (
        <Row
          key={`${epoch}-${job.key}`}
          state={rows[job.key] ?? { status: 'loading' }}
          fallbackTitle={fallbackTitle(job)}
          heading={headingFor(job)}
          blurb={blurbFor(job)}
          library={library}
          onSeeAll={() => setExpanded(job.key)}
          onVisible={() => requestRow(job)}
        />
      ))}
    </main>
  );
}
