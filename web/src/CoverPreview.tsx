import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { configuredDataMode, createDataSource, DataMode } from './data';
import { useDataModePreference } from './dataModePreference';
import { audienceLabel, formatStatusLabel, progressUnitLabel } from './novelLinks';
import { NovelDetail, Recommendation } from './types';
import './cover-preview.css';

/**
 * Global cover hover card. Any element carrying `data-preview-id` shows it on hover or focus.
 * An ancestor with `data-preview-card` is used as the placement anchor so the card sits beside
 * the whole item instead of covering the cover being hovered.
 */
export interface PreviewData {
  id: number;
  title: string;
  author?: string;
  language?: string;
  rating?: number;
  rating_votes?: number;
  reading_list_count?: number;
  chapters_trans?: number;
  status_trans?: string;
  media_type?: string;
  year?: number;
  synopsis?: string;
  tags?: string[];
  matchPercent?: number;
  signals?: Array<{ label: string; rank: number }>;
  sharedTags?: string[];
  bullets?: string[];
  curatedListCount?: number;
}

export const CHANNEL_LABELS: Record<string, string> = {
  vector: 'Meaning', tag: 'Tags', direct_rec: 'Reader recs', rec_list: 'Curated lists', ease: 'Co-read pattern', structural: 'Catalog structure'
};
export const signalStrength = (rank: number) => Math.max(0.12, 1 - Math.log10(Math.max(1, rank)) / 2);

// Keyed by data mode so switching between API and static data never reuses the other mode's preview.
const previewKey = (mode: DataMode, id: number) => `${mode}:${id}`;
const registry = new Map<string, PreviewData>();
const detailCache = new Map<string, Promise<PreviewData | null>>();

/** Make already-loaded data available to the card so it opens instantly without a fetch. */
export function registerPreviews(items: PreviewData[]) {
  const mode = configuredDataMode();
  for (const item of items) {
    const key = previewKey(mode, item.id);
    registry.set(key, { ...registry.get(key), ...item });
  }
}

export function previewFromRecommendation(item: Recommendation): PreviewData {
  const signals = Object.entries(CHANNEL_LABELS)
    .map(([channel, label]) => ({ label, rank: item.channel_ranks?.[channel] }))
    .filter((signal): signal is { label: string; rank: number } => Number.isFinite(signal.rank))
    .sort((a, b) => a.rank - b.rank);
  return {
    id: item.target_id, title: item.title, author: item.author, language: item.language, rating: item.rating,
    rating_votes: item.rating_votes, reading_list_count: item.reading_list_count, chapters_trans: item.chapters_trans,
    status_trans: item.status_trans, media_type: item.media_type, matchPercent: item.match_score_percent, signals,
    sharedTags: item.shared_tags, bullets: item.evidence_bullets.filter((bullet) => !/^(Shared key tropes|Co-occurs on)/i.test(bullet)).slice(0, 3),
    curatedListCount: item.curated_lists?.length
  };
}

function fromDetail(detail: NovelDetail): PreviewData {
  return {
    id: detail.id, title: detail.title, author: detail.author, language: detail.language, rating: detail.rating,
    rating_votes: detail.rating_votes, reading_list_count: detail.reading_list_count, chapters_trans: detail.chapters_trans,
    status_trans: detail.status_trans, media_type: detail.media_type, year: detail.year, synopsis: detail.synopsis,
    tags: detail.tags?.slice(0, 10)
  };
}

function loadDetail(id: number, mode: DataMode): Promise<PreviewData | null> {
  const key = previewKey(mode, id);
  let pending = detailCache.get(key);
  if (!pending) {
    pending = createDataSource(mode).then((source) => source.getNovel(id)).then(fromDetail).catch(() => null);
    detailCache.set(key, pending);
    void pending.then((value) => { if (!value && detailCache.get(key) === pending) detailCache.delete(key); });
  }
  return pending;
}

const compact = (text: string, max = 190) => {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max).replace(/\s\S*$/, '')}…` : clean;
};

const GAP = 12;
const MARGIN = 10;

/** Prefer beside the anchor (right, then left); fall back below, then above; always clamp into the viewport. */
function place(anchor: DOMRect, card: { width: number; height: number }) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const clampTop = (top: number) => Math.min(Math.max(MARGIN, top), Math.max(MARGIN, vh - card.height - MARGIN));
  const clampLeft = (left: number) => Math.min(Math.max(MARGIN, left), Math.max(MARGIN, vw - card.width - MARGIN));
  if (anchor.right + GAP + card.width <= vw - MARGIN) return { left: anchor.right + GAP, top: clampTop(anchor.top) };
  if (anchor.left - GAP - card.width >= MARGIN) return { left: anchor.left - GAP - card.width, top: clampTop(anchor.top) };
  if (anchor.bottom + GAP + card.height <= vh - MARGIN) return { left: clampLeft(anchor.left), top: anchor.bottom + GAP };
  if (anchor.top - GAP - card.height >= MARGIN) return { left: clampLeft(anchor.left), top: anchor.top - GAP - card.height };
  return { left: clampLeft(anchor.right + GAP), top: clampTop(anchor.top) };
}

const triggerOf = (target: EventTarget | null) => target instanceof Element ? target.closest<HTMLElement>('[data-preview-id]') : null;

export function CoverPreviewHost() {
  const { mode } = useDataModePreference();
  const [active, setActive] = useState<{ id: number; trigger: HTMLElement } | null>(null);
  const [data, setData] = useState<PreviewData | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const showTimer = useRef<number>();
  const hideTimer = useRef<number>();
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    if (!window.matchMedia('(hover: hover)').matches) return undefined;
    const open = (trigger: HTMLElement) => {
      window.clearTimeout(hideTimer.current);
      if (activeRef.current?.trigger === trigger) return;
      window.clearTimeout(showTimer.current);
      const id = Number(trigger.dataset.previewId);
      if (!Number.isFinite(id)) return;
      showTimer.current = window.setTimeout(() => { setPos(null); setActive({ id, trigger }); }, activeRef.current ? 60 : 240);
    };
    const close = () => {
      window.clearTimeout(showTimer.current);
      window.clearTimeout(hideTimer.current);
      hideTimer.current = window.setTimeout(() => setActive(null), 60);
    };
    const onOver = (event: Event) => { const trigger = triggerOf(event.target); if (trigger) open(trigger); };
    const onOut = (event: Event) => {
      const from = triggerOf(event.target);
      if (from && triggerOf((event as MouseEvent).relatedTarget) !== from) close();
    };
    const dismiss = () => { window.clearTimeout(showTimer.current); setActive(null); };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') dismiss(); };
    document.addEventListener('pointerover', onOver);
    document.addEventListener('pointerout', onOut);
    document.addEventListener('focusin', onOver);
    document.addEventListener('focusout', onOut);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', dismiss, true);
    window.addEventListener('blur', dismiss);
    return () => {
      document.removeEventListener('pointerover', onOver);
      document.removeEventListener('pointerout', onOut);
      document.removeEventListener('focusin', onOver);
      document.removeEventListener('focusout', onOut);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', dismiss, true);
      window.removeEventListener('blur', dismiss);
      window.clearTimeout(showTimer.current);
      window.clearTimeout(hideTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!active) { setData(null); return undefined; }
    let cancelled = false;
    const known = registry.get(previewKey(mode, active.id)) || null;
    setData(known);
    if (!known?.tags?.length && !known?.sharedTags?.length) {
      void loadDetail(active.id, mode).then((detail) => {
        if (cancelled || !detail) return;
        setData({ ...detail, ...Object.fromEntries(Object.entries(known || {}).filter(([, value]) => value !== undefined)) } as PreviewData);
      });
    }
    return () => { cancelled = true; };
  }, [active, mode]);

  useLayoutEffect(() => {
    if (!active || !data || !cardRef.current) return;
    if (!active.trigger.isConnected) { setActive(null); return; }
    const anchor = (active.trigger.closest<HTMLElement>('[data-preview-card]') || active.trigger).getBoundingClientRect();
    const box = cardRef.current.getBoundingClientRect();
    setPos(place(anchor, { width: box.width, height: box.height }));
  }, [active, data]);

  if (!active || !data) return null;
  const tags = data.sharedTags?.length ? data.sharedTags : data.tags || [];
  return createPortal(
    <div className="cover-preview" ref={cardRef} role="tooltip" style={pos ? { left: pos.left, top: pos.top, opacity: 1 } : { left: 0, top: 0, opacity: 0 }}>
      <strong>{data.title}</strong>
      <p>{[data.author, data.language, data.media_type, data.year].filter(Boolean).join(' · ')}</p>
      <div className="pop-facts">
        <span><b>{data.rating ? data.rating.toFixed(1) : '—'}</b>rating{data.rating_votes != null ? ` · ${data.rating_votes.toLocaleString()} votes` : ''}</span>
        {data.reading_list_count != null && <span><b>{data.reading_list_count.toLocaleString()}</b>{audienceLabel(data.id, data.media_type)}</span>}
        {data.chapters_trans != null && <span><b>{data.chapters_trans > 0 ? data.chapters_trans.toLocaleString() : '—'}</b>{progressUnitLabel(data.id, data.media_type)}{data.status_trans ? ` · ${formatStatusLabel(data.status_trans)}` : ''}</span>}
      </div>
      {data.signals && data.signals.length > 0 && <div className="pop-signals">
        <h5>Why it surfaced{data.matchPercent != null ? ` · ${data.matchPercent.toFixed(0)}% match` : ''}</h5>
        {data.signals.map((signal) => <div key={signal.label}>
          <span>{signal.label}</span>
          <i><u style={{ width: `${signalStrength(signal.rank) * 100}%` }} /></i>
          <b>#{signal.rank}</b>
        </div>)}
      </div>}
      {tags.length > 0 && <div className="pop-tags">
        <h5>{data.sharedTags?.length ? `Shared tags · ${data.sharedTags.length}` : 'Top tags'}</h5>
        <span>{tags.slice(0, 8).map((tag) => <em key={tag}>{tag}</em>)}{tags.length > 8 && <em>+{tags.length - 8}</em>}</span>
      </div>}
      {!data.signals?.length && data.synopsis && <p className="pop-synopsis">{compact(data.synopsis)}</p>}
      {data.bullets && data.bullets.length > 0 && <ul>{data.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}</ul>}
      {(data.curatedListCount || 0) > 0 && <p className="pop-lists">On {data.curatedListCount} curated list{data.curatedListCount === 1 ? '' : 's'}</p>}
    </div>,
    document.body
  );
}
