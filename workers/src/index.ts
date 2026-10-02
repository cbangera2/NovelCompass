// NovelCompass API on Cloudflare Workers + D1.
// Ports src/api/main.py (FastAPI). The web frontend's ApiDataSource talks to
// these /api/* routes with relative URLs, so the same Worker also serves the
// Vite build as static assets (see wrangler.toml [assets]).

import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  ALGORITHM_VERSION,
  DEFAULT_CHANNEL_WEIGHTS,
  SCHEMA_VERSION,
  affinityMultiplier,
  applyHiddenGemBoost,
  calculateMatchPercent,
  calculateRrfScores,
  explainRecommendation,
  filterCandidates,
  getCandidateChannels,
  type ChannelCandidates,
  type FilterPreferences,
} from "./recommend";
import {
  SEARCH_RESULT_COLUMNS,
  anilistUrl,
  datasetVersion,
  externalUrlFor,
  inferMediaType,
  inferSource,
  mediaTypeSqlFilter,
  normalizeSearchQuery,
  novelSearchResult,
  novelupdatesUrl,
  parseAssociatedNames,
  searchTokenClause,
} from "./db";

interface Env {
  DB: D1Database;
}

const app = new Hono<{ Bindings: Env }>();
app.use("/api/*", cors());

function clampChannelWeights(raw: Record<string, number> | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw) return out;
  for (const key of ["vector", "tag", "direct_rec", "rec_list", "structural"]) {
    const v = raw[key];
    if (v !== undefined && v !== null && !Number.isNaN(Number(v))) {
      out[key] = Math.max(0, Math.min(3, Number(v)));
    }
  }
  return out;
}

function recommendPreferences(body: any, extraExclude: number[]): FilterPreferences {
  const excludeTags: string[] = [];
  if (body.exclude_harem) excludeTags.push("harem", "reverse harem");
  if (body.exclude_bl) excludeTags.push("yaoi", "bl", "boys love", "shounen ai");
  if (body.exclude_yuri) excludeTags.push("yuri", "shoujo ai");
  excludeTags.push(...(body.exclude_tags ?? []));
  const excludeIds = new Set<number>();
  for (const nid of body.exclude_novel_ids ?? []) {
    const n = Number(nid);
    if (Number.isInteger(n)) excludeIds.add(n);
  }
  for (const nid of extraExclude) excludeIds.add(nid);
  return {
    exclude_tags: excludeTags,
    include_tags: body.include_tags ?? [],
    include_genres: body.include_genres ?? [],
    exclude_genres: body.exclude_genres ?? [],
    language: body.language ?? "",
    min_rating: body.min_rating ?? 0,
    min_rating_votes: body.min_rating_votes ?? 0,
    max_readers: body.max_readers ?? 0,
    min_year: body.min_year ?? 0,
    max_year: body.max_year ?? 0,
    require_completed: body.require_completed ?? false,
    min_chapters: body.min_chapters ?? 0,
    media_type: body.media_type ?? "all",
    source: body.source ?? "all",
    exclude_novel_ids: [...excludeIds],
  };
}

// ---------------------------------------------------------------------------
// health
// ---------------------------------------------------------------------------

app.get("/api/health", async (c) => {
  const db = c.env.DB;
  const row = await db.prepare("SELECT COUNT(*) AS n FROM novels").first<{ n: number }>();
  const novelCount = row?.n ?? 0;
  return c.json({
    status: novelCount ? "ok" : "empty",
    schema_version: SCHEMA_VERSION,
    algorithm_version: ALGORITHM_VERSION,
    dataset_version: await datasetVersion(db),
    novel_count: novelCount,
  });
});

// ---------------------------------------------------------------------------
// resolve slugs / ids
// ---------------------------------------------------------------------------

app.post("/api/resolve-slugs", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const requested = [
    ...new Set(
      ((body.slugs ?? []) as string[])
        .map((s) => String(s).trim().toLowerCase())
        .filter(Boolean),
    ),
  ].slice(0, 1000);
  if (requested.length === 0) return c.json({ results: [] });
  const db = c.env.DB;
  const results: any[] = [];
  for (let i = 0; i < requested.length; i += 100) {
    const chunk = requested.slice(i, i + 100);
    const placeholders = chunk.map(() => "?").join(",");
    const rows = await db
      .prepare(
        `SELECT ${SEARCH_RESULT_COLUMNS} FROM novels WHERE lower(slug) IN (${placeholders})`,
      )
      .bind(...chunk)
      .all();
    for (const row of rows.results ?? []) results.push(novelSearchResult(row));
  }
  return c.json({ results });
});

app.post("/api/resolve-ids", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const requested = [
    ...new Set(
      ((body.ids ?? []) as any[])
        .map((v) => Number(v))
        .filter((n) => Number.isInteger(n)),
    ),
  ].slice(0, 2000);
  if (requested.length === 0) return c.json({ results: [] });
  const db = c.env.DB;
  const results: any[] = [];
  for (let i = 0; i < requested.length; i += 100) {
    const chunk = requested.slice(i, i + 100);
    const placeholders = chunk.map(() => "?").join(",");
    const rows = await db
      .prepare(`SELECT ${SEARCH_RESULT_COLUMNS} FROM novels WHERE id IN (${placeholders})`)
      .bind(...chunk)
      .all();
    for (const row of rows.results ?? []) results.push(novelSearchResult(row));
  }
  return c.json({ results });
});

// ---------------------------------------------------------------------------
// search
// ---------------------------------------------------------------------------

app.get("/api/search", async (c) => {
  const q = c.req.query("q") ?? "";
  const limit = Math.min(100, Math.max(1, Number(c.req.query("limit") ?? 10)));
  const mediaType = c.req.query("media_type") ?? "all";
  const source = c.req.query("source") ?? "all";
  if (!q.trim()) return c.json({ query: q, results: [] }, 400);

  const db = c.env.DB;
  const where: string[] = [];
  const params: any[] = [];
  const normalized = normalizeSearchQuery(q);
  const tokens = normalized.split(" ").filter(Boolean);
  if (tokens.length > 0) {
    const { sql, params: tp } = searchTokenClause(
      ["title", "slug", "associated_names", "author"],
      tokens,
    );
    where.push(`(${sql})`);
    params.push(...tp);
  } else {
    const needle = `%${q.trim()}%`;
    where.push("(title LIKE ? OR slug LIKE ? OR associated_names LIKE ?)");
    params.push(needle, needle, needle);
  }
  const { clause, params: mp } = mediaTypeSqlFilter(mediaType);
  if (clause) {
    where.push(clause);
    params.push(...mp);
  }
  if (source && source !== "all") {
    where.push("COALESCE(source, 'novelupdates') = ?");
    params.push(source);
  }
  params.push(limit);
  const rows = await db
    .prepare(
      `SELECT ${SEARCH_RESULT_COLUMNS} FROM novels
       WHERE ${where.join(" AND ")}
       ORDER BY reading_list_count DESC, rating_votes DESC
       LIMIT ?`,
    )
    .bind(...params)
    .all();
  return c.json({
    query: q,
    results: (rows.results ?? []).map(novelSearchResult),
  });
});

// ---------------------------------------------------------------------------
// browse
// ---------------------------------------------------------------------------

interface BrowseFilters {
  query: string;
  sort: string;
  language: string;
  author: string;
  genre: string;
  tag: string;
  min_rating: number;
  max_rating: number;
  min_votes: number;
  min_year: number;
  max_year: number;
  status: string;
  min_chapters: number;
  max_chapters: number;
  min_readers: number;
  max_readers: number;
  include_genres: string;
  exclude_genres: string;
  include_tags: string;
  exclude_tags: string;
  tag_match: string;
  exclude_ids: string;
  direction: string;
  media_type: string;
  source: string;
}

function browseFiltersFromQuery(c: any): BrowseFilters {
  const q = c.req.query.bind(c.req);
  const num = (k: string, d = 0) => {
    const v = Number(q(k));
    return Number.isFinite(v) ? v : d;
  };
  const str = (k: string, d = "") => (q(k) ?? d) as string;
  const direction = str("direction", "desc") === "asc" ? "asc" : "desc";
  const sort = ["popular", "rating", "votes", "title", "newest"].includes(str("sort", "popular"))
    ? str("sort", "popular")
    : "popular";
  return {
    query: str("query"), sort, language: str("language"), author: str("author"),
    genre: str("genre"), tag: str("tag"),
    min_rating: num("min_rating"), max_rating: num("max_rating"),
    min_votes: num("min_votes"), min_year: num("min_year"), max_year: num("max_year"),
    status: str("status"), min_chapters: num("min_chapters"), max_chapters: num("max_chapters"),
    min_readers: num("min_readers"), max_readers: num("max_readers"),
    include_genres: str("include_genres"), exclude_genres: str("exclude_genres"),
    include_tags: str("include_tags"), exclude_tags: str("exclude_tags"),
    tag_match: str("tag_match") === "any" ? "any" : "every",
    exclude_ids: str("exclude_ids"), direction,
    media_type: str("media_type"), source: str("source"),
  };
}

export function browseWhere(f: BrowseFilters): { joins: string[]; where: string[]; params: any[] } {
  const joins: string[] = [];
  const where = ["n.rating >= ?", "n.rating_votes >= ?"];
  const params: any[] = [f.min_rating, f.min_votes];
  if (f.max_rating) { where.push("n.rating <= ?"); params.push(f.max_rating); }
  if (f.min_year) { where.push("n.year >= ?"); params.push(f.min_year); }
  if (f.max_year) { where.push("n.year <= ?"); params.push(f.max_year); }
  if (f.status) { where.push("LOWER(COALESCE(n.status_trans, '')) LIKE LOWER(?)"); params.push(`%${f.status}%`); }
  if (f.min_chapters) { where.push("n.chapters_trans >= ?"); params.push(f.min_chapters); }
  if (f.max_chapters) { where.push("n.chapters_trans <= ?"); params.push(f.max_chapters); }
  if (f.min_readers) { where.push("n.reading_list_count >= ?"); params.push(f.min_readers); }
  if (f.max_readers) { where.push("n.reading_list_count <= ?"); params.push(f.max_readers); }
  const excludedIds = f.exclude_ids.split(",").map((v) => v.trim()).filter((v) => /^\d+$/.test(v));
  if (excludedIds.length > 0) {
    where.push(`n.id NOT IN (${excludedIds.map(() => "?").join(",")})`);
    params.push(...excludedIds.map(Number));
  }
  if (f.query.trim()) {
    const needle = `%${f.query.trim().slice(0, 48)}%`;
    where.push("(n.title LIKE ? OR n.author LIKE ? OR n.associated_names LIKE ?)");
    params.push(needle, needle, needle);
  }
  if (f.language) { where.push("LOWER(n.language) = LOWER(?)"); params.push(f.language); }
  const { clause, params: mp } = mediaTypeSqlFilter(f.media_type, "COALESCE(n.media_type, 'novel')");
  if (clause) { where.push(clause); params.push(...mp); }
  if (f.source && f.source !== "all") {
    where.push("COALESCE(n.source, 'novelupdates') = LOWER(?)");
    params.push(f.source);
  }
  if (f.author) { where.push("LOWER(n.author) = LOWER(?)"); params.push(f.author); }
  if (f.genre) {
    joins.push("JOIN novel_genres bg ON bg.novel_id=n.id JOIN genres g ON g.id=bg.genre_id");
    where.push("LOWER(g.name) = LOWER(?)");
    params.push(f.genre);
  }
  if (f.tag) {
    joins.push("JOIN novel_tags bt ON bt.novel_id=n.id JOIN tags t ON t.id=bt.tag_id");
    where.push("LOWER(t.name) = LOWER(?)");
    params.push(f.tag);
  }
  const facets: Array<[string, string, boolean]> = [
    ["genre", f.include_genres, false], ["genre", f.exclude_genres, true],
    ["tag", f.exclude_tags, true],
  ];
  for (const [facet, values, excluded] of facets) {
    const names = values.split(",").map((v) => v.trim()).filter(Boolean);
    for (const name of names) {
      const [table, link, foreign] = facet === "genre"
        ? ["genres", "novel_genres", "genre_id"]
        : ["tags", "novel_tags", "tag_id"];
      where.push(
        `${excluded ? "NOT " : ""}EXISTS (SELECT 1 FROM ${link} bf JOIN ${table} bv ON bv.id=bf.${foreign} ` +
        "WHERE bf.novel_id=n.id AND LOWER(bv.name)=LOWER(?))",
      );
      params.push(name);
    }
  }
  // include_tags: "every" (default) requires each tag; "any" requires at least one
  const includeTagNames = f.include_tags.split(",").map((v) => v.trim()).filter(Boolean);
  if (includeTagNames.length) {
    if (f.tag_match === "any" && includeTagNames.length > 1) {
      const placeholders = includeTagNames.map(() => "LOWER(?)").join(",");
      where.push(
        `EXISTS (SELECT 1 FROM novel_tags bf JOIN tags bv ON bv.id=bf.tag_id ` +
        `WHERE bf.novel_id=n.id AND LOWER(bv.name) IN (${placeholders}))`,
      );
      params.push(...includeTagNames);
    } else {
      for (const name of includeTagNames) {
        where.push(
          "EXISTS (SELECT 1 FROM novel_tags bf JOIN tags bv ON bv.id=bf.tag_id " +
          "WHERE bf.novel_id=n.id AND LOWER(bv.name)=LOWER(?))",
        );
        params.push(name);
      }
    }
  }
  return { joins, where, params };
}

async function runBrowse(db: D1Database, f: BrowseFilters, page: number, pageSize: number) {
  const { joins, where, params } = browseWhere(f);
  const primary: Record<string, string> = {
    popular: "n.reading_list_count",
    rating: "n.rating",
    votes: "n.rating_votes",
    title: "n.title COLLATE NOCASE",
    newest: "COALESCE(n.year, 0)",
  };
  const dir = f.direction.toUpperCase();
  let order = `${primary[f.sort]} ${dir}`;
  if (f.sort !== "title") order += `, n.rating_votes ${dir}`;
  const fromSql = `FROM novels n ${joins.join(" ")} WHERE ${where.join(" AND ")}`;
  const totalRow = await db
    .prepare(`SELECT COUNT(DISTINCT n.id) AS t ${fromSql}`)
    .bind(...params)
    .first<{ t: number }>();
  const total = totalRow?.t ?? 0;
  const rows = await db
    .prepare(
      `SELECT DISTINCT n.id, n.title, n.slug, n.author, n.cover_url,
              n.rating, n.rating_votes, n.reading_list_count,
              n.language, n.year, n.status_trans, n.chapters_trans,
              COALESCE(n.media_type, 'novel') AS media_type,
              COALESCE(n.source, 'novelupdates') AS source,
              n.external_id, n.external_url
       ${fromSql}
       ORDER BY ${order}, n.id ASC
       LIMIT ? OFFSET ?`,
    )
    .bind(...params, pageSize, (page - 1) * pageSize)
    .all();
  const items = (rows.results ?? []) as any[];
  const ids = items.map((r) => r.id);
  const genreMap = new Map<number, string[]>();
  for (const id of ids) genreMap.set(id, []);
  if (ids.length > 0) {
    const placeholders = ids.map(() => "?").join(",");
    const grows = await db
      .prepare(
        `SELECT ng.novel_id AS nid, g.name AS name FROM novel_genres ng
         JOIN genres g ON g.id=ng.genre_id
         WHERE ng.novel_id IN (${placeholders}) ORDER BY g.name`,
      )
      .bind(...ids)
      .all<{ nid: number; name: string }>();
    for (const r of grows.results ?? []) genreMap.get(r.nid)?.push(r.name);
  }
  return {
    items: items.map((row) => ({
      id: row.id,
      title: row.title,
      slug: row.slug ?? "",
      novelupdates_url: externalUrlFor(row),
      external_url: externalUrlFor(row),
      author: row.author ?? "",
      cover_url: row.cover_url,
      rating: row.rating ?? 0,
      rating_votes: row.rating_votes ?? 0,
      reading_list_count: row.reading_list_count ?? 0,
      language: row.language ?? "",
      year: row.year,
      status_trans: row.status_trans ?? "",
      chapters_trans: row.chapters_trans ?? 0,
      genres: genreMap.get(row.id) ?? [],
      media_type: inferMediaType(row),
      source: inferSource(row),
      external_id: row.external_id ?? String(row.id),
    })),
    page,
    page_size: pageSize,
    total,
    has_more: page * pageSize < total,
    capabilities: { genres: true, tags: true, total_is_exact: true },
  };
}

app.get("/api/browse", async (c) => {
  const f = browseFiltersFromQuery(c);
  const page = Math.max(1, Number(c.req.query("page") ?? 1) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(c.req.query("page_size") ?? 24) || 24));
  return c.json(await runBrowse(c.env.DB, f, page, pageSize));
});

app.get("/api/browse/random", async (c) => {
  const f = browseFiltersFromQuery(c);
  const first = await runBrowse(c.env.DB, f, 1, 1);
  if (first.total === 0)
    return c.json({ detail: "No novels match the active filters." }, 404);
  const seedParam = c.req.query("seed");
  let offset: number;
  if (seedParam !== undefined && seedParam !== "") {
    // Deterministic PRNG (mulberry32) for seeded picks.
    let s = Number(seedParam) >>> 0;
    const rand = () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    offset = Math.floor(rand() * first.total);
  } else {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    offset = buf[0] % first.total;
  }
  const selected = await runBrowse(c.env.DB, f, offset + 1, 1);
  return c.json({ novel: selected.items[0], eligible_count: first.total });
});

// ---------------------------------------------------------------------------
// novel detail
// ---------------------------------------------------------------------------

app.get("/api/novels/:id", async (c) => {
  const novelId = Number(c.req.param("id"));
  if (!Number.isInteger(novelId)) return c.json({ detail: "Invalid id." }, 400);
  const db = c.env.DB;
  const row = await db
    .prepare(
      `SELECT id, title, slug, associated_names, author, language, synopsis,
              rating, rating_votes, rating_votes_5, rating_votes_4, rating_votes_3,
              rating_votes_2, rating_votes_1, reading_list_count, chapters_orig,
              chapters_trans, status_trans, year, cover_url,
              COALESCE(media_type, 'novel') AS media_type,
              COALESCE(source, 'novelupdates') AS source,
              external_id, external_url
       FROM novels WHERE id = ?`,
    )
    .bind(novelId)
    .first<any>();
  if (!row) return c.json({ detail: `Item ${novelId} not found.` }, 404);

  const [genreRows, tagRows, counts] = await Promise.all([
    db.prepare(
      `SELECT g.name AS name FROM genres g JOIN novel_genres ng ON ng.genre_id = g.id
       WHERE ng.novel_id = ? ORDER BY g.name`,
    ).bind(novelId).all<{ name: string }>(),
    db.prepare(
      `SELECT t.name AS name FROM tags t JOIN novel_tags nt ON nt.tag_id = t.id
       WHERE nt.novel_id = ? ORDER BY t.name`,
    ).bind(novelId).all<{ name: string }>(),
    db.prepare(
      `SELECT
         (SELECT COUNT(*) FROM direct_recs WHERE source_novel_id = ? OR target_novel_id = ?) AS direct_recs,
         (SELECT COUNT(*) FROM related_series WHERE source_novel_id = ? OR target_novel_id = ?) AS related,
         (SELECT COUNT(*) FROM rec_list_items WHERE novel_id = ?) AS lists`,
    ).bind(novelId, novelId, novelId, novelId, novelId).first<any>(),
  ]);

  const extUrl = externalUrlFor(row);
  return c.json({
    id: row.id,
    title: row.title,
    slug: row.slug,
    associated_names: parseAssociatedNames(row.associated_names),
    author: row.author,
    language: row.language,
    synopsis: row.synopsis,
    rating: row.rating,
    rating_votes: row.rating_votes,
    rating_votes_5: row.rating_votes_5,
    rating_votes_4: row.rating_votes_4,
    rating_votes_3: row.rating_votes_3,
    rating_votes_2: row.rating_votes_2,
    rating_votes_1: row.rating_votes_1,
    rating_dist: {
      "5": row.rating_votes_5, "4": row.rating_votes_4, "3": row.rating_votes_3,
      "2": row.rating_votes_2, "1": row.rating_votes_1,
    },
    reading_list_count: row.reading_list_count,
    chapters_orig: row.chapters_orig,
    chapters_trans: row.chapters_trans,
    status_trans: row.status_trans,
    year: row.year,
    cover_url: row.cover_url,
    genres: (genreRows.results ?? []).map((r) => r.name),
    tags: (tagRows.results ?? []).map((r) => r.name),
    novelupdates_url: extUrl,
    external_url: extUrl,
    media_type: inferMediaType(row),
    source: inferSource(row),
    external_id: row.external_id ?? String(row.id),
    direct_recommendation_count: counts?.direct_recs ?? 0,
    related_series_count: counts?.related ?? 0,
    recommendation_list_count: counts?.lists ?? 0,
  });
});

// ---------------------------------------------------------------------------
// novel insights
// ---------------------------------------------------------------------------

app.get("/api/novels/:id/insights", async (c) => {
  const novelId = Number(c.req.param("id"));
  if (!Number.isInteger(novelId)) return c.json({ detail: "Invalid id." }, 400);
  const db = c.env.DB;
  const novel = await db
    .prepare(
      `SELECT id, rating, rating_votes, reading_list_count, language, year
       FROM novels WHERE id = ?`,
    )
    .bind(novelId)
    .first<any>();
  if (!novel) return c.json({ detail: `Novel ${novelId} not found.` }, 404);

  const totalRow = await db.prepare("SELECT COUNT(*) AS t FROM novels").first<{ t: number }>();
  const total = totalRow?.t ?? 0;

  const metrics: any[] = [];
  for (const [key, column] of [
    ["rating", "rating"],
    ["rating_votes", "rating_votes"],
    ["readers", "reading_list_count"],
  ] as const) {
    const value = novel[column] ?? 0;
    const [below, above] = await Promise.all([
      db.prepare(`SELECT COUNT(*) AS t FROM novels WHERE COALESCE(${column}, 0) <= ?`)
        .bind(value).first<{ t: number }>(),
      db.prepare(`SELECT COUNT(*) AS t FROM novels WHERE COALESCE(${column}, 0) > ?`)
        .bind(value).first<{ t: number }>(),
    ]);
    metrics.push({
      key, value,
      percentile: total ? Math.round((100 * (below?.t ?? 0)) / total * 10) / 10 : 0,
      rank: (above?.t ?? 0) + 1,
      population: total,
    });
  }

  const genreRow = await db
    .prepare(
      `SELECT MIN(g.name) AS g FROM novel_genres ng
       JOIN genres g ON g.id=ng.genre_id WHERE ng.novel_id=?`,
    )
    .bind(novelId)
    .first<{ g: string }>();
  const primaryGenre = genreRow?.g ?? null;

  const cohorts: any[] = [];
  const cohortSpecs: Array<[string, string | null, string]> = [
    ["primary_genre", primaryGenre,
      "EXISTS (SELECT 1 FROM novel_genres x JOIN genres gx ON gx.id=x.genre_id WHERE x.novel_id=n.id AND gx.name=?)"],
    ["language", novel.language, "n.language = ?"],
    ["year", novel.year ? String(novel.year) : null, "n.year = ?"],
  ];
  for (const [dimension, value, clause] of cohortSpecs) {
    if (!value) continue;
    const parameter = dimension === "year" ? novel.year : value;
    const [pop, above] = await Promise.all([
      db.prepare(`SELECT COUNT(*) AS t FROM novels n WHERE ${clause}`)
        .bind(parameter).first<{ t: number }>(),
      db.prepare(
        `SELECT COUNT(*) AS t FROM novels n WHERE ${clause} AND COALESCE(n.reading_list_count,0) > ?`,
      ).bind(parameter, novel.reading_list_count ?? 0).first<{ t: number }>(),
    ]);
    cohorts.push({
      dimension, value: String(value),
      population: pop?.t ?? 0,
      readership_rank: (above?.t ?? 0) + 1,
    });
  }

  const peers: any[] = [];
  if (primaryGenre) {
    const peerRows = await db
      .prepare(
        `SELECT n.id, n.title, n.slug, n.author, n.cover_url, n.rating,
                n.rating_votes, n.reading_list_count, n.language, n.year,
                (SELECT COUNT(*) FROM novel_genres a
                 JOIN novel_genres b ON b.genre_id=a.genre_id
                 WHERE a.novel_id=? AND b.novel_id=n.id) AS shared_genres,
                (SELECT COUNT(*) FROM novel_tags a
                 JOIN novel_tags b ON b.tag_id=a.tag_id
                 WHERE a.novel_id=? AND b.novel_id=n.id) AS shared_tags
         FROM novels n
         WHERE n.id != ? AND n.language = ?
           AND EXISTS (
             SELECT 1 FROM novel_genres ng JOIN genres g ON g.id=ng.genre_id
             WHERE ng.novel_id=n.id AND g.name=?
           )
         ORDER BY shared_tags DESC, shared_genres DESC,
                  n.reading_list_count DESC, n.id
         LIMIT 10`,
      )
      .bind(novelId, novelId, novelId, novel.language, primaryGenre)
      .all<any>();
    for (const r of peerRows.results ?? []) {
      peers.push({
        id: r.id, title: r.title, slug: r.slug ?? "",
        novelupdates_url: novelupdatesUrl(r.id, r.slug),
        author: r.author ?? "", cover_url: r.cover_url,
        rating: r.rating ?? 0, rating_votes: r.rating_votes ?? 0,
        reading_list_count: r.reading_list_count ?? 0,
        language: r.language ?? "", year: r.year,
        shared_genre_count: r.shared_genres,
        shared_tag_count: r.shared_tags,
      });
    }
  }

  return c.json({
    novel_id: novelId,
    catalog_size: total,
    metrics,
    cohorts,
    peers,
    cohort_definition:
      "Peers share the alphabetically first catalog genre and exact language; " +
      "they are ordered by shared tags, shared genres, then readers.",
    capabilities: { relationships: false, tags: true },
  });
});

// ---------------------------------------------------------------------------
// options
// ---------------------------------------------------------------------------

app.get("/api/genre-counts", async (c) => {
  const db = c.env.DB;
  const rows = await db.prepare(
    `SELECT g.name AS genre, COUNT(DISTINCT ng.novel_id) AS count FROM genres g
     JOIN novel_genres ng ON ng.genre_id = g.id
     GROUP BY g.id ORDER BY count DESC`,
  ).all<{ genre: string; count: number }>();
  return c.json({ genres: rows.results ?? [] });
});

app.get("/api/options", async (c) => {
  const db = c.env.DB;
  const [genreRows, tagRows, langRows, mediaRows, sourceRows] = await Promise.all([
    db.prepare("SELECT name FROM genres ORDER BY name").all<{ name: string }>(),
    db.prepare(
      `SELECT t.name AS name FROM tags t JOIN novel_tags nt ON nt.tag_id = t.id
       GROUP BY t.id ORDER BY COUNT(*) DESC, t.name LIMIT 100`,
    ).all<{ name: string }>(),
    db.prepare(
      `SELECT language AS name FROM novels WHERE language != ''
       GROUP BY language ORDER BY COUNT(*) DESC`,
    ).all<{ name: string }>(),
    db.prepare(
      `SELECT COALESCE(media_type, 'novel') AS name FROM novels
       GROUP BY COALESCE(media_type, 'novel') ORDER BY COUNT(*) DESC`,
    ).all<{ name: string }>(),
    db.prepare(
      `SELECT COALESCE(source, 'novelupdates') AS name FROM novels
       GROUP BY COALESCE(source, 'novelupdates') ORDER BY COUNT(*) DESC`,
    ).all<{ name: string }>(),
  ]);
  const names = (r: any) => (r.results ?? []).map((x: any) => x.name);
  return c.json({
    genres: names(genreRows),
    popular_tags: names(tagRows),
    languages: names(langRows),
    media_types: names(mediaRows),
    sources: names(sourceRows),
  });
});

// ---------------------------------------------------------------------------
// recommend
// ---------------------------------------------------------------------------

async function runRecommend(db: D1Database, body: any) {
  const query = String(body.query ?? "").trim();
  const limit = Math.min(100, Math.max(1, Number(body.limit ?? 20) || 20));

  let seedRow: any;
  if (/^\d+$/.test(query)) {
    seedRow = await db
      .prepare("SELECT id, title, slug, cover_url FROM novels WHERE id = ?")
      .bind(Number(query))
      .first();
  } else {
    seedRow = await db
      .prepare(
        `SELECT id, title, slug, cover_url FROM novels
         WHERE title LIKE ? OR slug LIKE ?
         ORDER BY reading_list_count DESC LIMIT 1`,
      )
      .bind(`%${query.slice(0, 48)}%`, `%${query.slice(0, 48)}%`)
      .first();
  }
  if (!seedRow) return { error: `Novel matching '${query}' not found.`, status: 404 };

  const seedId = seedRow.id as number;
  const channels = await getCandidateChannels(db, seedId, 150);
  const preferences = recommendPreferences(body, [seedId]);

  const allIds = new Set<number>();
  for (const cands of Object.values(channels)) for (const [nid] of cands) allIds.add(nid);
  const validIds = new Set(await filterCandidates(db, [...allIds], preferences));
  const filtered: ChannelCandidates = {};
  for (const [name, cands] of Object.entries(channels))
    filtered[name] = cands.filter(([nid]) => validIds.has(nid));

  const channelWeights = clampChannelWeights(body.channel_weights);
  const rrfScores = calculateRrfScores(filtered, 60, Object.keys(channelWeights).length ? channelWeights : undefined);
  const effectiveWeights = Object.keys(channelWeights).length ? channelWeights : DEFAULT_CHANNEL_WEIGHTS;
  const activeChannels = Object.entries(filtered)
    .filter(([, cands]) => cands.length > 0)
    .map(([name]) => name);

  const hiddenGem = body.hidden_gem_mode ?? false;
  const gamma = Math.max(0, Math.min(1, Number(body.hidden_gem_strength ?? 0.3)));
  const finalScores = new Map<number, number>();
  let rlCounts = new Map<number, number>();
  if (hiddenGem && rrfScores.size > 0) {
    const nids = [...rrfScores.keys()];
    for (let i = 0; i < nids.length; i += 100) {
      const chunk = nids.slice(i, i + 100);
      const rows = await db
        .prepare(`SELECT id, reading_list_count FROM novels WHERE id IN (${chunk.map(() => "?").join(",")})`)
        .bind(...chunk)
        .all<{ id: number; reading_list_count: number }>();
      for (const r of rows.results ?? []) rlCounts.set(r.id, r.reading_list_count ?? 0);
    }
  }
  for (const [nid, score] of rrfScores) {
    finalScores.set(nid, hiddenGem ? applyHiddenGemBoost(score, rlCounts.get(nid) ?? 0, 10000, gamma) : score);
  }

  const sorted = [...finalScores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);

  const recommendations: any[] = [];
  for (const [nid, score] of sorted) {
    const chRanks: Record<string, number> = {};
    for (const [chName, cands] of Object.entries(channels)) {
      const idx = cands.findIndex(([candId]) => candId === nid);
      if (idx >= 0) chRanks[chName] = idx + 1;
    }
    const exp = await explainRecommendation(db, seedId, nid, score, chRanks);
    if (!exp) continue;
    exp.match_score_percent = calculateMatchPercent(
      rrfScores.get(nid) ?? 0,
      activeChannels,
      effectiveWeights,
    );
    recommendations.push(exp);
  }

  return {
    seed_novel: {
      id: seedId,
      title: seedRow.title,
      slug: seedRow.slug,
      novelupdates_url: novelupdatesUrl(seedId, seedRow.slug),
      cover_url: seedRow.cover_url,
    },
    count: recommendations.length,
    recommendations,
  };
}

app.post("/api/recommend", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const result = await runRecommend(c.env.DB, body);
  if ((result as any).error) return c.json({ detail: (result as any).error }, (result as any).status ?? 400);
  return c.json(result);
});

// ---------------------------------------------------------------------------
// recommend for-you (multi-seed)
// ---------------------------------------------------------------------------

app.post("/api/recommend/for-you", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const db = c.env.DB;
  const seeds = ((body.seeds ?? []) as any[]).slice(0, 20);
  const limit = Math.min(100, Math.max(1, Number(body.limit ?? 40) || 40));
  if (seeds.length === 0)
    return c.json({ detail: "For You requires at least one seed id." }, 400);

  const preferences = recommendPreferences(
    body,
    seeds.map((s) => Number(s.id)).filter(Number.isInteger),
  );
  const channelWeights = clampChannelWeights(body.channel_weights);
  const effectiveWeights = Object.keys(channelWeights).length ? channelWeights : DEFAULT_CHANNEL_WEIGHTS;
  const liked: Record<string, number> = {};
  for (const t of body.liked_tags ?? []) if (t.name) liked[String(t.name).toLowerCase()] = Number(t.weight ?? 1);
  const avoided: Record<string, number> = {};
  for (const t of body.avoid_tags ?? []) if (t.name) avoided[String(t.name).toLowerCase()] = Number(t.weight ?? 1);

  const seedsUsed: any[] = [];
  const seedsMissing: number[] = [];
  const scores = new Map<number, number>();
  const seedHits = new Map<number, any[]>();
  const bestSeedFor = new Map<number, [number, number]>();
  const channelRanksBySeed = new Map<number, ChannelCandidates>();

  for (const seed of seeds) {
    const seedId = Number(seed.id);
    if (!Number.isInteger(seedId)) { seedsMissing.push(seedId); continue; }
    const row = await db
      .prepare("SELECT id, title, slug, cover_url FROM novels WHERE id = ?")
      .bind(seedId)
      .first<any>();
    if (!row) { seedsMissing.push(seedId); continue; }
    const weight = Math.max(0.1, Math.min(10, Number(seed.weight ?? 1) || 1));
    const title = seed.title || row.title;
    seedsUsed.push({ id: seedId, title, weight });

    const channels = await getCandidateChannels(db, seedId, 150);
    const allIds = new Set<number>();
    for (const cands of Object.values(channels)) for (const [nid] of cands) allIds.add(nid);
    const valid = new Set(await filterCandidates(db, [...allIds], preferences));
    const filtered: ChannelCandidates = {};
    for (const [name, cands] of Object.entries(channels))
      filtered[name] = cands.filter(([nid]) => valid.has(nid));
    channelRanksBySeed.set(seedId, filtered);

    const rrf = calculateRrfScores(
      filtered, 60,
      Object.keys(channelWeights).length ? channelWeights : undefined,
    );
    for (const [nid, score] of rrf) {
      if (nid === seedId) continue;
      const contribution = score * weight;
      scores.set(nid, (scores.get(nid) ?? 0) + contribution);
      if (!seedHits.has(nid)) seedHits.set(nid, []);
      seedHits.get(nid)!.push({ id: seedId, title, weight, contribution });
      const prev = bestSeedFor.get(nid);
      if (!prev || contribution > prev[1]) bestSeedFor.set(nid, [seedId, contribution]);
    }
  }

  if (seedsUsed.length === 0)
    return c.json({ detail: "None of the For You seeds exist in this catalog." }, 404);

  const ranked = [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);

  const hiddenGem = body.hidden_gem_mode ?? false;
  const gamma = Math.max(0, Math.min(1, Number(body.hidden_gem_strength ?? 0.3)));
  const recommendations: any[] = [];
  for (const [nid, baseScore] of ranked) {
    const [primarySeed] = bestSeedFor.get(nid) ?? [seedsUsed[0].id, 0];
    const chRanks: Record<string, number> = {};
    const seedChannels = channelRanksBySeed.get(primarySeed) ?? {};
    for (const [chName, cands] of Object.entries(seedChannels)) {
      const idx = cands.findIndex(([candId]) => candId === nid);
      if (idx >= 0) chRanks[chName] = idx + 1;
    }
    const exp = await explainRecommendation(db, primarySeed, nid, baseScore, chRanks);
    if (!exp) continue;
    const { mult, hitLike, hitAvoid } = affinityMultiplier(exp.shared_tags ?? [], liked, avoided);
    let score = baseScore * mult;
    if (hiddenGem) score = applyHiddenGemBoost(score, exp.reading_list_count ?? 0, 10000, gamma);
    exp.rrf_score = score;
    const bullets = [...(exp.evidence_bullets ?? [])];
    const hits = seedHits.get(nid) ?? [];
    if (hits.length > 1) {
      const titles = hits.sort((a, b) => b.contribution - a.contribution).slice(0, 3).map((h) => h.title).join(", ");
      bullets.unshift(`Appeared under ${hits.length} of your seeds (e.g. ${titles})`);
    } else if (hits.length === 1) {
      bullets.unshift(`From your seed: ${hits[0].title}`);
    }
    if (mult !== 1.0) {
      if (hitLike.length) bullets.splice(1, 0, `Taste boost ×${mult.toFixed(2)} via liked tropes: ${hitLike.join(", ")}`);
      if (hitAvoid.length) bullets.splice(1, 0, `Taste penalty ×${mult.toFixed(2)} via avoided tropes: ${hitAvoid.join(", ")}`);
    }
    exp.evidence_bullets = bullets.slice(0, 7);
    const unboosted = baseScore * mult;
    (exp as any)._sort = score;
    (exp as any)._unboosted = unboosted;
    recommendations.push(exp);
  }

  recommendations.sort((a, b) => (b._sort ?? 0) - (a._sort ?? 0));
  const trimmed = recommendations.slice(0, limit);
  const activeChannels = Object.keys(effectiveWeights);
  for (const exp of trimmed) {
    exp.match_score_percent = calculateMatchPercent(
      (exp as any)._unboosted ?? exp.rrf_score ?? 0,
      activeChannels,
      effectiveWeights,
    );
    delete (exp as any)._sort;
    delete (exp as any)._unboosted;
  }

  return c.json({
    seed_novel: {
      id: 0, title: "For You (multi-seed)", slug: "for-you",
      novelupdates_url: "", cover_url: null,
    },
    count: trimmed.length,
    recommendations: trimmed,
    seeds_used: seedsUsed,
    seeds_missing: seedsMissing,
    primary_seed_id: seedsUsed[0].id,
    mode: "api-multi-seed",
  });
});

export default app;
