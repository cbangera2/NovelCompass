/**
 * Static-hosting backend for the For You page (GitHub Pages / Cloudflare Pages).
 * List rows come from files precomputed by scripts/build_for_you_static.py; library rows
 * merge the per-title static recommendation pools in the browser.
 */
import { createDataSource } from './data';
import type { LibrarySeed } from './forYouLibrary';
import type { ListSummary, RowData, RowRec } from './ForYouPage';

const BASE = `${import.meta.env.BASE_URL}for-you-data`;
const RRF_K = 60;
const LIBRARY_SEEDS = 8; // each seed is one pool fetch, so cap how many a row blends

interface ListFile {
  id: number;
  title: string;
  seeds: Array<{ id: number; title: string }>;
  members: number[];
  recs: Array<[number, number, string[]]>;
}

const listFiles = new Map<number, Promise<ListFile>>();
function loadListFile(id: number): Promise<ListFile> {
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
): Promise<RowData> {
  const files = await Promise.all(listIds.map(loadListFile));
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
