import {
  NOVEL_UPDATES_PARSER_VERSION,
  type NovelUpdatesPageIdentity,
  type PageClassification,
  type ReplacementBlockReason,
} from './contracts';
import { matchNovelUpdatesRoute, type NovelUpdatesRouteMatch } from './route-registry';

const NOVEL_UPDATES_ORIGIN = 'https://www.novelupdates.com';
const SERIES_PATH = /^\/series\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/;
const LOGIN_PATH = /^\/(?:login|wp-login\.php|register|lostpassword)(?:\/|$)/;

const CHALLENGE_MARKERS = [
  'cf-chl-',
  'challenge-platform',
  'checking your browser',
  'just a moment',
  'verify you are human',
  'attention required! | cloudflare',
];

const MAINTENANCE_MARKERS = [
  'briefly unavailable for scheduled maintenance',
  'maintenance mode',
  'temporarily unavailable',
];

export interface NovelUpdatesPageSignals {
  title?: string;
  bodyText?: string;
  canonicalUrl?: string;
  shortlinkUrl?: string;
  hasCloudflareChallenge?: boolean;
  hasLoginForm?: boolean;
  hasSeriesTitle?: boolean;
  contentType?: string;
}

/**
 * Extract the deliberately small set of DOM signals needed for activation.
 * Parser-specific selectors belong in the page adapters, not this classifier.
 */
export function readPageSignals(document: Document): NovelUpdatesPageSignals {
  return {
    title: document.title,
    bodyText: document.body?.textContent?.slice(0, 8_000),
    canonicalUrl: document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href,
    shortlinkUrl: document.querySelector<HTMLLinkElement>('link[rel="shortlink"]')?.href,
    hasCloudflareChallenge: Boolean(
      document.querySelector('#challenge-form, #cf-challenge-running, .cf-browser-verification'),
    ),
    hasLoginForm: Boolean(
      document.querySelector(
        'form#loginform, form[name="loginform"], input[name="log"][type="text"]',
      ),
    ),
    hasSeriesTitle: Boolean(
      document.querySelector("h1.seriestitlenu, .seriestitlenu, .series-title, [itemprop='name']"),
    ),
    contentType: document.contentType,
  };
}

export function classifyNovelUpdatesDocument(
  url: string | URL,
  document: Document,
): PageClassification {
  return classifyNovelUpdatesPage(url, readPageSignals(document));
}

export function classifyNovelUpdatesPage(
  url: string | URL,
  signals: NovelUpdatesPageSignals = {},
): PageClassification {
  const parsedUrl = parseUrl(url);
  if (!parsedUrl) {
    return blocked('invalid-url');
  }

  if (parsedUrl.protocol !== 'https:') {
    return blocked('insecure-origin', parsedUrl.href);
  }
  if (parsedUrl.origin !== NOVEL_UPDATES_ORIGIN) {
    return blocked('wrong-origin', parsedUrl.href);
  }
  if (signals.contentType && !isHtmlContentType(signals.contentType)) {
    return blocked('non-html-document', parsedUrl.href);
  }

  const documentBlock = detectDocumentBlock(signals);
  if (documentBlock) {
    return blocked(documentBlock, parsedUrl.href);
  }
  if (LOGIN_PATH.test(parsedUrl.pathname) || signals.hasLoginForm) {
    return blocked('login-page', parsedUrl.href);
  }

  const route = matchNovelUpdatesRoute(parsedUrl.pathname, parsedUrl.search);
  if (!route) {
    return blocked('unsupported-route', parsedUrl.href);
  }
  if (route.policy === 'pass-through') {
    return blocked('pass-through-route', parsedUrl.href, route);
  }
  if (!route.uiImplemented) {
    return blocked('replacement-not-implemented', parsedUrl.href, route);
  }

  if (
    route.family === 'series-finder' ||
    route.family === 'series-ranking' ||
    route.family === 'catalog-feed' ||
    route.family === 'catalog-taxonomy' ||
    route.family === 'recommendation-lists' ||
    route.family === 'public-profile' ||
    route.family === 'reading-library'
  ) {
    return {
      kind: 'supported',
      identity: {
        pageType: route.family,
        url: parsedUrl.href,
        parserVersion: NOVEL_UPDATES_PARSER_VERSION,
        confidence: 'high',
        resolutionSource: 'exact-route',
      },
    };
  }

  const currentSeriesMatch =
    route.family === 'series' ? SERIES_PATH.exec(parsedUrl.pathname) : null;
  if (!currentSeriesMatch) {
    return blocked('unsupported-route', parsedUrl.href);
  }

  // `undefined` means the caller classified from a URL only. A real Document
  // extraction always supplies a boolean, allowing malformed responses to
  // fail closed without making URL-only routing tests depend on page markup.
  if (signals.hasSeriesTitle === false) {
    return blocked('unsupported-markup', parsedUrl.href);
  }

  const currentSlug = currentSeriesMatch[1];
  if (!currentSlug) {
    return blocked('invalid-series-slug', parsedUrl.href);
  }

  return {
    kind: 'supported',
    identity: resolveSeriesIdentity(parsedUrl, currentSlug, signals),
  };
}

function isHtmlContentType(value: string): boolean {
  const normalized = value.split(';', 1)[0]?.trim().toLowerCase();
  return normalized === 'text/html' || normalized === 'application/xhtml+xml';
}

function resolveSeriesIdentity(
  currentUrl: URL,
  currentSlug: string,
  signals: NovelUpdatesPageSignals,
): NovelUpdatesPageIdentity {
  const canonical = parseTrustedSeriesUrl(signals.canonicalUrl);
  const canonicalSlug = canonical && SERIES_PATH.exec(canonical.pathname)?.[1];
  const shortlinkId = parseNovelUpdatesId(signals.shortlinkUrl);

  if (canonical && canonicalSlug) {
    return {
      pageType: 'series',
      url: currentUrl.href,
      canonicalUrl: canonical.href,
      slug: canonicalSlug,
      ...(shortlinkId ? { novelUpdatesId: shortlinkId } : {}),
      parserVersion: NOVEL_UPDATES_PARSER_VERSION,
      confidence: canonicalSlug === currentSlug ? 'high' : 'medium',
      resolutionSource: 'canonical-url',
    };
  }

  return {
    pageType: 'series',
    url: currentUrl.href,
    slug: currentSlug,
    ...(shortlinkId ? { novelUpdatesId: shortlinkId } : {}),
    parserVersion: NOVEL_UPDATES_PARSER_VERSION,
    confidence: 'high',
    resolutionSource: 'current-url',
  };
}

function detectDocumentBlock(signals: NovelUpdatesPageSignals): ReplacementBlockReason | undefined {
  const pageText = `${signals.title ?? ''}\n${signals.bodyText ?? ''}`.toLowerCase();

  if (
    signals.hasCloudflareChallenge ||
    CHALLENGE_MARKERS.some((marker) => pageText.includes(marker))
  ) {
    return 'challenge-page';
  }
  if (MAINTENANCE_MARKERS.some((marker) => pageText.includes(marker))) {
    return 'maintenance-page';
  }
  return undefined;
}

function parseTrustedSeriesUrl(value: string | undefined): URL | undefined {
  const parsed = parseUrl(value);
  if (!parsed || parsed.origin !== NOVEL_UPDATES_ORIGIN || !SERIES_PATH.test(parsed.pathname)) {
    return undefined;
  }
  return parsed;
}

function parseNovelUpdatesId(value: string | undefined): number | undefined {
  const parsed = parseUrl(value);
  if (!parsed || parsed.origin !== NOVEL_UPDATES_ORIGIN) {
    return undefined;
  }
  const rawId = parsed.searchParams.get('p');
  if (!rawId || !/^[1-9]\d*$/.test(rawId)) {
    return undefined;
  }
  const id = Number(rawId);
  return Number.isSafeInteger(id) ? id : undefined;
}

function parseUrl(value: string | URL | undefined): URL | undefined {
  if (value instanceof URL) {
    return new URL(value.href);
  }
  if (!value) {
    return undefined;
  }
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

function blocked(
  reason: ReplacementBlockReason,
  url?: string,
  route?: NovelUpdatesRouteMatch,
): PageClassification {
  return { kind: 'blocked', reason, ...(url ? { url } : {}), ...(route ? { route } : {}) };
}
