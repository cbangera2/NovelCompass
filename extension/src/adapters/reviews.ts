import { OpaqueActionRegistry, type ActionGeneration } from './action-registry';
import type { LinkedLabel, LiveReview, LiveReviewPage, ReviewContentBlock } from './contracts';

const NOVEL_UPDATES_ORIGIN = 'https://www.novelupdates.com';
const REVIEW_ROW_SELECTOR =
  '#reviews [data-fixture-review], #reviews article, #reviews .review, .w-comments .w-comments-item, [data-review-row]';
const BODY_SELECTOR = '[data-review-body], .reviewbody, .w-comments-item-text, .review-content';

export interface ParsedReviews {
  page: LiveReviewPage;
  generation: number;
}

export function parseReviewPage(
  document: Document,
  pageUrl: string | URL,
  registry: OpaqueActionRegistry,
): ParsedReviews {
  const baseUrl = trustedPageUrl(pageUrl);
  const actions = registry.beginGeneration('reviews');
  if (!baseUrl) {
    return { page: emptyReviewPage(), generation: actions.generation };
  }

  const reviewRoot =
    document.querySelector<HTMLElement>('#reviews') ??
    document.querySelector<HTMLElement>('#comments.w-comments') ??
    document.querySelector<HTMLElement>('.w-comments') ??
    document.querySelector<HTMLElement>('[data-reviews]');
  if (!reviewRoot) {
    return { page: emptyReviewPage(), generation: actions.generation };
  }

  const rows = Array.from(document.querySelectorAll<HTMLElement>(REVIEW_ROW_SELECTOR))
    .map((row) => parseReview(row, baseUrl, actions))
    .filter((review): review is LiveReview => review !== undefined);
  const sortActions = parseSortActions(reviewRoot, baseUrl, actions);
  const writeControl = findControl(reviewRoot, [
    '[data-write-review]',
    'a[href*="review"][class*="write"]',
    'button[class*="write"][class*="review"]',
    'input[type="submit"][value*="review" i]',
  ]);
  const writeReviewActionId = registerControl(writeControl, baseUrl, actions);
  const loginRequired =
    Boolean(reviewRoot.querySelector('[data-review-login-required]')) ||
    /\b(?:log|sign)\s+in\b.{0,60}\b(?:write|post|like)\b.{0,30}\breview\b/i.test(
      cleanText(reviewRoot.textContent),
    );

  return {
    generation: actions.generation,
    page: {
      rows,
      ...parseReviewTotal(reviewRoot),
      order: detectOrder(reviewRoot),
      sortActionIds: sortActions,
      ...(writeReviewActionId ? { writeReviewActionId } : {}),
      loginRequired,
    },
  };
}

function parseReview(
  row: HTMLElement,
  baseUrl: URL,
  actions: ActionGeneration,
): LiveReview | undefined {
  const bodyRoot =
    row.querySelector<HTMLElement>(BODY_SELECTOR) ??
    row.querySelector<HTMLElement>('[data-fixture-truncated]') ??
    row.querySelector<HTMLElement>('p, blockquote, ul, ol');
  const body = bodyRoot ? normalizeReviewBody(bodyRoot) : [];
  if (!body.length) {
    return undefined;
  }

  const reviewerElement =
    row.querySelector<HTMLElement>('[data-reviewer]') ??
    row.querySelector<HTMLElement>('.w-comments-item-author, .reviewer') ??
    row.querySelector<HTMLElement>('a[href*="/user/"], a[href*="/profile/"]');
  const reviewer = parseLinkedLabel(reviewerElement, baseUrl, 'Anonymous');
  const avatar = row.querySelector<HTMLImageElement>(
    '[data-reviewer-avatar], .w-comments-item-author img, img.avatar',
  );
  const reviewerAvatarUrl = trustedHttpsUrl(avatar?.getAttribute('src'), baseUrl);
  const rating = parseRating(row);
  const dateElement = row.querySelector<HTMLElement>(
    '[data-review-date], time, .review-date, .w-comments-item-date',
  );
  const liveMetadataCells = row.querySelectorAll<HTMLTableCellElement>(
    '.w-comments-item-meta-new td',
  );
  const liveDateText =
    liveMetadataCells.length > 1
      ? cleanText(liveMetadataCells[1]?.querySelector('div')?.textContent)
      : '';
  const postedAtLabel = cleanText(
    dateElement?.getAttribute('datetime') ?? dateElement?.textContent ?? liveDateText,
  );
  const postedAtIso = parseDateIso(postedAtLabel);
  const progressLabel = parseProgress(row);
  const likeCount = parseLikeCount(row);
  const permalinkElement = row.querySelector<HTMLAnchorElement>(
    '[data-review-permalink][href], a[rel="bookmark"][href], a[href*="#review"]',
  );
  const permalink = trustedNovelUpdatesUrl(permalinkElement?.getAttribute('href'), baseUrl);
  const expandControl = findControl(row, [
    '[data-fixture-expand]',
    '[data-review-expand]',
    '.review-more',
    '.show-more',
  ]);
  const likeControl = findControl(row, [
    '[data-review-like]',
    '.review-like',
    'button[class*="like"]',
    'a[class*="like"]',
  ]);
  const reportControl = findControl(row, [
    '[data-review-report]',
    '.review-report',
    'button[class*="report"]',
    'a[class*="report"]',
  ]);
  const actionIds = {
    ...optionalAction('expand', registerControl(expandControl, baseUrl, actions)),
    ...optionalAction('like', registerControl(likeControl, baseUrl, actions)),
    ...optionalAction('report', registerControl(reportControl, baseUrl, actions)),
  };

  return {
    actionIds,
    ...(permalink ? { permalink } : {}),
    reviewer,
    ...(reviewerAvatarUrl ? { reviewerAvatarUrl } : {}),
    ...(rating !== undefined ? { rating } : {}),
    postedAtLabel,
    ...(postedAtIso ? { postedAtIso } : {}),
    ...(progressLabel ? { progressLabel } : {}),
    body,
    isTruncated:
      Boolean(expandControl) ||
      Boolean(bodyRoot?.matches('[data-fixture-truncated], [data-truncated="true"]')),
    ...(likeCount !== undefined ? { likeCount } : {}),
  };
}

export function normalizeReviewBody(root: HTMLElement): ReviewContentBlock[] {
  const blocks: ReviewContentBlock[] = [];
  const candidates = root.matches('p, blockquote, ul, ol')
    ? [root]
    : Array.from(root.querySelectorAll<HTMLElement>('p, blockquote, ul, ol'));

  for (const element of candidates) {
    if (element.matches('ul, ol')) {
      const items = Array.from(element.children)
        .filter(
          (child): child is HTMLElement => child instanceof HTMLElement && child.matches('li'),
        )
        .map((item) => safeElementText(item))
        .filter(Boolean);
      if (items.length) blocks.push({ type: 'list', items });
      continue;
    }
    const text = safeElementText(element);
    if (!text) continue;
    blocks.push({ type: element.matches('blockquote') ? 'quote' : 'paragraph', text });
  }

  if (!blocks.length) {
    const text = safeElementText(root);
    if (text) blocks.push({ type: 'paragraph', text });
  }
  return blocks;
}

function safeElementText(element: HTMLElement): string {
  const clone = element.cloneNode(true) as HTMLElement;
  clone
    .querySelectorAll('script, style, template, button, input, textarea, select')
    .forEach((node) => node.remove());
  return cleanText(clone.textContent)
    .replace(/\s*(?:\.\.\.\s*)?more\s*>>\s*/gi, ' ')
    .replace(/\s*<\s*less\s*/gi, ' ')
    .trim();
}

function parseLinkedLabel(
  element: HTMLElement | null,
  baseUrl: URL,
  fallback: string,
): LinkedLabel {
  if (!element) return { label: fallback };
  const anchor = element.matches('a[href]')
    ? (element as HTMLAnchorElement)
    : element.querySelector<HTMLAnchorElement>('a[href]');
  const label = cleanText(anchor?.textContent ?? element.textContent) || fallback;
  const url = trustedNovelUpdatesUrl(anchor?.getAttribute('href'), baseUrl);
  return { label, ...(url ? { url } : {}) };
}

function parseRating(row: HTMLElement): number | undefined {
  const element = row.querySelector<HTMLElement>(
    '[data-review-rating], [aria-label*="star" i], [title*="star" i], .review-rating, .reviewscore',
  );
  const raw =
    element?.getAttribute('data-review-rating') ??
    element?.getAttribute('aria-label') ??
    element?.getAttribute('title') ??
    element?.textContent;
  const match = raw?.match(/(?:^|\s)([0-5](?:\.\d+)?)\s*(?:\/\s*5|stars?)?/i);
  const rating = match ? Number(match[1]) : NaN;
  if (Number.isFinite(rating) && rating >= 0 && rating <= 5) return rating;
  const liveStars = row.querySelectorAll('.w-comments-item-meta-new .fa-star').length;
  return liveStars > 0 && liveStars <= 5 ? liveStars : undefined;
}

function parseProgress(row: HTMLElement): string | undefined {
  const explicit = cleanText(
    row.querySelector<HTMLElement>(
      '[data-review-progress], .review-progress, .reviewon, [id^="stat"]',
    )?.textContent,
  );
  const candidate = explicit || cleanText(row.textContent).match(/\bStatus\s*:\s*([^|·\n]+)/i)?.[1];
  return candidate ? cleanText(candidate).replace(/^Status\s*:\s*/i, '') : undefined;
}

function parseLikeCount(row: HTMLElement): number | undefined {
  const element = row.querySelector<HTMLElement>(
    '[data-like-count], .review-like-count, .reviewlikes, [class*="like-count"]',
  );
  const raw = element?.getAttribute('data-like-count') ?? element?.textContent;
  const match = raw?.replace(/,/g, '').match(/\d+/);
  return match ? Number(match[0]) : undefined;
}

function parseSortActions(
  root: HTMLElement,
  baseUrl: URL,
  actions: ActionGeneration,
): LiveReviewPage['sortActionIds'] {
  const result: LiveReviewPage['sortActionIds'] = {};
  for (const element of root.querySelectorAll<HTMLElement>(
    '[data-review-sort], a[href*="review"][href*="sort"], button[class*="review"][class*="sort"]',
  )) {
    const label = cleanText(element.getAttribute('data-review-sort') ?? element.textContent);
    const actionId = registerControl(element, baseUrl, actions);
    if (!actionId) continue;
    if (/like|helpful/i.test(label)) result.likes = actionId;
    if (/date|new|recent/i.test(label)) result.date = actionId;
  }
  return result;
}

function detectOrder(root: HTMLElement): LiveReviewPage['order'] {
  const active = root.querySelector<HTMLElement>(
    '[data-review-sort][aria-current="true"], [data-review-sort].active, .review-sort .active',
  );
  const label = cleanText(active?.getAttribute('data-review-sort') ?? active?.textContent);
  if (/like|helpful/i.test(label)) return 'likes';
  if (/date|new|recent/i.test(label)) return 'date';
  return 'unknown';
}

function findControl(root: ParentNode, selectors: string[]): HTMLElement | null {
  for (const selector of selectors) {
    const element = root.querySelector<HTMLElement>(selector);
    if (element) return element;
  }
  return null;
}

function registerControl(
  element: HTMLElement | null,
  baseUrl: URL,
  actions: ActionGeneration,
): string | undefined {
  if (!element) return undefined;
  if (element instanceof HTMLAnchorElement) {
    const href = trustedNovelUpdatesUrl(element.getAttribute('href'), baseUrl);
    return href ? actions.registerNavigation(href) : undefined;
  }
  return actions.registerElement(element);
}

function parseReviewTotal(root: HTMLElement): Pick<LiveReviewPage, 'total'> {
  const explicit = root.getAttribute('data-review-total');
  const label =
    explicit ?? root.querySelector<HTMLElement>('[data-review-count], .review-count')?.textContent;
  const match = label?.replace(/,/g, '').match(/\d+/);
  return match ? { total: Number(match[0]) } : {};
}

function optionalAction<Key extends 'expand' | 'like' | 'report'>(
  key: Key,
  actionId: string | undefined,
): Partial<Record<Key, string>> {
  return actionId ? ({ [key]: actionId } as Partial<Record<Key, string>>) : {};
}

function parseDateIso(value: string | null | undefined): string | undefined {
  const text = cleanText(value);
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/.exec(text);
  if (iso) return validIsoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(text);
  if (slash) {
    const rawYear = Number(slash[3]);
    return validIsoDate(
      rawYear < 100 ? 2000 + rawYear : rawYear,
      Number(slash[1]),
      Number(slash[2]),
    );
  }
  const named = /^([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})$/.exec(text);
  if (!named) return undefined;
  const month =
    [
      'january',
      'february',
      'march',
      'april',
      'may',
      'june',
      'july',
      'august',
      'september',
      'october',
      'november',
      'december',
    ].indexOf(named[1].toLowerCase()) + 1;
  return month ? validIsoDate(Number(named[3]), month, Number(named[2])) : undefined;
}

function validIsoDate(year: number, month: number, day: number): string | undefined {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? date.toISOString().slice(0, 10)
    : undefined;
}

function trustedPageUrl(value: string | URL): URL | undefined {
  try {
    const url = value instanceof URL ? new URL(value.href) : new URL(value);
    return url.protocol === 'https:' && url.origin === NOVEL_UPDATES_ORIGIN ? url : undefined;
  } catch {
    return undefined;
  }
}

function trustedNovelUpdatesUrl(
  value: string | null | undefined,
  baseUrl: URL,
): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value, baseUrl);
    return url.protocol === 'https:' && url.origin === NOVEL_UPDATES_ORIGIN ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function trustedHttpsUrl(value: string | null | undefined, baseUrl: URL): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value, baseUrl);
    return url.protocol === 'https:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function cleanText(value: string | null | undefined): string {
  return value?.replace(/\s+/g, ' ').trim() ?? '';
}

function emptyReviewPage(): LiveReviewPage {
  return {
    rows: [],
    order: 'unknown',
    sortActionIds: {},
    loginRequired: false,
  };
}
