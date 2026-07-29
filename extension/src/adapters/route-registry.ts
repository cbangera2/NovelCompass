export type RoutePolicy = 'bespoke-replacement' | 'shared-shell-native' | 'pass-through';

export type RoutePriority = 0 | 1 | 2;

export type NovelUpdatesRouteFamily =
  | 'series'
  | 'series-finder'
  | 'series-ranking'
  | 'home'
  | 'catalog-feed'
  | 'catalog-taxonomy'
  | 'recommendation-lists'
  | 'public-profile'
  | 'reading-library'
  | 'account-form'
  | 'contributor-form'
  | 'content-page'
  | 'redirect'
  | 'security-action'
  | 'wordpress-internal'
  | 'machine-readable';

export interface NovelUpdatesRouteMatch {
  family: NovelUpdatesRouteFamily;
  policy: RoutePolicy;
  priority: RoutePriority;
  uiImplemented: boolean;
}

interface RouteDefinition extends NovelUpdatesRouteMatch {
  pattern: RegExp;
}

const ROUTES: readonly RouteDefinition[] = [
  replacement('series', 0, /^\/series\/[a-z0-9]+(?:-[a-z0-9]+)*\/?$/, true),
  replacement('series-finder', 0, /^\/series-finder\/?$/, true),
  replacement('series-ranking', 0, /^\/series-ranking\/?$/),
  replacement('home', 1, /^\/$/),
  replacement('catalog-feed', 1, /^\/(?:novelslisting|latest-series|page\/\d+)\/?$/),
  replacement(
    'catalog-taxonomy',
    1,
    /^\/(?:genre|stag|language|ntype|nauthor|nartist|opublisher|epublisher|group)\/[^/]+\/?$/,
  ),
  replacement(
    'recommendation-lists',
    1,
    /^\/(?:recommendation-lists|list-tags)\/?$|^\/(?:viewlist\/\d+|listtag\/[^/]+)\/?$/,
  ),
  replacement('public-profile', 1, /^\/user(?:\/\d+)?(?:\/[^/]+)?\/?$/),
  replacement('reading-library', 1, /^\/(?:reading-list|following)\/?$/),
  native('account-form', 1, /^\/(?:account|your-profile|release-filtering|series-filtering)\/?$/),
  native('account-form', 1, /^\/userlist(?:\/\d+)?\/?$/),
  native(
    'contributor-form',
    2,
    /^\/(?:add-series|add-release|add-group|request-tag|report-problem|nu-edit-logs)\/?$/,
  ),
  native('content-page', 2, /^\/(?:privacy-policy|terms-of-service|contact-us)\/?$/),
  passThrough('redirect', 0, /^\/random-novel\/?$|^\/extnu\/\d+\/?$/),
  passThrough('security-action', 0, /^\/logout\/?$|^\/report\/[^/]+\/\d+\/?$/),
  passThrough('wordpress-internal', 0, /^\/wp-(?:admin|login)(?:\/.*)?$|^\/xmlrpc\.php$/),
  passThrough('machine-readable', 0, /^\/wp-json(?:\/.*)?$|^\/(?:comments\/)?feed\/?$/),
];

const NUMERIC_POST_REDIRECT: NovelUpdatesRouteMatch = {
  family: 'redirect',
  policy: 'pass-through',
  priority: 0,
  uiImplemented: false,
};

export function matchNovelUpdatesRoute(
  pathname: string,
  search = '',
): NovelUpdatesRouteMatch | undefined {
  if (pathname === '/' && /^[?&](?:[^&]+&)*p=[1-9]\d*(?:&|$)/.test(search)) {
    return NUMERIC_POST_REDIRECT;
  }
  const route = ROUTES.find((candidate) => candidate.pattern.test(pathname));
  if (!route) {
    return undefined;
  }
  const { pattern: _pattern, ...match } = route;
  return match;
}

function replacement(
  family: NovelUpdatesRouteFamily,
  priority: RoutePriority,
  pattern: RegExp,
  uiImplemented = false,
): RouteDefinition {
  return { family, policy: 'bespoke-replacement', priority, pattern, uiImplemented };
}

function native(
  family: NovelUpdatesRouteFamily,
  priority: RoutePriority,
  pattern: RegExp,
): RouteDefinition {
  return { family, policy: 'shared-shell-native', priority, pattern, uiImplemented: false };
}

function passThrough(
  family: NovelUpdatesRouteFamily,
  priority: RoutePriority,
  pattern: RegExp,
): RouteDefinition {
  return { family, policy: 'pass-through', priority, pattern, uiImplemented: false };
}
