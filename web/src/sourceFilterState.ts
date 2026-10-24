import { useEffect, useState } from 'react';

/** Where a catalog title comes from. Independent of format (novel / manga / anime). */
export type SourceChoice = 'novelupdates' | 'anilist' | 'novelphoenix';

const STORAGE_KEY = 'novel-compass:sources:v1';
const EVENT_NAME = 'novel-compass-sources-changed';

export const ALL_SOURCES: SourceChoice[] = ['novelupdates', 'anilist', 'novelphoenix'];

/** Novel Phoenix is off until its titles have been reviewed; turn it on under Settings → Catalog sources. */
export const DEFAULT_SOURCES: SourceChoice[] = ['novelupdates', 'anilist'];

export const SOURCE_LABELS: Record<SourceChoice, string> = {
  novelupdates: 'NovelUpdates',
  anilist: 'AniList',
  novelphoenix: 'Novel Phoenix',
};

export const SOURCE_DESCRIPTIONS: Record<SourceChoice, string> = {
  novelupdates: 'Translated web and light novels',
  anilist: 'Manga, manhwa, light novels and anime',
  novelphoenix: 'Original English web novels, many unrated',
};

function clean(values: unknown): SourceChoice[] {
  if (!Array.isArray(values)) return [];
  return ALL_SOURCES.filter((source) => values.includes(source));
}

export function getSelectedSources(): SourceChoice[] {
  try {
    const stored = clean(JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'));
    if (stored.length) return stored;
  } catch {
    // storage unavailable or malformed: use the default
  }
  return [...DEFAULT_SOURCES];
}

export function setSelectedSources(sources: SourceChoice[]): void {
  const next = clean(sources);
  const value = next.length ? next : [...DEFAULT_SOURCES];
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // ignore storage restrictions
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: value }));
}

export function toggleSource(source: SourceChoice): SourceChoice[] {
  const current = getSelectedSources();
  let next: SourceChoice[];
  if (current.includes(source)) {
    // Keep at least one source selected.
    if (current.length === 1) return current;
    next = current.filter((item) => item !== source);
  } else {
    next = [...current, source];
  }
  setSelectedSources(next);
  return next;
}

export function isAllSourcesSelected(sources: SourceChoice[] = getSelectedSources()): boolean {
  return ALL_SOURCES.every((source) => sources.includes(source));
}

/** Comma-separated `source` param for the API and static filters. Empty when every source is selected. */
export function sourcesQueryParam(sources: SourceChoice[] = getSelectedSources()): string {
  return isAllSourcesSelected(sources) ? '' : sources.join(',');
}

/** The source of a catalog row, falling back to its id range when the row predates the `source` column. */
export function resolveSource(id: number, source?: string | null): string {
  if (source) return source.toLowerCase();
  if (id >= 2_000_000) return 'anilist';
  if (id >= 1_000_000) return 'novelphoenix';
  return 'novelupdates';
}

export function sourceInScope(id: number, source?: string | null, sources: SourceChoice[] = getSelectedSources()): boolean {
  if (isAllSourcesSelected(sources)) return true;
  return sources.includes(resolveSource(id, source) as SourceChoice);
}

/** Matches a comma-separated `source` request value ("all", empty, or "novelupdates,anilist"). */
export function matchesSourceParam(id: number, source: string | null | undefined, requested?: string | null): boolean {
  const wanted = (requested || '').split(',').map((item) => item.trim().toLowerCase()).filter(Boolean);
  if (!wanted.length || wanted.includes('all')) return true;
  return wanted.includes(resolveSource(id, source));
}

export function useSourceFilterState() {
  const [selectedSources, setSelected] = useState<SourceChoice[]>(getSelectedSources);

  useEffect(() => {
    const sync = () => setSelected(getSelectedSources());
    window.addEventListener(EVENT_NAME, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(EVENT_NAME, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  return {
    selectedSources,
    isSelected: (source: SourceChoice) => selectedSources.includes(source),
    toggleSource,
    setSources: setSelectedSources,
    sourceParam: sourcesQueryParam(selectedSources),
    isAllSelected: isAllSourcesSelected(selectedSources),
  };
}
