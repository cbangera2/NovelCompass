export const DISCOVER_DEFAULTS = {
  hiddenGemMode: false, excludeHarem: false, excludeBL: false, excludeYuri: false,
  requireCompleted: false, language: '', minRating: 0, minRatingVotes: 0, maxReaders: 0,
  minYear: 0, maxYear: 0, includeTagsText: '', excludeTagsText: '', tagWeight: .8,
  directRecWeight: 1.2, listWeight: 1, structuralWeight: .6, hiddenGemStrength: .3, maxResults: 60
};

export type DiscoverRouteState = typeof DISCOVER_DEFAULTS & {
  seed?: number;
  forYou?: boolean;
  genreStates: Record<string, 'include' | 'exclude'>;
};

const numberValue = (params: URLSearchParams, key: string, fallback: number, min = 0, max = Number.MAX_SAFE_INTEGER) => {
  if (!params.has(key)) return fallback;
  const value = Number(params.get(key));
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
};
const booleanValue = (params: URLSearchParams, key: string, fallback: boolean) =>
  params.has(key) ? params.get(key) === '1' : fallback;

export function parseDiscoverRoute(params: URLSearchParams, fallback: DiscoverRouteState): DiscoverRouteState {
  const genreStates: Record<string, 'include' | 'exclude'> = {};
  (params.get('g') || '').split(',').forEach((token) => {
    const value = token.slice(1).trim();
    if (value && token[0] === '+') genreStates[value] = 'include';
    if (value && token[0] === '-') genreStates[value] = 'exclude';
  });
  const seed = numberValue(params, 'seed', 0, 1);
  return {
    ...fallback,
    seed: seed || undefined,
    forYou: booleanValue(params, 'for_you', Boolean(fallback.forYou)),
    hiddenGemMode: booleanValue(params, 'hg', fallback.hiddenGemMode),
    excludeHarem: booleanValue(params, 'xh', fallback.excludeHarem),
    excludeBL: booleanValue(params, 'xb', fallback.excludeBL),
    excludeYuri: booleanValue(params, 'xy', fallback.excludeYuri),
    requireCompleted: booleanValue(params, 'done', fallback.requireCompleted),
    language: params.has('lang') ? params.get('lang') || '' : fallback.language,
    minRating: numberValue(params, 'r', fallback.minRating, 0, 5),
    minRatingVotes: numberValue(params, 'v', fallback.minRatingVotes),
    maxReaders: numberValue(params, 'mr', fallback.maxReaders),
    minYear: numberValue(params, 'y0', fallback.minYear),
    maxYear: numberValue(params, 'y1', fallback.maxYear),
    genreStates: params.has('g') ? genreStates : fallback.genreStates,
    includeTagsText: params.has('ti') ? params.get('ti') || '' : fallback.includeTagsText,
    excludeTagsText: params.has('tx') ? params.get('tx') || '' : fallback.excludeTagsText,
    tagWeight: numberValue(params, 'wt', fallback.tagWeight, 0, 3),
    directRecWeight: numberValue(params, 'wd', fallback.directRecWeight, 0, 3),
    listWeight: numberValue(params, 'wl', fallback.listWeight, 0, 3),
    structuralWeight: numberValue(params, 'ws', fallback.structuralWeight, 0, 3),
    hiddenGemStrength: numberValue(params, 'wh', fallback.hiddenGemStrength, 0, 1),
    maxResults: numberValue(params, 'n', fallback.maxResults, 1, 100)
  };
}

export function discoverSearchParams(state: DiscoverRouteState): URLSearchParams {
  const params = new URLSearchParams([['view', 'discover']]);
  const set = (key: string, value: string | number | boolean, fallback: string | number | boolean) => {
    if (value !== fallback && value !== '' && value !== false && value !== 0) params.set(key, value === true ? '1' : String(value));
  };
  if (state.seed) params.set('seed', String(state.seed));
  set('for_you', Boolean(state.forYou), false);
  set('hg', state.hiddenGemMode, false); set('xh', state.excludeHarem, false);
  set('xb', state.excludeBL, false); set('xy', state.excludeYuri, false); set('done', state.requireCompleted, false);
  set('lang', state.language, ''); set('r', state.minRating, 0); set('v', state.minRatingVotes, 0);
  set('mr', state.maxReaders, 0); set('y0', state.minYear, 0); set('y1', state.maxYear, 0);
  const genres = Object.entries(state.genreStates).sort(([a], [b]) => a.localeCompare(b))
    .map(([name, value]) => `${value === 'include' ? '+' : '-'}${name}`).join(',');
  if (genres) params.set('g', genres);
  set('ti', state.includeTagsText.trim(), ''); set('tx', state.excludeTagsText.trim(), '');
  set('wt', state.tagWeight, DISCOVER_DEFAULTS.tagWeight); set('wd', state.directRecWeight, DISCOVER_DEFAULTS.directRecWeight);
  set('wl', state.listWeight, DISCOVER_DEFAULTS.listWeight); set('ws', state.structuralWeight, DISCOVER_DEFAULTS.structuralWeight);
  set('wh', state.hiddenGemStrength, DISCOVER_DEFAULTS.hiddenGemStrength); set('n', state.maxResults, DISCOVER_DEFAULTS.maxResults);
  return params;
}

export function stableRouteUrl(params: URLSearchParams): string {
  const sorted = new URLSearchParams([...params.entries()].sort(([a], [b]) => a.localeCompare(b)));
  return `${window.location.pathname}?${sorted.toString()}${window.location.hash}`;
}
