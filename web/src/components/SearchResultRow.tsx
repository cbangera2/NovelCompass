import { ArrowRight, BookOpen, Sparkles } from 'lucide-react';
import { hasUsableCover, novelPageUrl } from '../novelLinks';
import type { NovelSearchResult } from '../types';
import { MediaBadges } from './NovelCard';
import { RatingChip } from './RatingChip';
import './novel-card.css';
import './search-row.css';

/**
 * Compact title row for the global search: same cover, media badges and rating chip as the cards.
 * With `onSelect` the whole row is a button (seed picking); otherwise it opens the novel page and a
 * trailing "Find related" link seeds Discover.
 */
export function SearchResultRow({ novel, title, onSelect, onNavigate }: {
  novel: NovelSearchResult;
  title: string;
  onSelect?: () => void;
  onNavigate?: () => void;
}) {
  const body = (
    <>
      {hasUsableCover(novel.cover_url)
        ? <img src={novel.cover_url} alt="" loading="lazy" />
        : <span className="search-row-fallback"><BookOpen size={16} /></span>}
      <span className="search-row-copy">
        <span className="suggestion-title-line">
          <strong>{title}</strong>
          <span className="suggestion-badges"><MediaBadges id={novel.id} mediaType={novel.media_type} source={novel.source} /></span>
        </span>
        <small>{novel.author || 'Catalog title'} · <RatingChip rating={novel.rating} votes={novel.rating_votes} size={11} /></small>
      </span>
    </>
  );
  if (onSelect) {
    return (
      <div className="search-row" data-preview-id={novel.id}>
        <button type="button" className="search-row-main" onClick={onSelect}>
          {body}
          <span className="search-row-action"><Sparkles size={14} aria-hidden="true" /> Use as seed</span>
        </button>
      </div>
    );
  }
  return (
    <div className="search-row" data-preview-id={novel.id}>
      <a className="search-row-main" href={novelPageUrl(novel.id)} onClick={onNavigate}>
        {body}
        <ArrowRight size={15} aria-hidden="true" />
      </a>
      <a className="search-row-related" href={`${import.meta.env.BASE_URL}?view=discover&seed=${novel.id}`}
        aria-label={`Find titles related to ${novel.title}`} title="Find related titles" onClick={onNavigate}>
        <Sparkles size={15} aria-hidden="true" />
      </a>
    </div>
  );
}
