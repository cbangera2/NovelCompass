/**
 * Per-browser For You row preferences: built-in rows the reader has hidden, and rows they added themselves
 * (a format plus a genre or tag, ranked by rating or popularity). Same event + storage sync pattern as the
 * format filter, so the For You page and the Settings page stay in step.
 */
import { useEffect, useState } from 'react';
import { rowTitle } from './forYouGenres';
import type { MediaTypeChoice } from './mediaFilterState';

export type CustomRowKind = 'rating' | 'popular';

export interface CustomRow {
  id: string;
  type: MediaTypeChoice;
  kind: CustomRowKind;
  field: 'genre' | 'tag';
  name: string;
}

export interface ForYouRowPrefs {
  /** Keys of built-in rows (`top-anime`, `genre-sports`, `blend`, ...) the reader doesn't want. */
  hidden: string[];
  custom: CustomRow[];
}

const STORAGE_KEY = 'novel-compass:for-you-rows:v1';
const EVENT_NAME = 'novel-compass-for-you-rows-changed';
const EMPTY: ForYouRowPrefs = { hidden: [], custom: [] };
const TYPES: MediaTypeChoice[] = ['novel', 'manga', 'anime'];

const isCustomRow = (value: unknown): value is CustomRow => {
  const row = value as Partial<CustomRow> | null;
  return Boolean(
    row && typeof row.id === 'string' && typeof row.name === 'string' && row.name.trim() &&
    TYPES.includes(row.type as MediaTypeChoice) &&
    (row.kind === 'rating' || row.kind === 'popular') &&
    (row.field === 'genre' || row.field === 'tag'),
  );
};

export function loadRowPrefs(): ForYouRowPrefs {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return {
      hidden: Array.isArray(parsed.hidden) ? parsed.hidden.filter((key: unknown): key is string => typeof key === 'string') : [],
      custom: Array.isArray(parsed.custom) ? parsed.custom.filter(isCustomRow) : [],
    };
  } catch {
    return EMPTY;
  }
}

function saveRowPrefs(prefs: ForYouRowPrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // storage unavailable: the change still applies to this tab through the event below
  }
  window.dispatchEvent(new CustomEvent<ForYouRowPrefs>(EVENT_NAME, { detail: prefs }));
}

export const customRowKey = (row: CustomRow) => `custom-${row.id}`;

/** Title with the format spelled out, for places (Settings) that aren't scoped to one format. */
export const customRowTitle = (row: CustomRow): string => rowTitle(row.name, row.kind, [row.type], true);

export function useForYouRowPrefs() {
  const [prefs, setPrefs] = useState<ForYouRowPrefs>(loadRowPrefs);
  useEffect(() => {
    const sync = (event: Event) => setPrefs((event as CustomEvent<ForYouRowPrefs>).detail ?? loadRowPrefs());
    const syncStorage = () => setPrefs(loadRowPrefs());
    window.addEventListener(EVENT_NAME, sync);
    window.addEventListener('storage', syncStorage);
    return () => {
      window.removeEventListener(EVENT_NAME, sync);
      window.removeEventListener('storage', syncStorage);
    };
  }, []);

  const update = (change: (current: ForYouRowPrefs) => ForYouRowPrefs) => saveRowPrefs(change(loadRowPrefs()));
  return {
    prefs,
    setHidden: (key: string, hidden: boolean) => update((current) => ({
      ...current,
      hidden: hidden ? [...new Set([...current.hidden, key])] : current.hidden.filter((item) => item !== key),
    })),
    addCustom: (row: Omit<CustomRow, 'id'>) => update((current) => {
      const duplicate = current.custom.some((item) =>
        item.type === row.type && item.kind === row.kind && item.field === row.field && item.name.toLowerCase() === row.name.toLowerCase());
      if (duplicate) return current;
      return { ...current, custom: [...current.custom, { ...row, id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5) }] };
    }),
    removeCustom: (id: string) => update((current) => ({ ...current, custom: current.custom.filter((row) => row.id !== id) })),
    reset: () => saveRowPrefs(EMPTY),
  };
}
