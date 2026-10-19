/** Curated list page (`?view=list&id=<NovelUpdates list id>`). Kept out of routeState.ts, which is loaded by a CommonJS test harness that cannot parse import.meta. */
export function listPageUrl(id: number): string {
  return `${import.meta.env.BASE_URL}?view=list&id=${id}`;
}
