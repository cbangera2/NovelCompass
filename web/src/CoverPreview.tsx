import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { configuredDataMode, createDataSource, DataMode } from './data';
import { useDataModePreference } from './dataModePreference';
import { compactText, mergeDefined, previewFacts, previewFromDetail, previewTags, signalStrength, TAG_LIMIT, type PreviewData } from './previewData';
import './cover-preview.css';

/**
 * The one hover card for every title in the app. Contract:
 * - `data-preview-id` goes on the item's single focusable link (or button), never on its cover.
 * - `data-preview-card` goes on the whole tile or row. Hovering anywhere on it opens the card, which
 *   anchors beside it, so moving from cover to title is one continuous hover.
 * - Surfaces call `registerPreviews` with whatever they already loaded; the synopsis is fetched when missing.
 * The card has one shape: header, synopsis, optional "why it surfaced", tags, then facts the surface does not show.
 */

const SHOW_DELAY = 240;
const SWITCH_DELAY = 60;
const HIDE_DELAY = 60;
const CARD_ID = 'cover-preview-card';

// Keyed by data mode so switching between API and static data never reuses the other mode's preview.
const previewKey = (mode: DataMode, id: number) => `${mode}:${id}`;
const registry = new Map<string, PreviewData>();
const detailCache = new Map<string, Promise<PreviewData | null>>();

/** Make already-loaded data available to the card so it opens instantly without a fetch. Undefined fields never overwrite. */
export function registerPreviews(items: Array<PreviewData | null | undefined>) {
  const mode = configuredDataMode();
  for (const item of items) {
    if (!item) continue;
    const key = previewKey(mode, item.id);
    registry.set(key, mergeDefined(registry.get(key), item));
  }
}

function loadDetail(id: number, mode: DataMode): Promise<PreviewData | null> {
  const key = previewKey(mode, id);
  let pending = detailCache.get(key);
  if (!pending) {
    pending = createDataSource(mode).then((source) => source.getNovel(id)).then(previewFromDetail).catch(() => null);
    detailCache.set(key, pending);
    void pending.then((value) => { if (!value && detailCache.get(key) === pending) detailCache.delete(key); });
  }
  return pending;
}

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

/** Pointer: anywhere on a `data-preview-card` resolves to that item's one trigger. Focus: only the trigger itself. */
function triggerOf(target: EventTarget | null, wide: boolean): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  if (wide) {
    const card = target.closest<HTMLElement>('[data-preview-card]');
    const inner = card && (card.matches('[data-preview-id]') ? card : card.querySelector<HTMLElement>('[data-preview-id]'));
    if (inner) return inner;
  }
  return target.closest<HTMLElement>('[data-preview-id]');
}

/** Registered data plus the lazily fetched detail, remembered so the second hover is instant. */
function ensureDetail(id: number, mode: DataMode): Promise<PreviewData | null> {
  const key = previewKey(mode, id);
  const known = registry.get(key);
  if (known?.synopsis) return Promise.resolve(known);
  return loadDetail(id, mode).then((detail) => {
    if (!detail) return null;
    const merged = mergeDefined<PreviewData>(detail, registry.get(key) ?? {});
    registry.set(key, merged);
    return merged;
  });
}

export function CoverPreviewHost() {
  const { mode } = useDataModePreference();
  const [active, setActive] = useState<{ id: number; trigger: HTMLElement } | null>(null);
  const [data, setData] = useState<PreviewData | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const showTimer = useRef<number>();
  const hideTimer = useRef<number>();
  const pending = useRef<HTMLElement | null>(null);
  const dismissed = useRef<HTMLElement | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;
  const modeRef = useRef(mode);
  modeRef.current = mode;

  useEffect(() => {
    if (!window.matchMedia('(hover: hover)').matches) return undefined;
    const open = (trigger: HTMLElement) => {
      window.clearTimeout(hideTimer.current);
      if (activeRef.current?.trigger === trigger || dismissed.current === trigger) return;
      window.clearTimeout(showTimer.current);
      const id = Number(trigger.dataset.previewId);
      if (!Number.isFinite(id)) return;
      pending.current = trigger;
      void ensureDetail(id, modeRef.current);
      showTimer.current = window.setTimeout(() => { setPos(null); setActive({ id, trigger }); }, activeRef.current ? SWITCH_DELAY : SHOW_DELAY);
    };
    const close = () => {
      window.clearTimeout(showTimer.current);
      window.clearTimeout(hideTimer.current);
      pending.current = null;
      hideTimer.current = window.setTimeout(() => setActive(null), HIDE_DELAY);
    };
    const over = (wide: boolean) => (event: Event) => { const trigger = triggerOf(event.target, wide); if (trigger) open(trigger); };
    const out = (wide: boolean) => (event: Event) => {
      const from = triggerOf(event.target, wide);
      if (!from || triggerOf((event as MouseEvent).relatedTarget, wide) === from) return;
      if (dismissed.current === from) dismissed.current = null;
      close();
    };
    const dismiss = () => { window.clearTimeout(showTimer.current); pending.current = null; setActive(null); };
    // Esc keeps the card closed until the pointer or focus leaves this item.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      dismissed.current = activeRef.current?.trigger ?? pending.current;
      dismiss();
    };
    const [pointerOver, pointerOut, focusOver, focusOut] = [over(true), out(true), over(false), out(false)];
    document.addEventListener('pointerover', pointerOver);
    document.addEventListener('pointerout', pointerOut);
    document.addEventListener('focusin', focusOver);
    document.addEventListener('focusout', focusOut);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', dismiss, true);
    window.addEventListener('blur', dismiss);
    return () => {
      document.removeEventListener('pointerover', pointerOver);
      document.removeEventListener('pointerout', pointerOut);
      document.removeEventListener('focusin', focusOver);
      document.removeEventListener('focusout', focusOut);
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
    if (!known?.synopsis) {
      void ensureDetail(active.id, mode).then((detail) => { if (!cancelled && detail) setData(detail); });
    }
    return () => { cancelled = true; };
  }, [active, mode]);

  const shown = Boolean(active && data);
  const trigger = active?.trigger;
  useEffect(() => {
    if (!shown || !trigger) return undefined;
    const previous = trigger.getAttribute('aria-describedby');
    trigger.setAttribute('aria-describedby', previous ? `${previous} ${CARD_ID}` : CARD_ID);
    return () => {
      if (previous === null) trigger.removeAttribute('aria-describedby');
      else trigger.setAttribute('aria-describedby', previous);
    };
  }, [shown, trigger]);

  useLayoutEffect(() => {
    if (!active || !data || !cardRef.current) return;
    if (!active.trigger.isConnected) { setActive(null); return; }
    const anchor = (active.trigger.closest<HTMLElement>('[data-preview-card]') || active.trigger).getBoundingClientRect();
    const box = cardRef.current.getBoundingClientRect();
    setPos(place(anchor, { width: box.width, height: box.height }));
  }, [active, data]);

  if (!active || !data) return null;
  const { label: tagLabel, tags } = previewTags(data);
  const facts = previewFacts(data);
  const hasWhy = Boolean(data.signals?.length || data.bullets?.length);
  return createPortal(
    <div id={CARD_ID} className="cover-preview" ref={cardRef} role="tooltip" style={pos ? { left: pos.left, top: pos.top, opacity: 1 } : { left: 0, top: 0, opacity: 0 }}>
      <strong>{data.title}</strong>
      <p>{[data.author, data.language, data.media_type?.replace(/_/g, ' '), data.year].filter(Boolean).join(' · ')}</p>
      {data.synopsis && <p className="pop-synopsis">{compactText(data.synopsis)}</p>}
      {hasWhy && <div className="pop-signals">
        <h5>Why it surfaced{data.matchPercent != null ? ` · ${data.matchPercent.toFixed(0)}% match` : ''}</h5>
        {data.signals?.map((signal) => <div key={signal.label}>
          <span>{signal.label}</span>
          <i><u style={{ width: `${signalStrength(signal.rank) * 100}%` }} /></i>
          <b>#{signal.rank}</b>
        </div>)}
        {data.bullets && data.bullets.length > 0 && <ul>{data.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}</ul>}
      </div>}
      {tags.length > 0 && <div className="pop-tags">
        <h5>{tagLabel}</h5>
        <span>{tags.slice(0, TAG_LIMIT).map((tag) => <em key={tag}>{tag}</em>)}{tags.length > TAG_LIMIT && <em>+{tags.length - TAG_LIMIT}</em>}</span>
      </div>}
      {facts.length > 0 && <div className="pop-facts">
        {facts.map((fact) => <span key={fact.label}><b>{fact.value}</b>{fact.label}</span>)}
      </div>}
      {data.onYourLists && data.onYourLists.length > 0 && <p className="pop-lists">On your list: {data.onYourLists.join(', ')}</p>}
    </div>,
    document.body
  );
}
