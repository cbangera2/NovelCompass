import { useEffect, useState } from 'react';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { createDataSource } from './data';
import { DSButton, Skeleton } from './design-system';
import { cleanListTitle } from './forYouNames';
import { loadListFile, staticLists } from './forYouStatic';
import type { ListSummary } from './ForYouPage';
import { NovelCard } from './components/NovelCard';
import { hasUsableCover, novelPageUrl } from './novelLinks';
import type { NovelSearchResult } from './types';
import './for-you.css';
import './list-page.css';

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; summary?: ListSummary; title: string; seeds: number; titles: NovelSearchResult[]; missing: number };

/** A blurred strip of the list's first covers behind the header, the list-page twin of the title-page splash. */
function SplashCollage({ covers }: { covers: string[] }) {
  if (!covers.length) return null;
  return (
    <div className="splash-collage" aria-hidden="true">
      {covers.map((src) => <img key={src} src={src} alt="" decoding="async" />)}
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

  useEffect(() => {
    if (state.status === 'ready') document.title = `${state.title} - Novel Compass`;
  }, [state]);

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
            <SplashCollage covers={state.titles.filter((novel) => hasUsableCover(novel.cover_url)).slice(0, 6).map((novel) => novel.cover_url!)} />
            <span className="eyebrow">Curated list</span>
            <h1>{state.title}</h1>
            <p>
              {state.titles.length.toLocaleString()} titles
              {state.summary?.theme?.length ? ` · ${state.summary.theme.slice(0, 3).join(', ')}` : ''}
            </p>
            <a href={sourceUrl} target="_blank" rel="noopener noreferrer">View on Novel Updates <ExternalLink size={13} /></a>
          </header>
          <div className="fy-grid">
            {state.titles.map((novel) => (
              <NovelCard
                key={novel.id}
                variant="tile"
                className="fy-card"
                item={{
                  id: novel.id,
                  title: novel.title,
                  href: novelPageUrl(novel.id, undefined, novel.media_type),
                  coverUrl: novel.cover_url,
                  mediaType: novel.media_type,
                  author: novel.author,
                  rating: novel.rating,
                  ratingVotes: novel.rating_votes,
                }}
              />
            ))}
          </div>
          {state.missing > 0 && <p className="fy-end">{state.missing} more title{state.missing === 1 ? '' : 's'} on this list {state.missing === 1 ? 'is' : 'are'} not in this catalog snapshot.</p>}
        </>
      )}
    </main>
  );
}
