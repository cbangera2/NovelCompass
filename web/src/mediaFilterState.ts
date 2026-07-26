import { useState, useEffect } from 'react';

export type MediaTypeChoice = 'novel' | 'manga' | 'anime';

const STORAGE_KEY = 'novel-compass:media-types:v1';
const CROSS_FORMAT_KEY = 'novel-compass:include-other-formats:v1';
const EVENT_NAME = 'novel-compass-media-types-changed';
const CROSS_FORMAT_EVENT = 'novel-compass-include-other-formats-changed';

const ALL_TYPES: MediaTypeChoice[] = ['novel', 'manga', 'anime'];

const SHORT_LABELS: Record<MediaTypeChoice, string> = {
  novel: 'novels',
  manga: 'manga',
  anime: 'anime',
};

const LONG_LABELS: Record<MediaTypeChoice, string> = {
  novel: 'Light novels',
  manga: 'Manga',
  anime: 'Anime',
};

export function parseMediaTypesFromUrl(searchOrParams?: string | URLSearchParams): MediaTypeChoice[] | null {
  try {
    const params = typeof searchOrParams === 'string'
      ? new URLSearchParams(searchOrParams)
      : searchOrParams || (typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null);
    if (!params) return null;
    const raw = params.get('types') || params.get('media') || params.get('media_type');
    if (!raw) return null;
    if (raw === 'all') return [...ALL_TYPES];
    const tokens = raw.split(',').map((t) => t.trim().toLowerCase());
    const clean = tokens.filter((t): t is MediaTypeChoice => t === 'novel' || t === 'manga' || t === 'anime');
    if (clean.length > 0) {
      // Remove duplicates while preserving order
      return Array.from(new Set(clean));
    }
  } catch {
    // fallback
  }
  return null;
}

export function getSelectedMediaTypes(searchOrParams?: string | URLSearchParams): MediaTypeChoice[] {
  const fromUrl = parseMediaTypesFromUrl(searchOrParams);
  if (fromUrl) return fromUrl;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [...ALL_TYPES];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      const clean = parsed.filter((t): t is MediaTypeChoice =>
        t === 'novel' || t === 'manga' || t === 'anime'
      );
      if (clean.length) return clean;
    }
  } catch {
    // fallback to all
  }
  return [...ALL_TYPES];
}

export function setSelectedMediaTypes(types: MediaTypeChoice[]): void {
  const clean = types.filter((t) => ALL_TYPES.includes(t));
  const next = clean.length > 0 ? clean : [...ALL_TYPES];
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    }
  } catch {
    // ignore storage restrictions
  }
  if (typeof window !== 'undefined' && typeof CustomEvent !== 'undefined') {
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: next }));
  }
}

export function toggleMediaType(type: MediaTypeChoice): MediaTypeChoice[] {
  const current = getSelectedMediaTypes();
  let next: MediaTypeChoice[];
  if (current.includes(type)) {
    // Keep at least one format selected — do not silently reset to all.
    if (current.length === 1) return current;
    next = current.filter((t) => t !== type);
  } else {
    next = [...current, type];
  }
  setSelectedMediaTypes(next);
  return next;
}

/** True when every catalog format is selected (no effective media filter). */
export function isAllMediaSelected(types: MediaTypeChoice[] = getSelectedMediaTypes()): boolean {
  return ALL_TYPES.every((t) => types.includes(t));
}

/**
 * Comma-separated media_type for API/static filters.
 * Returns empty string when all formats are selected (callers treat as unfiltered).
 */
export function mediaTypesQueryParam(types: MediaTypeChoice[] = getSelectedMediaTypes()): string {
  if (isAllMediaSelected(types)) return '';
  return types.join(',');
}

/** Compact label for search chrome: "all formats", "anime", "novels & manga", etc. */
export function formatScopeLabel(types: MediaTypeChoice[] = getSelectedMediaTypes()): string {
  if (isAllMediaSelected(types) || types.length === 0) return 'all formats';
  if (types.length === 1) return SHORT_LABELS[types[0]];
  if (types.length === 2) return `${SHORT_LABELS[types[0]]} & ${SHORT_LABELS[types[1]]}`;
  return types.map((t) => SHORT_LABELS[t]).join(', ');
}

export function formatScopeSentence(types: MediaTypeChoice[] = getSelectedMediaTypes()): string {
  if (isAllMediaSelected(types) || types.length === 0) return 'all catalog formats';
  if (types.length === 1) return LONG_LABELS[types[0]].toLowerCase();
  if (types.length === 2) {
    return `${LONG_LABELS[types[0]].toLowerCase()} and ${LONG_LABELS[types[1]].toLowerCase()}`;
  }
  return types.map((t) => LONG_LABELS[t].toLowerCase()).join(', ');
}

export function searchPlaceholder(types: MediaTypeChoice[] = getSelectedMediaTypes()): string {
  if (isAllMediaSelected(types)) return 'Search titles…';
  return `Search ${formatScopeLabel(types)}…`;
}

export function resolveMediaBucket(
  id: number,
  mediaType?: string | null
): MediaTypeChoice {
  const mt = (mediaType || '').toLowerCase();
  if (mt === 'anime' || (!mt && id >= 3_000_000)) return 'anime';
  if (
    ['manga', 'manhwa', 'manhua', 'comic'].includes(mt) ||
    (!mt && id >= 2_000_000 && id < 3_000_000)
  ) {
    return 'manga';
  }
  return 'novel';
}

export function mediaTypeInScope(
  id: number,
  mediaType?: string | null,
  types: MediaTypeChoice[] = getSelectedMediaTypes()
): boolean {
  if (isAllMediaSelected(types)) return true;
  return types.includes(resolveMediaBucket(id, mediaType));
}

/** Discover-only: when true, recommendations ignore the format scope. */
export function getIncludeOtherFormats(): boolean {
  try {
    return localStorage.getItem(CROSS_FORMAT_KEY) === '1';
  } catch {
    return false;
  }
}

export function setIncludeOtherFormats(value: boolean): void {
  localStorage.setItem(CROSS_FORMAT_KEY, value ? '1' : '0');
  window.dispatchEvent(new CustomEvent(CROSS_FORMAT_EVENT, { detail: value }));
}

export function useMediaFilterState() {
  const [selectedTypes, setSelected] = useState<MediaTypeChoice[]>(getSelectedMediaTypes);
  const [includeOtherFormats, setIncludeOther] = useState(getIncludeOtherFormats);

  useEffect(() => {
    const onMedia = (e: Event) => {
      const custom = e as CustomEvent<MediaTypeChoice[]>;
      setSelected(custom.detail || getSelectedMediaTypes());
    };
    const onCross = (e: Event) => {
      const custom = e as CustomEvent<boolean>;
      setIncludeOther(typeof custom.detail === 'boolean' ? custom.detail : getIncludeOtherFormats());
    };
    window.addEventListener(EVENT_NAME, onMedia);
    window.addEventListener(CROSS_FORMAT_EVENT, onCross);
    window.addEventListener('storage', onMedia);
    window.addEventListener('storage', onCross);
    return () => {
      window.removeEventListener(EVENT_NAME, onMedia);
      window.removeEventListener(CROSS_FORMAT_EVENT, onCross);
      window.removeEventListener('storage', onMedia);
      window.removeEventListener('storage', onCross);
    };
  }, []);

  return {
    selectedTypes,
    toggleType: (type: MediaTypeChoice) => toggleMediaType(type),
    setTypes: (types: MediaTypeChoice[]) => setSelectedMediaTypes(types),
    isAllSelected: isAllMediaSelected(selectedTypes),
    isSelected: (type: MediaTypeChoice) => selectedTypes.includes(type),
    mediaParam: mediaTypesQueryParam(selectedTypes),
    scopeLabel: formatScopeLabel(selectedTypes),
    scopeSentence: formatScopeSentence(selectedTypes),
    searchPlaceholder: searchPlaceholder(selectedTypes),
    includeOtherFormats,
    setIncludeOtherFormats: (value: boolean) => setIncludeOtherFormats(value),
  };
}
