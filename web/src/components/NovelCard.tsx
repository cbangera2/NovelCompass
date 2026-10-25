import { useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode } from 'react';
import { BookOpen, ChevronRight, ExternalLink, Sparkles, Users } from 'lucide-react';
import { navigateTo } from '../viewTransitions';
import { formatStatusLabel, getMediaBadgeInfo, hasUsableCover } from '../novelLinks';
import type { ReadingStatus } from '../profile/types';
import { RatingChip } from './RatingChip';
import { StatusBadge } from './StatusBadge';
import './novel-card.css';

/** The fields every card variant can show. Callers map their own row/recommendation shape onto this. */
export interface NovelCardItem {
  id: number;
  /** Already formatted for the user's title preference. */
  title: string;
  href: string;
  coverUrl?: string;
  mediaType?: string;
  source?: string;
  author?: string;
  authorHref?: string;
  onAuthorClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
  rating?: number;
  ratingVotes?: number;
  readers?: number;
  language?: string;
  languageHref?: string;
  statusTrans?: string;
  externalUrl?: string;
  externalLabel?: string;
}

interface NovelCardProps {
  variant: 'tile' | 'row' | 'detailed';
  item: NovelCardItem;
  libraryStatus?: ReadingStatus;
  libraryRating?: number;
  /** Match strength 0–100. Tiles show it on the cover; detailed cards above the title. */
  matchPercent?: number;
  /** Detailed: list position shown on the cover. */
  rank?: number;
  /** Tile: overlay pill such as "On your list". */
  coverNote?: { label: string; title?: string };
  /** Tile: thin strength bar under the title. */
  strengthPercent?: number;
  /** Tile: one muted line under the title (the main reason it was picked). */
  caption?: string;
  /** Tile: cover image priority for above-the-fold rows. */
  eager?: boolean;
  /** Tile: show the format (Manga, Anime, LN…) on the cover for mixed-format lists. */
  coverFormat?: boolean;
  /** Row: chips under the meta (genres). */
  chips?: ReactNode;
  /** Row: muted text at the start of the footer (year, chapters). */
  footerNote?: ReactNode;
  /** Detailed: evidence bullets. Duplicate "Shared key tropes" bullets are dropped when sharedTags is set. */
  evidence?: string[];
  /** Detailed: shared tags, collapsed behind a count. */
  sharedTags?: string[];
  tagHref?: (tag: string) => string;
  /** Row/detailed: buttons in the footer. Tile: icon buttons revealed over the cover on hover or focus. */
  actions?: ReactNode;
  /** Row/detailed: click on empty card space. Tile: plain click. Defaults to following item.href. */
  onActivate?: () => void;
  /** Extra content at the end of the card body (e.g. signal bars on related tiles). */
  children?: ReactNode;
  className?: string;
}

function Cover({ item, eager, children }: { item: NovelCardItem; eager?: boolean; children?: ReactNode }) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const usable = hasUsableCover(item.coverUrl) && !failed;
  return (
    <span className="nc-cover" data-preview-id={item.id} data-loaded={loaded || undefined}>
      {usable ? (
        <img
          src={item.coverUrl}
          alt=""
          loading={eager ? 'eager' : 'lazy'}
          fetchPriority={eager ? 'high' : 'auto'}
          decoding="async"
          // A cached image can finish before React attaches onLoad, hence the ref check.
          ref={(img) => { if (img?.complete && img.naturalWidth) setLoaded(true); }}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="nc-cover-fallback" aria-hidden="true">{item.title.slice(0, 1) || <BookOpen />}</span>
      )}
      {children}
    </span>
  );
}

/** Points the cover's tilt and sheen at the cursor (CSS reads the variables). Mouse only; touch has no hover. */
function trackPointer(event: PointerEvent<HTMLElement>) {
  if (event.pointerType !== 'mouse') return;
  const cover = event.currentTarget.querySelector<HTMLElement>('.nc-cover');
  if (!cover) return;
  const box = cover.getBoundingClientRect();
  const x = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
  const y = Math.min(1, Math.max(0, (event.clientY - box.top) / box.height));
  cover.style.setProperty('--rx', `${((x - .5) * 8).toFixed(2)}deg`);
  cover.style.setProperty('--ry', `${((.5 - y) * 8).toFixed(2)}deg`);
  cover.style.setProperty('--mx', `${(x * 100).toFixed(1)}%`);
  cover.style.setProperty('--my', `${(y * 100).toFixed(1)}%`);
}

function resetPointer(event: PointerEvent<HTMLElement>) {
  const cover = event.currentTarget.querySelector<HTMLElement>('.nc-cover');
  ['--rx', '--ry', '--mx', '--my'].forEach((name) => cover?.style.removeProperty(name));
}

/** Source + format badges (NovelUpdates / AniList, Novel / Manga / Anime). */
export function MediaBadges({ id, mediaType, source }: { id: number; mediaType?: string; source?: string }) {
  const badge = getMediaBadgeInfo({ id, media_type: mediaType, source });
  return (
    <>
      <span className={`search-badge source-badge ${badge.sourceKey}`}>{badge.sourceLabel}</span>
      <span className={`search-badge format-badge ${badge.formatKey}`}>{badge.formatLabel}</span>
    </>
  );
}

function Author({ item }: { item: NovelCardItem }) {
  if (!item.author) return <p className="nc-author">Unknown author</p>;
  return (
    <p className="nc-author" title={item.author}>
      {item.authorHref || item.onAuthorClick
        ? <a href={item.authorHref || '#'} onClick={item.onAuthorClick}>{item.author}</a>
        : item.author}
    </p>
  );
}

function ExternalLinkIcon({ item }: { item: NovelCardItem }) {
  if (!item.externalUrl) return null;
  const label = item.externalLabel || 'source';
  return (
    <a
      className="nc-external"
      href={item.externalUrl}
      target="_blank"
      rel="noopener noreferrer"
      title={`Open on ${label}`}
      aria-label={`Open ${item.title} on ${label}`}
    >
      <ExternalLink size={14} aria-hidden="true" />
    </a>
  );
}

function isInteractive(target: EventTarget) {
  return Boolean((target as HTMLElement).closest('a, button, summary, select, label, input, [role="menuitem"]'));
}

const SHARED_TROPES_BULLET = /^shared key tropes/i;
const VISIBLE_TAGS = 4;

/**
 * One card for every title list in the app.
 * - `tile`: cover-first with stats overlaid on the image. For You rows, related titles, and the compact Browse/Discover grids.
 * - `row`: cover on the left, compact metadata and actions (Browse grid/list).
 * - `detailed`: row plus match evidence and shared tags (Discover results).
 * Covers and titles carry `data-preview-id` so the global hover card works; row/detailed cards are its anchor.
 */
export function NovelCard(props: NovelCardProps) {
  const { variant, item, libraryStatus, libraryRating, className = '' } = props;

  if (variant === 'tile') {
    const { matchPercent, coverNote, strengthPercent, caption, eager, coverFormat, actions, onActivate, children } = props;
    const format = coverFormat ? getMediaBadgeInfo({ id: item.id, media_type: item.mediaType, source: item.source }) : null;
    const onTileClick = onActivate
      ? (event: MouseEvent<HTMLAnchorElement>) => {
          if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          onActivate();
        }
      : undefined;
    const tile = (
      <a
        className={`nc nc-tile ${actions ? '' : className}`.trim()}
        href={item.href}
        data-preview-id={item.id}
        onClick={onTileClick}
        onPointerMove={trackPointer}
        onPointerLeave={resetPointer}
        // The cover again, as a blurred glow behind the tile. CSS only applies it on hover, so lazy covers stay lazy.
        style={hasUsableCover(item.coverUrl) ? ({ '--nc-halo': `url("${item.coverUrl?.replace(/"/g, '%22')}")` } as CSSProperties) : undefined}
      >
        <Cover item={item} eager={eager}>
          {libraryStatus && <StatusBadge status={libraryStatus} variant="overlay" />}
          {format && <span className={`nc-cover-format format-${format.formatKey}`}>{format.formatLabel}</span>}
          {coverNote && <span className="nc-cover-note" title={coverNote.title}>{coverNote.label}</span>}
          <span className="nc-cover-stats">
            <RatingChip rating={item.rating} votes={item.ratingVotes} showVotes={false} variant="overlay" size={12} />
            {item.statusTrans && <span className="nc-cover-status">{formatStatusLabel(item.statusTrans)}</span>}
            {matchPercent != null && <span className="nc-match-pill">{Math.round(matchPercent)}%</span>}
          </span>
        </Cover>
        <strong className="nc-title" title={item.title}>{item.title}</strong>
        {item.author && <span className="nc-tile-author">{item.author}</span>}
        {strengthPercent != null && (
          <span className="nc-strength" title={`${Math.round(strengthPercent)}% of this row's strongest match`}>
            <i style={{ width: `${Math.max(6, strengthPercent)}%` }} />
          </span>
        )}
        {caption && <small className="nc-caption">{caption}</small>}
        {children}
      </a>
    );
    if (!actions) return tile;
    return (
      <div className={`nc-tile-wrap ${className}`.trim()}>
        {tile}
        <div className="nc-tile-actions">{actions}</div>
      </div>
    );
  }

  const { actions, onActivate, children } = props;
  const activate = onActivate ?? (() => navigateTo(item.href));
  const onClick = (event: MouseEvent<HTMLElement>) => {
    if (!isInteractive(event.target)) activate();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      activate();
    }
  };

  const header = (
    <div className="nc-head">
      <a className="nc-cover-link" href={item.href} tabIndex={-1} aria-hidden="true">
        <Cover item={item}>
          {props.rank != null && <span className="nc-rank">#{props.rank}</span>}
        </Cover>
      </a>
      <div className="nc-summary">
        {variant === 'detailed' && props.matchPercent != null && (
          <span className="nc-score"><Sparkles size={12} aria-hidden="true" /> {Math.round(props.matchPercent)}% match</span>
        )}
        <h3 className="nc-title-row">
          <a className="nc-title" href={item.href} data-preview-id={item.id}>{item.title}</a>
          {variant === 'detailed' && <ExternalLinkIcon item={item} />}
        </h3>
        <Author item={item} />
        <div className="nc-meta">
          <RatingChip rating={item.rating} votes={item.ratingVotes} />
          {item.readers != null && (
            <span className="nc-readers" title={`${item.readers.toLocaleString()} readers`}>
              <Users size={13} aria-hidden="true" /> {Math.max(0, item.readers).toLocaleString()}
            </span>
          )}
        </div>
        <div className="nc-badges">
          <MediaBadges id={item.id} mediaType={item.mediaType} source={item.source} />
          {libraryStatus && <StatusBadge status={libraryStatus} rating={libraryRating} />}
          {item.language && (item.languageHref
            ? <a className="nc-chip" href={item.languageHref}>{item.language}</a>
            : <span className="nc-chip">{item.language}</span>)}
          {item.statusTrans && <span className="nc-chip">{formatStatusLabel(item.statusTrans)}</span>}
        </div>
        {variant === 'row' && props.chips && <div className="nc-chips">{props.chips}</div>}
      </div>
    </div>
  );

  let body: ReactNode = null;
  if (variant === 'detailed') {
    const tags = props.sharedTags ?? [];
    const bullets = (props.evidence ?? [])
      .filter(Boolean)
      .filter((bullet) => !(tags.length && SHARED_TROPES_BULLET.test(bullet)))
      .slice(0, 2);
    const tagLink = (tag: string) => props.tagHref
      ? <a key={tag} href={props.tagHref(tag)}>{tag}</a>
      : <span key={tag}>{tag}</span>;
    body = (bullets.length > 0 || tags.length > 0) && (
      <div className="nc-why">
        {bullets.length > 0 && (
          <ul className="nc-evidence" aria-label="Why it matches">
            {bullets.map((bullet, i) => <li key={i}>{bullet}</li>)}
          </ul>
        )}
        {tags.length > 0 && (
          <details className="nc-tags">
            <summary>
              <span className="nc-tags-count"><ChevronRight size={12} aria-hidden="true" />{tags.length} shared trope{tags.length === 1 ? '' : 's'}</span>
              <span className="nc-tags-preview">{tags.slice(0, VISIBLE_TAGS).join(' · ')}{tags.length > VISIBLE_TAGS ? ' …' : ''}</span>
            </summary>
            <div className="nc-tag-list">{tags.map(tagLink)}</div>
          </details>
        )}
      </div>
    );
  }

  return (
    <article
      className={`nc nc-${variant} ${className}`.trim()}
      data-preview-card
      role={variant === 'row' ? 'link' : undefined}
      tabIndex={variant === 'row' ? 0 : undefined}
      aria-label={variant === 'row' ? item.title : undefined}
      onClick={onClick}
      onKeyDown={variant === 'row' ? onKeyDown : undefined}
    >
      {header}
      {body}
      {children}
      {(actions || (variant === 'row' && props.footerNote)) && (
        <footer className="nc-actions">
          {variant === 'row' && <span className="nc-footer-note">{props.footerNote}</span>}
          {actions}
        </footer>
      )}
    </article>
  );
}
