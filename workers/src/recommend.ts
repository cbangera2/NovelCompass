// Recommendation engine ported from src/engine/ (Python).
// Algorithm contract: SCHEMA_VERSION=1, ALGORITHM_VERSION=1, RRF_K=60.
// Keep these in sync with src/engine/ranking_contract.py.

export const SCHEMA_VERSION = 1;
export const ALGORITHM_VERSION = 1;
export const RRF_K = 60;

export const DEFAULT_CHANNEL_WEIGHTS: Record<string, number> = {
  vector: 1.0,
  tag: 0.8,
  direct_rec: 1.2,
  rec_list: 1.0,
  structural: 0.6,
};

const HIGH_PRIORITY_TAGS = new Set([
  "cunning protagonist", "time loop", "yandere", "female yandere",
  "misunderstandings", "obsessive love", "tragedy", "self-sacrifice",
  "regret", "dark", "no harem", "smart protagonist", "unwilling protagonist",
]);

export type ChannelCandidates = Record<string, Array<[number, number]>>;

// ---------------------------------------------------------------------------
// RRF + scoring helpers (src/engine/rrf_ranker.py)
// ---------------------------------------------------------------------------

export function calculateRrfScores(
  channelCandidates: ChannelCandidates,
  k = RRF_K,
  channelWeights?: Record<string, number>,
): Map<number, number> {
  const weights = channelWeights ?? DEFAULT_CHANNEL_WEIGHTS;
  const scores = new Map<number, number>();
  for (const [channelName, candidates] of Object.entries(channelCandidates)) {
    const w = weights[channelName] ?? 1.0;
    candidates.forEach(([novelId], idx) => {
      const rank = idx + 1;
      scores.set(novelId, (scores.get(novelId) ?? 0) + w / (k + rank));
    });
  }
  return scores;
}

export function applyHiddenGemBoost(
  rrfScore: number,
  readingListCount: number,
  maxCount = 10000,
  gamma = 0.3,
): number {
  const count = Math.max(0, readingListCount);
  const boost = 1.0 + gamma * Math.log10((maxCount + 10) / (count + 10));
  return rrfScore * boost;
}

export function calculateMatchPercent(
  score: number,
  activeChannels: string[],
  channelWeights: Record<string, number>,
  k = RRF_K,
): number {
  const theoreticalMax = activeChannels.reduce(
    (sum, ch) => sum + Math.max(0, channelWeights[ch] ?? 1.0) / (k + 1),
    0,
  );
  if (theoreticalMax <= 0) return 0;
  return Math.round(Math.max(0, Math.min(100, (score / theoreticalMax) * 100)));
}

// ---------------------------------------------------------------------------
// Candidate generation (src/engine/candidate_gen.py)
// ---------------------------------------------------------------------------

export async function calculateTagIdf(db: D1Database): Promise<Map<string, number>> {
  const totalRow = await db.prepare("SELECT COUNT(*) AS c FROM novels").first<{ c: number }>();
  const total = totalRow?.c || 1;
  const rows = await db
    .prepare(
      `SELECT t.name AS name, COUNT(nt.novel_id) AS freq
       FROM tags t LEFT JOIN novel_tags nt ON t.id = nt.tag_id
       GROUP BY t.id`,
    )
    .all<{ name: string; freq: number }>();
  const idf = new Map<string, number>();
  for (const row of rows.results ?? []) {
    const key = (row.name ?? "").toLowerCase();
    let base = Math.log((total + 1) / ((row.freq ?? 0) + 1)) + 1.0;
    if (HIGH_PRIORITY_TAGS.has(key)) base *= 1.5;
    idf.set(key, base);
  }
  return idf;
}

async function novelTagsMap(db: D1Database): Promise<Map<number, Set<string>>> {
  const rows = await db
    .prepare(
      `SELECT nt.novel_id AS nid, t.name AS name
       FROM novel_tags nt JOIN tags t ON t.id = nt.tag_id`,
    )
    .all<{ nid: number; name: string }>();
  const map = new Map<number, Set<string>>();
  for (const row of rows.results ?? []) {
    const key = (row.name ?? "").toLowerCase();
    if (!map.has(row.nid)) map.set(row.nid, new Set());
    map.get(row.nid)!.add(key);
  }
  return map;
}

async function vectorCandidates(
  db: D1Database,
  seedId: number,
  limit: number,
): Promise<Array<[number, number]>> {
  // Precomputed by the refresh pipeline (scripts/export_vector_neighbors.py).
  const rows = await db
    .prepare(
      `SELECT target_novel_id AS nid, score FROM vector_neighbors
       WHERE source_novel_id = ? ORDER BY rank ASC LIMIT ?`,
    )
    .bind(seedId, limit)
    .all<{ nid: number; score: number }>();
  return (rows.results ?? []).map((r) => [r.nid, r.score]);
}

async function tagCandidates(
  db: D1Database,
  seedId: number,
  limit: number,
  idf: Map<string, number>,
  tagsMap: Map<number, Set<string>>,
): Promise<Array<[number, number]>> {
  const seedTags = tagsMap.get(seedId);
  if (!seedTags || seedTags.size === 0) return [];
  const scored: Array<[number, number]> = [];
  for (const [nid, tags] of tagsMap) {
    if (nid === seedId) continue;
    let inter = 0;
    let union = 0;
    for (const t of tags) {
      const w = idf.get(t) ?? 1.0;
      if (seedTags.has(t)) inter += w;
      union += w;
    }
    // union must include seed-only tags too
    for (const t of seedTags) {
      if (!tags.has(t)) union += idf.get(t) ?? 1.0;
    }
    const sim = union > 0 ? inter / union : 0;
    if (sim > 0) scored.push([nid, sim]);
  }
  scored.sort((a, b) => b[1] - a[1]);
  return scored.slice(0, limit);
}

async function directRecCandidates(
  db: D1Database,
  seedId: number,
  limit: number,
): Promise<Array<[number, number]>> {
  const rows = await db
    .prepare(
      `SELECT target_novel_id AS nid, votes, is_mutual FROM direct_recs
       WHERE source_novel_id = ?
       UNION
       SELECT source_novel_id AS nid, votes, is_mutual FROM direct_recs
       WHERE target_novel_id = ?`,
    )
    .bind(seedId, seedId)
    .all<{ nid: number; votes: number; is_mutual: number }>();
  const scored = (rows.results ?? []).map((r) => {
    const voteFactor = 1.0 + Math.log(1.0 + Math.max(0, r.votes ?? 0));
    return [r.nid, (r.is_mutual ? 1.5 : 1.0) * voteFactor] as [number, number];
  });
  scored.sort((a, b) => b[1] - a[1]);
  return scored.slice(0, limit);
}

async function recListCandidates(
  db: D1Database,
  seedId: number,
  limit: number,
): Promise<Array<[number, number]>> {
  const rows = await db
    .prepare(
      `SELECT novel_id AS nid, COUNT(list_id) AS co
       FROM rec_list_items
       WHERE list_id IN (SELECT list_id FROM rec_list_items WHERE novel_id = ?)
         AND novel_id != ?
       GROUP BY novel_id ORDER BY co DESC LIMIT ?`,
    )
    .bind(seedId, seedId, limit)
    .all<{ nid: number; co: number }>();
  return (rows.results ?? []).map((r) => [r.nid, r.co]);
}

async function structuralCandidates(
  db: D1Database,
  seedId: number,
  limit: number,
): Promise<Array<[number, number]>> {
  const seed = await db
    .prepare("SELECT author FROM novels WHERE id = ?")
    .bind(seedId)
    .first<{ author: string }>();
  const scored: Array<[number, number]> = [];
  if (seed?.author) {
    const rows = await db
      .prepare("SELECT id AS nid FROM novels WHERE author = ? AND id != ?")
      .bind(seed.author, seedId)
      .all<{ nid: number }>();
    for (const r of rows.results ?? []) scored.push([r.nid, 2.0]);
  }
  const relRows = await db
    .prepare(
      `SELECT target_novel_id AS nid FROM related_series WHERE source_novel_id = ?
       UNION
       SELECT source_novel_id AS nid FROM related_series WHERE target_novel_id = ?`,
    )
    .bind(seedId, seedId)
    .all<{ nid: number }>();
  for (const r of relRows.results ?? []) scored.push([r.nid, 1.5]);
  return scored.slice(0, limit);
}

export let cachedTagIdf: Map<string, number> | null = null;
let cachedTagsMap: Map<number, Set<string>> | null = null;

async function getTagTables(db: D1Database) {
  if (!cachedTagIdf || !cachedTagsMap) {
    const [idf, tagsMap] = await Promise.all([calculateTagIdf(db), novelTagsMap(db)]);
    cachedTagIdf = idf;
    cachedTagsMap = tagsMap;
  }
  return { idf: cachedTagIdf, tagsMap: cachedTagsMap };
}

export async function getCandidateChannels(
  db: D1Database,
  seedId: number,
  limitPerChannel = 150,
): Promise<ChannelCandidates> {
  const { idf, tagsMap } = await getTagTables(db);
  const [vector, tag, directRec, recList, structural] = await Promise.all([
    vectorCandidates(db, seedId, limitPerChannel),
    tagCandidates(db, seedId, limitPerChannel, idf, tagsMap),
    directRecCandidates(db, seedId, limitPerChannel),
    recListCandidates(db, seedId, limitPerChannel),
    structuralCandidates(db, seedId, limitPerChannel),
  ]);
  return { vector, tag, direct_rec: directRec, rec_list: recList, structural };
}

// ---------------------------------------------------------------------------
// Hard filters (src/engine/filters.py)
// ---------------------------------------------------------------------------

export interface FilterPreferences {
  exclude_tags: string[];
  include_tags: string[];
  include_genres: string[];
  exclude_genres: string[];
  language: string;
  min_rating: number;
  min_rating_votes: number;
  max_readers: number;
  min_year: number;
  max_year: number;
  require_completed: boolean;
  min_chapters: number;
  media_type: string;
  source: string;
  exclude_novel_ids: number[];
}

interface NovelTraits {
  tags: Set<string>;
  genres: Set<string>;
  status_trans: string;
  chapters_trans: number;
  language: string;
  rating: number;
  rating_votes: number;
  reading_list_count: number;
  year: number;
  media_type: string;
  source: string;
}

async function getNovelFilterTraits(
  db: D1Database,
  novelId: number,
): Promise<NovelTraits> {
  const [tagRows, genreRows, novel] = await Promise.all([
    db
      .prepare(
        `SELECT LOWER(t.name) AS name FROM tags t
         JOIN novel_tags nt ON t.id = nt.tag_id WHERE nt.novel_id = ?`,
      )
      .bind(novelId)
      .all<{ name: string }>(),
    db
      .prepare(
        `SELECT LOWER(g.name) AS name FROM genres g
         JOIN novel_genres ng ON g.id = ng.genre_id WHERE ng.novel_id = ?`,
      )
      .bind(novelId)
      .all<{ name: string }>(),
    db
      .prepare(
        `SELECT status_trans, chapters_trans, language, rating, rating_votes,
                reading_list_count, year,
                COALESCE(media_type, 'novel') AS media_type,
                COALESCE(source, 'novelupdates') AS source
         FROM novels WHERE id = ?`,
      )
      .bind(novelId)
      .first<any>(),
  ]);
  return {
    tags: new Set((tagRows.results ?? []).map((r) => r.name)),
    genres: new Set((genreRows.results ?? []).map((r) => r.name)),
    status_trans: novel?.status_trans ?? "",
    chapters_trans: novel?.chapters_trans ?? 0,
    language: novel?.language ?? "",
    rating: novel?.rating ?? 0,
    rating_votes: novel?.rating_votes ?? 0,
    reading_list_count: novel?.reading_list_count ?? 0,
    year: novel?.year ?? 0,
    media_type: novel?.media_type ?? "novel",
    source: novel?.source ?? "novelupdates",
  };
}

function mediaTypeMatches(itemType: string, requested: string): boolean {
  if (requested === "manga")
    return ["manga", "manhwa", "manhua", "comic"].includes(itemType);
  if (requested === "novel")
    return ["novel", "light_novel", "web_novel"].includes(itemType);
  if (requested === "anime") return itemType === "anime";
  return itemType === requested;
}

export async function filterCandidates(
  db: D1Database,
  candidateIds: number[],
  prefs: FilterPreferences,
): Promise<number[]> {
  const excludeTags = new Set(prefs.exclude_tags.map((t) => t.toLowerCase()));
  const includeTags = new Set(prefs.include_tags.map((t) => t.toLowerCase()));
  const includeGenres = new Set(prefs.include_genres.map((g) => g.toLowerCase()));
  const excludeGenres = new Set(prefs.exclude_genres.map((g) => g.toLowerCase()));
  const requiredLanguage = (prefs.language ?? "").trim().toLowerCase();
  const targetTypes = new Set(
    (prefs.media_type ?? "")
      .split(",")
      .map((m) => m.trim().toLowerCase())
      .filter(Boolean),
  );
  const source = (prefs.source ?? "").trim().toLowerCase();
  const excludeIds = new Set(prefs.exclude_novel_ids ?? []);

  const traitMap = new Map<number, NovelTraits>();
  const toLoad = candidateIds.filter((nid) => !excludeIds.has(nid));
  for (let i = 0; i < toLoad.length; i += 100) {
    const chunk = toLoad.slice(i, i + 100);
    const ph = chunk.map(() => "?").join(",");
    const [tagRows, genreRows, novelRows] = await Promise.all([
      db.prepare(
        `SELECT nt.novel_id AS nid, LOWER(t.name) AS name FROM tags t
         JOIN novel_tags nt ON t.id = nt.tag_id WHERE nt.novel_id IN (${ph})`,
      ).bind(...chunk).all<{ nid: number; name: string }>(),
      db.prepare(
        `SELECT ng.novel_id AS nid, LOWER(g.name) AS name FROM genres g
         JOIN novel_genres ng ON g.id = ng.genre_id WHERE ng.novel_id IN (${ph})`,
      ).bind(...chunk).all<{ nid: number; name: string }>(),
      db.prepare(
        `SELECT id, status_trans, chapters_trans, language, rating, rating_votes,
                reading_list_count, year,
                COALESCE(media_type, 'novel') AS media_type,
                COALESCE(source, 'novelupdates') AS source
         FROM novels WHERE id IN (${ph})`,
      ).bind(...chunk).all<any>(),
    ]);
    const tagsById = new Map<number, Set<string>>();
    for (const r of tagRows.results ?? []) {
      if (!tagsById.has(r.nid)) tagsById.set(r.nid, new Set());
      tagsById.get(r.nid)!.add(r.name);
    }
    const genresById = new Map<number, Set<string>>();
    for (const r of genreRows.results ?? []) {
      if (!genresById.has(r.nid)) genresById.set(r.nid, new Set());
      genresById.get(r.nid)!.add(r.name);
    }
    for (const n of novelRows.results ?? []) {
      traitMap.set(n.id, {
        tags: tagsById.get(n.id) ?? new Set(),
        genres: genresById.get(n.id) ?? new Set(),
        status_trans: n.status_trans ?? "",
        chapters_trans: n.chapters_trans ?? 0,
        language: n.language ?? "",
        rating: n.rating ?? 0,
        rating_votes: n.rating_votes ?? 0,
        reading_list_count: n.reading_list_count ?? 0,
        year: n.year ?? 0,
        media_type: n.media_type ?? "novel",
        source: n.source ?? "novelupdates",
      });
    }
  }
  const emptyTraits: NovelTraits = {
    tags: new Set(), genres: new Set(), status_trans: "", chapters_trans: 0,
    language: "", rating: 0, rating_votes: 0, reading_list_count: 0,
    year: 0, media_type: "novel", source: "novelupdates",
  };

  const valid: number[] = [];
  for (const nid of candidateIds) {
    if (excludeIds.has(nid)) continue;
    const traits = traitMap.get(nid) ?? emptyTraits;
    const allTagsGenres = new Set([...traits.tags, ...traits.genres]);

    if (targetTypes.size > 0 && !targetTypes.has("all")) {
      let matched = false;
      for (const req of targetTypes) {
        if (mediaTypeMatches(traits.media_type, req)) {
          matched = true;
          break;
        }
      }
      if (!matched) continue;
    }
    if (source && source !== "all" && traits.source !== source) continue;
    if ([...excludeTags].some((t) => allTagsGenres.has(t))) continue;
    if (includeTags.size > 0 && ![...includeTags].every((t) => traits.tags.has(t)))
      continue;
    if (
      includeGenres.size > 0 &&
      ![...includeGenres].every((g) => traits.genres.has(g))
    )
      continue;
    if ([...excludeGenres].some((g) => traits.genres.has(g))) continue;
    if (requiredLanguage && traits.language.toLowerCase() !== requiredLanguage)
      continue;
    if (traits.rating < prefs.min_rating) continue;
    if (traits.rating_votes < prefs.min_rating_votes) continue;
    if (prefs.max_readers && traits.reading_list_count > prefs.max_readers)
      continue;
    if (prefs.min_year && traits.year < prefs.min_year) continue;
    if (prefs.max_year && traits.year > prefs.max_year) continue;
    if (
      prefs.require_completed &&
      !traits.status_trans.toLowerCase().includes("complete")
    )
      continue;
    if (traits.chapters_trans < prefs.min_chapters) continue;
    valid.push(nid);
  }
  return valid;
}

// ---------------------------------------------------------------------------
// Evidence explainer (src/engine/explainer.py)
// ---------------------------------------------------------------------------

export async function explainRecommendation(
  db: D1Database,
  seedId: number,
  targetId: number,
  rrfScore: number,
  channelRanks: Record<string, number>,
): Promise<Record<string, any> | null> {
  const target = await db
    .prepare(
      `SELECT title, rating, rating_votes, reading_list_count, status_trans,
              chapters_trans, author, cover_url, slug, language,
              COALESCE(media_type, 'novel') AS media_type,
              COALESCE(source, 'novelupdates') AS source,
              external_id, external_url
       FROM novels WHERE id = ?`,
    )
    .bind(targetId)
    .first<any>();
  if (!target) return null;

  const sharedRows = await db
    .prepare(
      `SELECT t.name AS name FROM tags t
       JOIN novel_tags nt1 ON t.id = nt1.tag_id AND nt1.novel_id = ?
       JOIN novel_tags nt2 ON t.id = nt2.tag_id AND nt2.novel_id = ?`,
    )
    .bind(seedId, targetId)
    .all<{ name: string }>();
  const sharedTags = (sharedRows.results ?? []).map((r) => r.name);

  const recRow = await db
    .prepare(
      `SELECT votes, is_mutual FROM direct_recs
       WHERE (source_novel_id = ? AND target_novel_id = ?)
          OR (source_novel_id = ? AND target_novel_id = ?)`,
    )
    .bind(seedId, targetId, targetId, seedId)
    .first<{ votes: number; is_mutual: number }>();

  const coRows = await db
    .prepare(
      `SELECT rl.id AS lid, rl.title AS title, rli.comment AS comment
       FROM rec_lists rl
       JOIN rec_list_items rli1 ON rl.id = rli1.list_id AND rli1.novel_id = ?
       JOIN rec_list_items rli2 ON rl.id = rli2.list_id AND rli2.novel_id = ?
       JOIN rec_list_items rli ON rl.id = rli.list_id AND rli.novel_id = ?`,
    )
    .bind(seedId, targetId, targetId)
    .all<{ lid: number; title: string; comment: string }>();
  const coLists = (coRows.results ?? []).map((r) => ({
    list_id: r.lid,
    title:
      !r.title || new RegExp(`^Novel Updates List\\s+${r.lid}$`, "i").test(r.title)
        ? null
        : r.title,
    comment: r.comment,
  }));

  const evidenceBullets: string[] = [];
  if ("vector" in channelRanks)
    evidenceBullets.push(`Premise similarity rank #${channelRanks["vector"]}`);
  if (sharedTags.length > 0)
    evidenceBullets.push(
      `Shared key tropes (${sharedTags.length}): ${sharedTags.slice(0, 5).join(", ")}`,
    );
  if (recRow) {
    const mutualStr = recRow.is_mutual ? "Mutual" : "One-way";
    evidenceBullets.push(
      `${mutualStr} human recommendation (${recRow.votes} votes)`,
    );
  }
  if (coLists.length > 0) {
    const named = coLists.find((c) => c.title);
    evidenceBullets.push(
      named
        ? `Co-occurs on ${coLists.length} curated list(s) including '${named.title}'`
        : `Co-occurs on ${coLists.length} curated list(s); list titles are unavailable in this snapshot`,
    );
    if (coLists[0].comment)
      evidenceBullets.push(`Curator comment: "${coLists[0].comment.slice(0, 120)}"`);
  }

  const targetUrl =
    target.external_url || `https://www.novelupdates.com/?p=${targetId}`;
  return {
    target_id: targetId,
    title: target.title,
    novelupdates_url: targetUrl,
    external_url: targetUrl,
    media_type: target.media_type,
    source: target.source,
    external_id: target.external_id,
    author: target.author,
    cover_url: target.cover_url,
    slug: target.slug,
    language: target.language,
    rating: target.rating,
    rating_votes: target.rating_votes,
    reading_list_count: target.reading_list_count,
    status_trans: target.status_trans,
    chapters_trans: target.chapters_trans,
    rrf_score: Math.round(rrfScore * 10000) / 10000,
    channel_ranks: channelRanks,
    shared_tags: sharedTags,
    curated_lists: coLists.map((c) => ({ id: c.list_id, title: c.title })),
    evidence_bullets: evidenceBullets,
  };
}

// ---------------------------------------------------------------------------
// Taste affinity (inlined from src/api/main.py::_affinity_multiplier)
// ---------------------------------------------------------------------------

export function affinityMultiplier(
  sharedTags: string[],
  liked: Record<string, number>,
  avoided: Record<string, number>,
): { mult: number; hitLike: string[]; hitAvoid: string[] } {
  let likeScore = 0;
  let avoidScore = 0;
  const hitLike: string[] = [];
  const hitAvoid: string[] = [];
  for (const tag of sharedTags ?? []) {
    const key = tag.toLowerCase();
    if (key in liked) {
      likeScore += liked[key];
      hitLike.push(tag);
    }
    if (key in avoided) {
      avoidScore += avoided[key];
      hitAvoid.push(tag);
    }
  }
  const raw = 1.0 + Math.min(0.35, likeScore * 0.012) - Math.min(0.4, avoidScore * 0.016);
  const mult = Math.max(0.55, Math.min(1.45, raw));
  return { mult, hitLike: hitLike.slice(0, 4), hitAvoid: hitAvoid.slice(0, 4) };
}
