/**
 * Static-hosting backend for the For You page (GitHub Pages / Cloudflare Pages).
 * List rows come from files precomputed by scripts/build_for_you_static.py; library rows
 * merge the per-title static recommendation pools in the browser.
 */
import { createDataSource } from './data';
import type { LibrarySeed } from './forYouLibrary';
import type { ProfileEntry } from './profile/types';
import type { ListSummary, RowData, RowRec } from './ForYouPage';

const BASE = `${import.meta.env.BASE_URL}for-you-data`;
const RRF_K = 60;
const LIBRARY_SEEDS = 8; // each seed is one pool fetch, so cap how many a row blends

export interface ListFile {
  id: number;
  title: string;
  seeds: Array<{ id: number; title: string }>;
  members: number[];
  recs: Array<[number, number, string[]]>;
}

const listFiles = new Map<number, Promise<ListFile>>();
export function loadListFile(id: number): Promise<ListFile> {
  let pending = listFiles.get(id);
  if (!pending) {
    pending = fetch(`${BASE}/list-${id}.json`).then((r) => {
      if (!r.ok) throw new Error(`List ${id} isn't in this snapshot`);
      return r.json();
    });
    pending.catch(() => listFiles.delete(id));
    listFiles.set(id, pending);
  }
  return pending;
}

export async function isStaticSource(): Promise<boolean> {
  try {
    return (await createDataSource()).mode === 'static';
  } catch {
    return true;
  }
}

export async function staticLists(): Promise<ListSummary[]> {
  const r = await fetch(`${BASE}/lists.json`);
  if (!r.ok) throw new Error(`Server returned ${r.status}`);
  return (await r.json()).lists;
}

async function cardsFor(ids: number[]) {
  return (await createDataSource()).resolveNovelIds(ids);
}

export async function staticListRow(
  listIds: number[],
  blend: boolean,
  hideKnown: boolean,
  excludeIds: number[],
  listTitles: Record<number, string>,
  limit: number,
  expectedSizes?: Map<number, number>,
): Promise<RowData> {
  const files = await Promise.all(listIds.map(loadListFile));
  // Against a live DB the snapshot can lag behind imports; a size mismatch means "recompute it".
  for (const f of files) {
    const expected = expectedSizes?.get(f.id);
    if (expected != null && expected !== f.members.length) throw new Error(`Snapshot for list ${f.id} is out of date`);
  }
  const names = new Map(files.map((f) => [f.id, listTitles[f.id] ?? f.title]));
  const onLists = new Map<number, string[]>();
  for (const f of files) for (const m of f.members) onLists.set(m, [...(onLists.get(m) ?? []), names.get(f.id)!]);

  const exclude = new Set(excludeIds);
  if (hideKnown) for (const id of onLists.keys()) exclude.add(id);
  const scores = new Map<number, { score: number; percent: number; tags: string[] }>();
  const used = blend ? files : files.slice(0, 1);
  for (const f of used) {
    const own = new Set(f.members);
    let rank = 0;
    for (const [id, percent, tags] of f.recs) {
      if (exclude.has(id) || (!blend && own.has(id))) continue;
      rank += 1;
      const hit = scores.get(id) ?? { score: 0, percent, tags };
      hit.score += 1 / (RRF_K + rank);
      scores.set(id, hit);
    }
  }
  const ranked = [...scores].sort((a, b) => b[1].score - a[1].score).slice(0, limit);
  const cards = await cardsFor(ranked.map(([id]) => id));
  const top = ranked[0]?.[1].score || 1;
  const recommendations: RowRec[] = ranked.flatMap(([id, hit]) => {
    const card = cards.get(id);
    if (!card) return [];
    return [{
      target_id: id,
      title: card.title,
      cover_url: card.cover_url,
      media_type: card.media_type,
      source: card.source,
      rating: card.rating,
      rating_votes: card.rating_votes,
      status_trans: '',
      match_score_percent: Math.round((100 * hit.score) / top),
      evidence_bullets: [],
      shared_tags: hit.tags,
      on_lists: onLists.get(id) ?? [],
    }];
  });
  const first = used[0];
  return {
    title: blend ? 'Top picks for you' : `Because you love ${names.get(first.id)}`,
    subtitle: blend ? 'Blended from your favorite lists' : `Seeded by the top ${first.seeds.length} titles on this list`,
    seeds: used.flatMap((f) => f.seeds).slice(0, 20),
    recommendations,
  };
}

export async function staticLibraryRow(
  title: string,
  subtitle: string,
  seeds: LibrarySeed[],
  excludeIds: number[],
  limit: number,
): Promise<RowData> {
  const source = await createDataSource();
  const used = seeds.slice(0, LIBRARY_SEEDS);
  const exclude = new Set([...excludeIds, ...seeds.map((s) => s.id)]);
  const pools = await Promise.allSettled(used.map((s) => source.getRecommendations({ query: String(s.id), limit: 50 })));
  const merged = new Map<number, { score: number; rec: RowRec }>();
  pools.forEach((pool, i) => {
    if (pool.status !== 'fulfilled') return;
    let rank = 0;
    for (const rec of pool.value.recommendations) {
      if (exclude.has(rec.target_id)) continue;
      rank += 1;
      const hit = merged.get(rec.target_id) ?? { score: 0, rec: rec as RowRec };
      hit.score += used[i].weight / (RRF_K + rank);
      merged.set(rec.target_id, hit);
    }
  });
  const ranked = [...merged.values()].sort((a, b) => b.score - a.score).slice(0, limit);
  const top = ranked[0]?.score || 1;
  return {
    title,
    subtitle,
    seeds: used.map((s) => ({ id: s.id, title: s.title })),
    recommendations: ranked.map(({ score, rec }) => ({ ...rec, match_score_percent: Math.round((100 * score) / top) })),
  };
}

/**
 * How well each precomputed list matches a reader's library: titles on the list count most, titles
 * among its recommendations count by rank. Rating scales the pull; dropped and low-rated titles
 * and plan-to-read count for nothing. Returns list ids, best match first, omitting zero matches.
 */
export async function rankListsByLibrary(lists: ListSummary[], entries: ProfileEntry[]): Promise<number[]> {
  const weights = new Map<number, number>();
  for (const e of entries) {
    if (e.novel_id == null || e.status === 'plan_to_read' || e.status === 'dropped') continue;
    if (e.rating != null && e.rating <= 2.5) continue;
    weights.set(e.novel_id, Math.max(0.25, 1 + ((e.rating ?? 3.5) - 3) * 0.5));
  }
  if (!weights.size) return [];
  const files = await Promise.allSettled(lists.map((l) => loadListFile(l.id)));
  const scored: Array<[number, number]> = [];
  files.forEach((result, i) => {
    if (result.status !== 'fulfilled') return;
    const { members, recs } = result.value;
    let score = 0;
    for (const m of members) score += 3 * (weights.get(m) ?? 0);
    recs.forEach(([id], rank) => { score += (1 - rank / recs.length) * (weights.get(id) ?? 0); });
    if (score > 0) scored.push([lists[i].id, score]);
  });
  return scored.sort((a, b) => b[1] - a[1]).map(([id]) => id);
}

let snapshotListIds: Promise<Set<number>> | undefined;
/** Ids of the curated lists that have a page in this snapshot (so links can go to our list page). */
export function staticListIds(): Promise<Set<number>> {
  snapshotListIds ??= staticLists().then((lists) => new Set(lists.map((l) => l.id)), () => new Set<number>());
  return snapshotListIds;
}
