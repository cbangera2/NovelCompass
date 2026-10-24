// `source` filters accept "all", one source, or a comma-separated list
// ("novelupdates,anilist"). An empty list or "all" means unfiltered.

export function parseSourceFilter(source: string | null | undefined): string[] | null {
  const requested = (source ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (requested.length === 0 || requested.includes("all")) return null;
  return requested;
}

export function sourceMatches(cardSource: string, filter: string | null | undefined): boolean {
  const requested = parseSourceFilter(filter);
  return !requested || requested.includes(cardSource.toLowerCase());
}

export function sourceSqlFilter(
  source: string | null | undefined,
  column = "COALESCE(source, 'novelupdates')",
): { clause: string | null; params: string[] } {
  const requested = parseSourceFilter(source);
  if (!requested) return { clause: null, params: [] };
  return { clause: `${column} IN (${requested.map(() => "?").join(",")})`, params: requested };
}
