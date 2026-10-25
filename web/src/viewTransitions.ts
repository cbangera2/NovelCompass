/**
 * Cover-to-hero page transition.
 *
 * Clicking a title swaps the route inside the same document (history.pushState plus a re-render) and wraps the swap in a
 * view transition. The clicked cover and the novel page's cover share one `view-transition-name`, so the browser flies
 * one into the other; Back flies it home again. Everything else stays an ordinary page load. Browsers without view
 * transitions, and visitors who prefer reduced motion, get the ordinary navigation for novel links too.
 */
const NAME = 'novel-cover';
const DETAIL_VIEWS = new Set(['novel', 'manga', 'anime', 'item']);
/** How long the old page waits for the new one's cover before the flight starts anyway. */
const SETTLE_MS = 350;
/** Going back, the list may have to rebuild before its card exists; wait longer for it. */
const RETURN_SETTLE_MS = 700;

/** The title id when `url` is a same-origin novel/manga/anime page, otherwise null. */
function detailId(url: string | URL): number | null {
  try {
    const parsed = new URL(url, window.location.href);
    if (parsed.origin !== window.location.origin) return null;
    const view = parsed.searchParams.get('view');
    if (!view || !DETAIL_VIEWS.has(view)) return null;
    const id = Number(parsed.searchParams.get('id'));
    return id > 0 ? id : null;
  } catch {
    return null;
  }
}

let renderRoute: (() => void) | null = null;
let renderedHref = '';
let lastPressed: HTMLElement | null = null;
let pendingCover: { id: number; src: string } | null = null;

function transitionsAvailable() {
  return typeof document.startViewTransition === 'function'
    && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function coverImage(el: Element): HTMLImageElement | null {
  return el instanceof HTMLImageElement ? el : el.querySelector('img');
}

function inViewport(el: Element) {
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0
    && rect.top < window.innerHeight && rect.left < window.innerWidth;
}

/** The element to fly for something carrying `data-cover-id` (a cover) or `data-preview-id` (its title link): its cover frame, else the image itself. */
function coverElement(el: Element): HTMLElement | null {
  const img = coverImage(el);
  return img ? (img.closest<HTMLElement>('.nc-cover') ?? img) : null;
}

/** The on-screen cover for `id`, preferring the one that was just pressed. */
function pickCover(id: number): HTMLElement | null {
  const candidates = Array.from(new Set(
    Array.from(document.querySelectorAll(`[data-cover-id="${id}"], [data-preview-id="${id}"]`)).map(coverElement)
  )).filter((el): el is HTMLElement => Boolean(el) && inViewport(el as HTMLElement));
  const card = lastPressed?.closest('.nc, .nc-tile-wrap, .nc-tile');
  const pressed = lastPressed && candidates.find((el) => el.contains(lastPressed) || card?.contains(el));
  return pressed || candidates[0] || null;
}

/** The cover the user just clicked, for the stand-in shown while the novel page loads. */
export function readTransitionCover(id: number): string | null {
  return pendingCover && pendingCover.id === id ? pendingCover.src : null;
}

/** A frame, or 50ms if the tab is not producing frames, so waiting here can never stall the transition. */
function nextFrame() {
  return new Promise<void>((resolve) => {
    const timer = window.setTimeout(resolve, 50);
    requestAnimationFrame(() => { window.clearTimeout(timer); resolve(); });
  });
}

async function waitFor(ready: () => boolean, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (!ready() && Date.now() < deadline) await new Promise((resolve) => window.setTimeout(resolve, 16));
}

/** A list that rebuilds after Back is short at first, so scrolling to where it was gets clamped; keep trying until the
 *  page is tall enough, unless the visitor starts scrolling themselves. */
async function restoreScroll(target: number) {
  let cancelled = false;
  const cancel = () => { cancelled = true; };
  window.addEventListener('wheel', cancel, { once: true, passive: true });
  window.addEventListener('touchstart', cancel, { once: true, passive: true });
  window.addEventListener('keydown', cancel, { once: true });
  const deadline = Date.now() + 4000;
  while (!cancelled && Date.now() < deadline && Math.abs(window.scrollY - target) > 2) {
    window.scrollTo(0, target);
    await new Promise((resolve) => window.setTimeout(resolve, 100));
  }
  window.removeEventListener('wheel', cancel);
  window.removeEventListener('touchstart', cancel);
  window.removeEventListener('keydown', cancel);
}

function nameCover(el: HTMLElement) {
  // Drop the hover tilt so the flight starts from a flat cover.
  el.style.transition = 'none';
  el.style.transform = 'none';
  el.style.viewTransitionName = NAME;
}

interface SwapOptions {
  /** Forward: the cover to fly from, already chosen on the page being left. */
  from?: HTMLElement | null;
  /** Back: the title whose card the page being returned to should fly the cover into. */
  returnTo?: number | null;
  /** Scroll position to restore on the new page; top when omitted. */
  scrollY?: number;
}

/** Runs `update` (which changes the URL), then re-renders the route, inside a view transition. */
function swapRoute(update: () => void, { from, returnTo, scrollY = 0 }: SwapOptions) {
  if (from) {
    // One element per name: the clicked cover takes it from this page's own hero, if it has one.
    document.querySelectorAll<HTMLElement>('.novel-cover-shell').forEach((el) => { el.style.viewTransitionName = 'none'; });
    nameCover(from);
  }
  const transition = document.startViewTransition(async () => {
    update();
    renderedHref = window.location.href;
    renderRoute?.();
    if (detailId(window.location.href)) {
      await waitFor(() => Boolean(document.querySelector('.novel-cover-shell img')), SETTLE_MS);
      window.scrollTo(0, scrollY);
    } else if (returnTo) {
      await waitFor(() => Boolean(document.querySelector(`.nc-cover[data-cover-id="${returnTo}"] img`)), RETURN_SETTLE_MS);
      window.scrollTo(0, scrollY);
      await nextFrame();
      const home = pickCover(returnTo);
      if (home) nameCover(home);
    } else {
      window.scrollTo(0, scrollY);
    }
    if (scrollY > 0) void restoreScroll(scrollY);
  });
  void transition.finished.finally(() => { pendingCover = null; });
}

/** Opens `href` with the cover transition when it is a novel page and the browser can; reports whether it did. */
export function softNavigate(href: string): boolean {
  if (!renderRoute || !transitionsAvailable()) return false;
  const url = new URL(href, window.location.href);
  const toId = detailId(url);
  // Same route (an in-page #section link) is not a navigation.
  if (!toId || url.pathname !== window.location.pathname || url.search === window.location.search) return false;
  const cover = pickCover(toId);
  const img = cover && coverImage(cover);
  pendingCover = img ? { id: toId, src: img.currentSrc || img.src } : null;
  // Remember where this page was scrolled to, so Back lands in the same place.
  window.history.replaceState({ ...(window.history.state || {}), scrollY: window.scrollY }, '');
  swapRoute(() => window.history.pushState({}, '', url), { from: cover });
  return true;
}

/** Same as setting `location.href`, but with the cover transition for novel pages. */
export function navigateTo(href: string) {
  if (!softNavigate(href)) window.location.href = href;
}

/** `render` draws the route that matches the current URL; it must commit synchronously. */
export function installViewTransitions(render: () => void) {
  renderRoute = render;
  renderedHref = window.location.href;

  document.addEventListener('pointerdown', (event) => {
    lastPressed = event.target instanceof HTMLElement ? event.target : null;
  }, { capture: true, passive: true });

  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
    if (!link || (link.target && link.target !== '_self') || link.hasAttribute('download')) return;
    if (softNavigate(link.href)) event.preventDefault();
  });

  // Back and Forward between a list and a novel page, or between novel pages. Moves between ordinary pages stay with
  // the pages that made them, and a #section change on a novel page is not a new page.
  window.addEventListener('popstate', (event) => {
    const leaving = detailId(renderedHref);
    const arriving = detailId(window.location.href);
    const sameRoute = new URL(renderedHref).search === window.location.search;
    if ((!leaving && !arriving) || sameRoute) {
      renderedHref = window.location.href;
      return;
    }
    if (!transitionsAvailable()) {
      renderedHref = window.location.href;
      renderRoute?.();
      return;
    }
    const state = event.state as { scrollY?: number } | null;
    swapRoute(() => undefined, { returnTo: arriving ? null : leaving, scrollY: state?.scrollY ?? 0 });
  });
}
