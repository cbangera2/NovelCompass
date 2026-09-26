// D1 helpers shared by the API routes.

export function novelupdatesUrl(novelId: number, _slug?: string | null): string {
  // Stable WordPress ID URL; NU redirects to the current canonical slug.
  return `https://www.novelupdates.com/?p=${novelId}`;
}

export function anilistUrl(
  externalId?: string | null,
  mediaType?: string | null,
  novelId = 0,
): string {
  const kind = mediaType === "anime" || novelId >= 3_000_000 ? "anime" : "manga";
  return `https://anilist.co/${kind}/${externalId}`;
}

export function parseAssociatedNames(value?: string | null): string[] {
  if (!value) return [];
  try {
    const decoded = JSON.parse(value);
    if (Array.isArray(decoded))
      return decoded.map((n) => String(n).trim()).filter(Boolean);
  } catch {
    // fall through to newline split
  }
  return value
    .replace(/\r/g, "\n")
    .split("\n")
    .map((n) => n.trim())
    .filter(Boolean);
}

export function normalizeSearchQuery(query: string): string {
  return (query ?? "")
    .toLowerCase()
    .replace(/[^\w\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function searchTokenClause(
  columnExprs: string[],
  tokens: string[],
): { sql: string; params: string[] } {
  if (tokens.length === 0) return { sql: "1=0", params: [] };
  const params: string[] = [];
  const groups = tokens.map((token) => {
    const ors = columnExprs.map((expr) => `${expr} LIKE ?`).join(" OR ");
    columnExprs.forEach(() => params.push(`%${token}%`));
    return `(${ors})`;
  });
  return { sql: groups.join(" AND "), params };
}

export function mediaTypeSqlFilter(
  mediaType: string,
  column = "COALESCE(media_type, 'novel')",
): { clause: string | null; params: string[] } {
  if (!mediaType || mediaType === "all") return { clause: null, params: [] };
  const requested = mediaType
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  if (requested.length === 0 || requested.includes("all"))
    return { clause: null, params: [] };
  const conditions: string[] = [];
  const params: string[] = [];
  for (const t of requested) {
    if (t === "manga") conditions.push(`${column} IN ('manga','manhwa','manhua','comic')`);
    else if (t === "novel") conditions.push(`${column} IN ('novel','light_novel','web_novel')`);
    else if (t === "anime") conditions.push(`${column} = 'anime'`);
    else {
      conditions.push(`${column} = ?`);
      params.push(t);
    }
  }
  if (conditions.length === 0) return { clause: null, params: [] };
  return { clause: `(${conditions.join(" OR ")})`, params };
}

export function inferMediaType(row: any): string {
  if (row.media_type) return row.media_type;
  const nid = Number(row.id ?? 0);
  if (nid >= 3_000_000) return "anime";
  if (nid >= 2_000_000) return "manga";
  return "novel";
}

export function inferSource(row: any): string {
  if (row.source) return row.source;
  return Number(row.id ?? 0) >= 2_000_000 ? "anilist" : "novelupdates";
}

export function externalUrlFor(row: any): string {
  if (row.external_url) return row.external_url;
  const source = inferSource(row);
  const mediaType = inferMediaType(row);
  const externalId = row.external_id ?? String(row.id);
  if (source === "anilist" && externalId)
    return anilistUrl(externalId, mediaType, Number(row.id ?? 0));
  return novelupdatesUrl(Number(row.id ?? 0), row.slug);
}

export function novelSearchResult(row: any): Record<string, any> {
  return {
    id: row.id,
    title: row.title,
    slug: row.slug ?? "",
    novelupdates_url: externalUrlFor(row),
    external_url: externalUrlFor(row),
    author: row.author ?? "",
    cover_url: row.cover_url ?? null,
    rating: row.rating ?? 0,
    rating_votes: row.rating_votes ?? 0,
    associated_names: parseAssociatedNames(row.associated_names),
    media_type: inferMediaType(row),
    source: inferSource(row),
    external_id: row.external_id ?? String(row.id),
  };
}

const SEARCH_RESULT_COLUMNS = `
  id, title, slug, author, cover_url, rating, rating_votes,
  associated_names, COALESCE(media_type, 'novel') AS media_type,
  COALESCE(source, 'novelupdates') AS source, external_id, external_url
`;

export { SEARCH_RESULT_COLUMNS };

export async function datasetVersion(db: D1Database): Promise<string> {
  const override = (globalThis as any).__DATASET_VERSION__ as string | undefined;
  if (override) return override;
  const novelStats = await db
    .prepare("SELECT COUNT(*) AS n, COALESCE(MAX(updated_at), '') AS u, COALESCE(MAX(id), 0) AS m FROM novels")
    .first<any>();
  const dims = [String(novelStats?.n ?? 0), String(novelStats?.u ?? ""), String(novelStats?.m ?? 0)];
  for (const table of [
    "tags", "novel_tags", "genres", "novel_genres",
    "direct_recs", "related_series", "rec_lists", "rec_list_items",
  ]) {
    const r = await db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).first<{ c: number }>();
    dims.push(String(r?.c ?? 0));
  }
  const data = new TextEncoder().encode(dims.join("|"));
  const digest = await crypto.subtle.digest("SHA-256", data);
  const hex = [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 12);
  return `db-${hex}`;
}
