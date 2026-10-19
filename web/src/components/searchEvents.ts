import type { NovelSearchResult } from '../types';

/** The header search is the one search box; pages talk to it through these window events. */
export const OPEN_SEARCH_EVENT = 'novel-compass:open-search';
export const SEED_SELECTED_EVENT = 'novel-compass:seed-selected';

export type OpenSearchDetail = { mode?: 'seed' };

/** Open the header search. In `seed` mode, picking a title emits SEED_SELECTED_EVENT instead of navigating. */
export function openGlobalSearch(detail: OpenSearchDetail = {}): void {
  window.dispatchEvent(new CustomEvent<OpenSearchDetail>(OPEN_SEARCH_EVENT, { detail }));
}

export function emitSeedSelected(novel: NovelSearchResult): void {
  window.dispatchEvent(new CustomEvent<NovelSearchResult>(SEED_SELECTED_EVENT, { detail: novel }));
}
