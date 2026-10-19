import { useEffect, useState } from 'react';
import { ArrowLeft, ExternalLink, Star } from 'lucide-react';
import { createDataSource } from './data';
import { DSButton, Skeleton } from './design-system';
import { cleanListTitle } from './forYouNames';
import { loadListFile, staticLists } from './forYouStatic';
import type { ListSummary } from './ForYouPage';
import { hasUsableCover, novelPageUrl } from './novelLinks';
import type { NovelSearchResult } from './types';
import './for-you.css';
import './list-page.css';

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; summary?: ListSummary; title: string; seeds: number; titles: NovelSearchResult[]; missing: number };

function Cover({ novel }: { novel: NovelSearchResult }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="fy-cover">
      {hasUsableCover(novel.cover_url) && !failed ? (
        <img src={novel.cover_url} alt="" loading="lazy" decoding="async" width={168} height={252} onError={() => setFailed(true)} />
      ) : (
        <span aria-hidden="true">{novel.title.slice(0, 1)}</span>
      )}
      <div className="fy-stats">
        <span className="fy-rating" title={`${novel.rating_votes.toLocaleString()} votes`}><Star size={12} />{novel.rating ? novel.rating.toFixed(1) : '—'}</span>
      </div>
    </div>
  );
}

export default function ListPage(): JSX.Element {
  const id = Number(new URLSearchParams(window.location.search).get('id'));
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    if (!Number.isInteger(id) || id <= 0) {
      setState({ status: 'error', message: 'No list was specified.' });
      return;
    }
    let cancelled = false;
    (async () => {
      const [file, lists] = await Promise.all([loadListFile(id), staticLists().catch(() => [] as ListSummary[])]);
      const cards = await (await createDataSource()).resolveNovelIds(file.members);
      const titles = file.members.flatMap((member) => (cards.has(member) ? [cards.get(member)!] : []));
      if (cancelled) return;
      setState({
        status: 'ready',
        summary: lists.find((list) => list.id === id),
        title: cleanListTitle(file.title, id) || file.title,
        seeds: file.seeds.length,
        titles,
        missing: file.members.length - titles.length,
      });
    })().catch((error) => {
      if (!cancelled) setState({ status: 'error', message: error instanceof Error ? error.message : 'Could not load this list.' });
    });
    return () => { cancelled = true; };
  }, [id]);

  const sourceUrl = `https://www.novelupdates.com/viewlist/${id}/`;
  const back = `${import.meta.env.BASE_URL}?view=foryou`;

  return (
    <main className="fy-shell list-page">
      <DSButton as="a" variant="ghost" className="fy-back" href={back}><ArrowLeft size={16} /> Back to For You</DSButton>
      {state.status === 'loading' && (
        <>
          <h1>Loading list…</h1>
          <div className="fy-grid">{Array.from({ length: 12 }, (_, i) => <Skeleton key={i} className="fy-card-skeleton" />)}</div>
        </>
      )}
      {state.status === 'error' && (
        <section className="list-page-error">
          <h1>List not available</h1>
          <p>{state.message} Lists appear here once they are part of the For You snapshot.</p>
          {id > 0 && <a href={sourceUrl} target="_blank" rel="noopener noreferrer">Open it on Novel Updates <ExternalLink size={13} /></a>}
        </section>
      )}
      {state.status === 'ready' && (
        <>
          <header className="list-page-head">
            <span className="eyebrow">Curated list</span>
            <h1>{state.title}</h1>
            <p>
              {state.summary?.curator ? `Curated by ${state.summary.curator} · ` : ''}
              {state.titles.length.toLocaleString()} titles
              {state.summary?.theme?.length ? ` · ${state.summary.theme.slice(0, 3).join(', ')}` : ''}
            </p>
            <a href={sourceUrl} target="_blank" rel="noopener noreferrer">View on Novel Updates <ExternalLink size={13} /></a>
          </header>
          <div className="fy-grid">
            {state.titles.map((novel) => (
              <a key={novel.id} className="fy-card" data-preview-id={novel.id} href={novelPageUrl(novel.id, undefined, novel.media_type)}>
                <Cover novel={novel} />
                <strong title={novel.title}>{novel.title}</strong>
                {novel.author && <small>{novel.author}</small>}
              </a>
            ))}
          </div>
          {state.missing > 0 && <p className="fy-end">{state.missing} more title{state.missing === 1 ? '' : 's'} on this list {state.missing === 1 ? 'is' : 'are'} not in this catalog snapshot.</p>}
        </>
      )}
    </main>
  );
}
