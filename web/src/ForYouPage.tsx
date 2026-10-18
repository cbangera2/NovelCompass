import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Eye, EyeOff, Sparkles } from 'lucide-react';
import { Badge, DSButton, Skeleton } from './design-system';
import { hasUsableCover, novelPageUrl } from './novelLinks';
import { loadLocalProfile } from './profile/store';
import './for-you.css';

interface ListSummary {
  id: number;
  title: string;
  curator?: string | null;
  items: number;
}

interface RowRec {
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
  on_lists: string[];
}

interface RowData {
  title: string;
  subtitle: string;
  seeds: Array<{ id: number; title: string }>;
  recommendations: RowRec[];
}

type RowState = { status: 'loading' } | { status: 'error'; message: string } | ({ status: 'ready' } & RowData);

async function fetchRow(listIds: number[], blend: boolean, hideKnown: boolean, signal: AbortSignal): Promise<RowData> {
  const response = await fetch('/api/for-you/row', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ list_ids: listIds, blend, hide_known: hideKnown, limit: 24 }),
    signal,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.detail || `Server returned ${response.status}`);
  }
  return response.json();
}

function Row({ state, fallbackTitle }: { state: RowState; fallbackTitle: string }) {
  const track = useRef<HTMLDivElement>(null);
  const scroll = (direction: number) =>
    track.current?.scrollBy({ left: direction * track.current.clientWidth * 0.85, behavior: 'smooth' });

  return (
    <section className="fy-row">
      <header>
        <div>
          <h2>{state.status === 'ready' ? state.title : fallbackTitle}</h2>
          {state.status === 'ready' && (
            <p title={state.seeds.map((s) => s.title).join(', ')}>
              {state.subtitle}: {state.seeds.slice(0, 3).map((s) => s.title).join(', ')}
              {state.seeds.length > 3 ? ` +${state.seeds.length - 3} more` : ''}
            </p>
          )}
        </div>
        {state.status === 'ready' && (
          <div className="fy-row-nav">
            <DSButton variant="ghost" aria-label="Scroll left" onClick={() => scroll(-1)}><ChevronLeft size={18} /></DSButton>
            <DSButton variant="ghost" aria-label="Scroll right" onClick={() => scroll(1)}><ChevronRight size={18} /></DSButton>
          </div>
        )}
      </header>
      {state.status === 'error' && <p className="fy-error">Couldn't load this row: {state.message}</p>}
      <div className="fy-track" ref={track}>
        {state.status === 'loading' &&
          Array.from({ length: 7 }, (_, i) => <Skeleton key={i} className="fy-card-skeleton" />)}
        {state.status === 'ready' &&
          state.recommendations.map((rec) => (
            <a className="fy-card" key={rec.target_id} href={novelPageUrl(rec.target_id, undefined, rec.media_type)}>
              <div className="fy-cover">
                {hasUsableCover(rec.cover_url) ? (
                  <img src={rec.cover_url} alt="" loading="lazy" />
                ) : (
                  <span>{rec.title.slice(0, 1)}</span>
                )}
                {rec.on_lists.length > 0 && (
                  <span className="fy-known" title={`On your list: ${rec.on_lists.join(', ')}`}>On your list</span>
                )}
              </div>
              <strong title={rec.title}>{rec.title}</strong>
              <div className="fy-strength" title={`${rec.match_score_percent}% of this row's strongest match`}>
                <i style={{ width: `${Math.max(6, rec.match_score_percent)}%` }} />
              </div>
              <small>{rec.evidence_bullets[0]}</small>
            </a>
          ))}
      </div>
    </section>
  );
}

export default function ForYouPage(): JSX.Element {
  const [lists, setLists] = useState<ListSummary[] | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [hideKnown, setHideKnown] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [listError, setListError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [response, profile] = await Promise.all([fetch('/api/for-you/lists'), loadLocalProfile().catch(() => null)]);
        if (!response.ok) throw new Error(`Server returned ${response.status}`);
        const data: { lists: ListSummary[] } = await response.json();
        if (cancelled) return;
        setLists(data.lists);
        const mine = new Set((profile?.curated_lists ?? []).map((l) => l.id));
        const preferred = data.lists.filter((l) => mine.has(l.id));
        const fallback = data.lists.filter((l) => l.curator).slice(0, 3);
        setSelected((preferred.length ? preferred : fallback).map((l) => l.id));
      } catch (error) {
        if (!cancelled) setListError(error instanceof Error ? error.message : 'Could not load your lists');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const selectedKey = selected.join(',');
  useEffect(() => {
    if (!selected.length) { setRows({}); return; }
    const controller = new AbortController();
    const jobs: Array<{ key: string; ids: number[]; blend: boolean }> = [
      ...(selected.length > 1 ? [{ key: 'blend', ids: selected, blend: true }] : []),
      ...selected.map((id) => ({ key: `list-${id}`, ids: [id], blend: false })),
    ];
    setRows(Object.fromEntries(jobs.map((j) => [j.key, { status: 'loading' } as RowState])));
    for (const job of jobs) {
      fetchRow(job.blend ? job.ids : job.ids, job.blend, hideKnown, controller.signal)
        .then((data) => setRows((prev) => ({ ...prev, [job.key]: { status: 'ready', ...data } })))
        .catch((error) => {
          if (controller.signal.aborted) return;
          setRows((prev) => ({ ...prev, [job.key]: { status: 'error', message: error.message } }));
        });
    }
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey, hideKnown]);

  const titles = useMemo(() => new Map((lists ?? []).map((l) => [l.id, l.title])), [lists]);
  const toggle = (id: number) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  return (
    <main className="fy-shell">
      <header className="fy-hero">
        <p className="eyebrow"><Sparkles size={14} /> For You</p>
        <h1>Picked from the lists you love</h1>
        <p>
          Each row starts from one of your lists — its top-ranked titles are the seeds. Titles already on your lists are
          badged so you can sanity-check the picks.
        </p>
      </header>

      <div className="fy-controls">
        <div className="fy-lists" role="group" aria-label="Lists used for recommendations">
          {(lists ?? []).filter((list) => list.curator || selected.includes(list.id) || showAll).slice(0, 40).map((list) => (
            <button
              key={list.id}
              className={selected.includes(list.id) ? 'active' : ''}
              onClick={() => toggle(list.id)}
              aria-pressed={selected.includes(list.id)}
            >
              {list.title}
              <Badge>{list.items}</Badge>
            </button>
          ))}
          {(lists ?? []).some((list) => !list.curator) && (
            <button className="fy-more" onClick={() => setShowAll((v) => !v)}>
              {showAll ? 'Hide unnamed lists' : 'Show unnamed lists'}
            </button>
          )}
        </div>
        <DSButton variant="outline" onClick={() => setHideKnown((v) => !v)} aria-pressed={hideKnown}>
          {hideKnown ? <EyeOff size={15} /> : <Eye size={15} />} {hideKnown ? 'Hiding my lists' : 'Showing my lists'}
        </DSButton>
      </div>

      {listError && <p className="fy-error">{listError}. For You needs the live API (run the uvicorn server).</p>}
      {lists && !selected.length && <p className="fy-empty">Pick at least one list above to build your rows.</p>}
      {selected.length > 1 && rows.blend && <Row state={rows.blend} fallbackTitle="Top picks for you" />}
      {selected.map((id) => (
        <Row key={id} state={rows[`list-${id}`] ?? { status: 'loading' }} fallbackTitle={`Because you love ${titles.get(id) ?? 'this list'}`} />
      ))}
    </main>
  );
}
