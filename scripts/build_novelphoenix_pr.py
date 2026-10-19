"""Merge scraped Novel Phoenix novels into a novelcompass-data checkout, additively.

Reads data/novelphoenix/novels.json (src.scraper.novelphoenix) and edits the dataset in place:

  * catalog.json / facets.json / details/*.json: new rows for novels not already in the catalog
  * recommendation-index/*.json: a pool per new novel, and the new novels inserted into the
    pools of existing seeds where they would rank in the top tag-channel positions
  * manifest.json: counts and version

Existing rows are never modified. Existing pools only gain new ids (old tag ranks shift down
by the number of insertions ahead of them, exactly as a full rebuild would produce).

    .venv/bin/python scripts/build_novelphoenix_pr.py ~/Developer/novelcompass-data
"""
import argparse
import hashlib
import heapq
import html
import json
import math
import re
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import scipy.sparse as sp

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from build_static_export import CHANNELS, bucket_for_id, verify_export  # noqa: E402
from src.nlp.taxonomy import HIGH_PRIORITY_TAGS  # noqa: E402
from src.nlp.tag_inference import TagInferrer, embed_texts, load_corpus  # noqa: E402

POOL_LIMIT = 50
TAG_CAP = 500
MIN_REAL_TAGS = 5
INFERRED_TOTAL = 12
SHRINK_M = 25  # pseudo-votes pulling a title's rating toward the catalog mean
# Author strings on the site that name a site/placeholder rather than a person.
JUNK_AUTHORS = {"novelphoenix", "novelfire", "novelbin", "web novel", "no name", "latest release：", "latest release:", "unknown"}


def dump(path: Path, value) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")


def norm(text: str) -> str:
    return re.sub(r"[^a-z0-9]", "", html.unescape(text or "").lower())


def toks(text: str) -> set:
    return {t for t in re.split(r"[^a-z0-9]+", (text or "").lower()) if len(t) > 2}


class Dataset:
    def __init__(self, root: Path):
        self.root = root
        self.manifest = json.loads((root / "manifest.json").read_text())
        self.catalog = json.loads((root / "catalog.json").read_text())
        self.facets = json.loads((root / "facets.json").read_text())
        self.options = json.loads((root / "options.json").read_text())
        self.fields = {n: i for i, n in enumerate(self.catalog["fields"])}
        self.details = {f"{b:02x}": json.loads((root / "details" / f"{b:02x}.json").read_text()) for b in range(256)}
        self.recs = {f"{b:02x}": json.loads((root / "recommendation-index" / f"{b:02x}.json").read_text()) for b in range(256)}


def classify(ds: Dataset, records):
    """Split scraped records into (new, duplicates). Duplicate = same work already in the catalog."""
    f = ds.fields
    aliases = {i: a for i, a in ds.catalog["aliases"]}
    by_title, by_alias = defaultdict(list), defaultdict(list)
    for r in ds.catalog["rows"]:
        if r[f["media_type"]] not in ("novel", "light_novel"):
            continue  # same-titled manga/manhwa/anime are other adaptations, not the novel itself
        by_title[norm(r[f["title"]])].append(r)
        for a in aliases.get(r[0], []):
            by_alias[norm(a)].append(r)
    new, dups, kept_alias = [], [], []
    for rec in records:
        key = norm(rec["title"])
        hit = by_title.get(key)
        if not hit and by_alias.get(key):
            # An alias match alone is weak evidence (spin-offs share names); require an author overlap.
            hit = [r for r in by_alias[key] if toks(r[f["author"]]) & toks(rec["author"])]
            if not hit:
                kept_alias.append(rec["title"])
        if hit:
            dups.append((rec, hit[0]))
        else:
            new.append(rec)
    return new, dups, kept_alias


def map_facets(ds: Dataset, rec):
    """Map site labels onto NU genre/tag indices; labels match ignoring case, spacing and punctuation."""
    genres, tags = ds.options["genres"], ds.options["tags"]
    gidx = {norm(g): i for i, g in enumerate(genres)}
    gidx.update({g: i for i, g in enumerate(genres)})  # exact names win for Sci-fi / Sci-Fi
    tidx = {norm(t): i for i, t in enumerate(tags)}

    def genre_of(label):
        return gidx.get(label, gidx.get(norm(label)))

    genre_ids, page_tags, dropped = [], [], []
    for g in rec["genres"]:
        if genre_of(g) is not None:
            genre_ids.append(genre_of(g))
        elif norm(g) in tidx:
            page_tags.append(tidx[norm(g)])  # e.g. Isekai, Reincarnation are tags in the NU taxonomy
        else:
            dropped.append(g)
    real = []
    for t in rec["tags"]:
        if norm(t) in tidx:
            real.append(tidx[norm(t)])
        elif genre_of(t) is not None:
            genre_ids.append(genre_of(t))  # the site lists genres like Action among its tags
        else:
            dropped.append(t)
    return sorted(set(genre_ids)), list(dict.fromkeys(page_tags + real)), dropped


class PoolBuilder:
    """Tag + genre-peer channels computed from the dataset's facets, mirroring CompactCandidateIndex."""

    def __init__(self, ids, tag_sets, genre_sets, popularity, n_tags, n_genres, tag_names):
        self.ids = np.asarray(ids)
        self.pos = {nid: i for i, nid in enumerate(ids)}
        n = len(ids)
        self.popularity = np.asarray(popularity, dtype=np.float64)
        self.T = self._binary(tag_sets, n_tags)
        self.G = self._binary(genre_sets, n_genres)
        freq = np.asarray(self.T.sum(axis=0)).ravel()
        priority = {t.lower() for t in HIGH_PRIORITY_TAGS}
        self.w = np.array([
            (math.log((n + 1.0) / (freq[t] + 1.0)) + 1.0) * (1.5 if tag_names[t].lower() in priority else 1.0)
            for t in range(n_tags)
        ])
        self.totals = self.T @ self.w
        # Candidate side keeps only the TAG_CAP most popular novels per tag (stable on id).
        order = np.lexsort((np.arange(n), -self.popularity))
        T_csc = self.T.tocsc()
        rows, cols = [], []
        for t in range(n_tags):
            members = T_csc.indices[T_csc.indptr[t]:T_csc.indptr[t + 1]]
            if len(members) > TAG_CAP:
                rank = np.empty(n, dtype=np.int64)
                rank[order] = np.arange(n)
                members = members[np.argsort(rank[members], kind="stable")[:TAG_CAP]]
            rows.extend(members.tolist())
            cols.extend([t] * len(members))
        self.C = sp.csr_matrix((np.ones(len(rows)), (rows, cols)), shape=(n, n_tags))

    @staticmethod
    def _binary(sets, width):
        indptr, indices = [0], []
        for s in sets:
            indices.extend(sorted(set(s)))
            indptr.append(len(indices))
        return sp.csr_matrix((np.ones(len(indices)), indices, indptr), shape=(len(sets), width))

    def tag_scores(self, seed_positions):
        """Dense (batch x n) tag-channel scores; seed itself and zero-overlap candidates get 0."""
        S = self.T[seed_positions].multiply(self.w).tocsr()
        shared = (S @ self.C.T).toarray()
        denom = self.totals[seed_positions][:, None] + self.totals[None, :] - shared
        with np.errstate(divide="ignore", invalid="ignore"):
            scores = np.where(shared > 0, shared / denom, 0.0)
        scores[np.arange(len(seed_positions)), seed_positions] = 0.0
        return scores

    def top(self, scores_row, limit):
        idx = np.nonzero(scores_row > 0)[0]
        best = heapq.nlargest(limit, ((scores_row[i], -int(self.ids[i])) for i in idx))
        return [(-neg, s) for s, neg in best]

    def genre_peers(self, seed_position, limit):
        shared = (self.G[seed_position] @ self.G.T).toarray().ravel()
        shared[seed_position] = 0
        idx = np.nonzero(shared > 0)[0]
        scored = ((shared[i] * 1_000_000 + math.log1p(max(0.0, self.popularity[i])), -int(self.ids[i])) for i in idx)
        return [(-neg, s / 1_000_000) for s, neg in heapq.nlargest(limit, scored)]

    def pool(self, seed_id, tag_sets_by_id):
        p = self.pos[seed_id]
        channels = {
            "tag": self.top(self.tag_scores([p])[0], POOL_LIMIT),
            "structural": self.genre_peers(p, POOL_LIMIT),
        }
        ranks = defaultdict(dict)
        for ch in CHANNELS:
            for r, (cid, _s) in enumerate(channels.get(ch, []), 1):
                ranks[cid][ch] = r
        chosen = sorted(ranks, key=lambda c: (-len(ranks[c]), min(ranks[c].values()), c))[:POOL_LIMIT]
        seed_tags = set(tag_sets_by_id[seed_id])
        return [[c, [ranks[c].get(ch) for ch in CHANNELS], sorted(seed_tags & set(tag_sets_by_id[c]))] for c in chosen]


def pool_key(entry):
    ranks = [r for r in entry[1] if r is not None]
    return (-len(ranks), min(ranks), entry[0])


def build(args):
    root = args.data.expanduser()
    ds = Dataset(root)
    f = ds.fields
    records = json.loads(args.novels.read_text())["novels"]
    new, dups, kept_alias = classify(ds, records)
    report = {"scraped": len(records), "duplicates_skipped": len(dups), "new": len(new),
              "alias_matches_kept_as_new_for_review": kept_alias}

    languages, statuses = ds.catalog["languages"], ds.catalog["statuses"]
    lang_id = languages.index("English")
    status_ids = {s: i for i, s in enumerate(statuses)}

    # Rating prior: mean of well-voted NU ratings.
    nu_ratings = [r[f["rating"]] for r in ds.catalog["rows"] if r[f["source"]] == "novelupdates" and r[f["votes"]] >= 100]
    prior = float(np.mean(nu_ratings))
    report["rating_prior"] = round(prior, 3)

    # Tags: real where the page had them, inferred from synopsis where it had too few.
    mapped = {rec["id"]: map_facets(ds, rec) for rec in new}
    need = [rec for rec in new if len(mapped[rec["id"]][1]) < MIN_REAL_TAGS and len(rec["synopsis"]) >= 40]
    inferred = {}
    if need:
        ids, texts, tag_sets, n_tags = load_corpus(root)
        cache = args.embedding_cache
        emb = np.load(cache) if cache.exists() and np.load(cache).shape[0] == len(ids) else None
        if emb is None:
            emb = embed_texts(texts)
            np.save(cache, emb)
        inf = TagInferrer(emb, tag_sets, n_tags, neighbours=args.neighbours, power=args.power)
        qvec = embed_texts([f"{r['title']}. {r['synopsis']}" for r in need])
        for rec, v in zip(need, qvec):
            have = mapped[rec["id"]][1]
            extra = [t for t in inf.infer(v, INFERRED_TOTAL + len(have)) if t not in have]
            inferred[rec["id"]] = extra[:max(0, INFERRED_TOTAL - len(have))]
    report["tags"] = {"real_tagged_novels": sum(len(mapped[r["id"]][1]) >= MIN_REAL_TAGS for r in new),
                      "inferred_novels": len(inferred),
                      "no_tags_at_all": sum(not mapped[r["id"]][1] and r["id"] not in inferred for r in new),
                      "dropped_unmapped_labels": dict(Counter(d for r in new for d in mapped[r["id"]][2]).most_common(10))}

    # Rows / details / facets for new novels.
    new_rows, new_details, new_facets = [], {}, {}
    tag_sets_new, genre_sets_new = {}, {}
    for rec in new:
        genre_ids, real_tags, _ = mapped[rec["id"]]
        inf_tags = inferred.get(rec["id"], [])
        tag_ids = list(dict.fromkeys(real_tags + inf_tags))
        votes = rec["rating_votes"]
        rating = round((votes * rec["rating"] + SHRINK_M * prior) / (votes + SHRINK_M), 1) if votes else 0
        author = "" if rec["author"].strip().lower() in JUNK_AUTHORS else rec["author"]
        ext_url = rec["url"]
        new_rows.append([
            rec["id"], rec["slug"], rec["title"], author, rec["cover_url"], rating, votes, rec["bookmarks"], None,
            lang_id, status_ids.get(rec["status"], 0), rec["chapters"], genre_ids,
            "novel", "novelphoenix", rec["slug"], ext_url,
        ])
        new_details[rec["id"]] = {
            "id": rec["id"], "synopsis": rec["synopsis"], "associated_names": [],
            "genre_ids": genre_ids, "tag_ids": tag_ids, "original_chapters": rec["chapters"],
            "rating_votes_5": 0, "rating_votes_4": 0, "rating_votes_3": 0, "rating_votes_2": 0, "rating_votes_1": 0,
            "media_type": "novel", "source": "novelphoenix", "external_id": rec["slug"], "external_url": ext_url,
            "direct_recommendation_count": 0, "related_series_count": 0, "recommendation_list_count": 0,
            "novelupdates_url": ext_url,
            "inferred_tag_ids": inf_tags,
        }
        new_facets[str(rec["id"])] = {"g": genre_ids, "t": tag_ids}
        tag_sets_new[rec["id"]], genre_sets_new[rec["id"]] = tag_ids, genre_ids

    # Pool index over existing + new novels.
    old_ids = [r[0] for r in ds.catalog["rows"]]
    all_rows = sorted(ds.catalog["rows"] + new_rows, key=lambda r: r[0])
    ids = [r[0] for r in all_rows]
    facets_all = {**{int(k): v for k, v in ds.facets["novels"].items()}, **{int(k): v for k, v in new_facets.items()}}
    tag_sets = {i: facets_all[i]["t"] for i in ids}
    builder = PoolBuilder(ids, [facets_all[i]["t"] for i in ids], [facets_all[i]["g"] for i in ids],
                          [r[f["readers"]] for r in all_rows], len(ds.options["tags"]), len(ds.options["genres"]),
                          ds.options["tags"])

    new_pools = {rec["id"]: builder.pool(rec["id"], tag_sets) for rec in new}

    # Reverse insertion into existing seeds' pools.
    new_pos = np.array([builder.pos[r["id"]] for r in new])
    new_ids = [r["id"] for r in new]
    inferred_set = set(inferred)
    inserts = defaultdict(list)  # seed id -> [(rank, new id)]
    old_pos = np.array([builder.pos[i] for i in old_ids])
    for start in range(0, len(old_pos), 600):
        batch = old_pos[start:start + 600]
        scores = builder.tag_scores(batch)
        for j, (nid, npos) in enumerate(zip(new_ids, new_pos)):
            s_n = scores[:, npos]
            beats = (scores > s_n[:, None]) | ((scores == s_n[:, None]) & (builder.ids[None, :] < nid))
            beats &= scores > 0
            rank = beats.sum(axis=1) + 1
            limit = args.inferred_max_rank if nid in inferred_set else POOL_LIMIT
            for row in np.nonzero((s_n > 0) & (rank <= limit))[0]:
                inserts[int(builder.ids[batch[row]])].append((int(rank[row]), nid))
    touched = 0
    for seed_id, items in inserts.items():
        shard = ds.recs[bucket_for_id(seed_id)]["pools"]
        pool = shard.get(str(seed_id))
        if pool is None:
            continue
        items.sort()
        seed_tags = set(tag_sets[seed_id])
        for entry in pool:
            r = entry[1][0]
            if r is not None:
                for nr, _ in items:
                    if nr <= r:
                        r += 1
                entry[1][0] = r if r <= POOL_LIMIT else None
        pool[:] = [e for e in pool if any(x is not None for x in e[1])]
        for nr, nid in items:
            pool.append([nid, [nr, None, None, None, None], sorted(seed_tags & set(tag_sets[nid]))])
        pool.sort(key=pool_key)
        del pool[POOL_LIMIT:]
        touched += 1
    report["pools"] = {"new_seed_pools": len(new_pools), "existing_pools_touched": touched,
                       "insertions": sum(len(v) for v in inserts.values()),
                       "novels_inserted_into_any_pool": len({n for v in inserts.values() for _, n in v}),
                       "empty_new_pools": sum(not p for p in new_pools.values())}

    if args.dry_run:
        return report, new, new_pools, ds

    # Write everything, keeping id order inside every file.
    ds.catalog["rows"] = all_rows
    dump(root / "catalog.json", ds.catalog)
    novels = sorted([*ds.facets["novels"].items(), *new_facets.items()], key=lambda kv: int(kv[0]))
    ds.facets["novels"] = dict(novels)
    dump(root / "facets.json", ds.facets)
    for nid, d in new_details.items():
        ds.details[bucket_for_id(nid)][str(nid)] = d
    for nid, p in new_pools.items():
        ds.recs[bucket_for_id(nid)]["pools"][str(nid)] = p
    for b in range(256):
        key = f"{b:02x}"
        ds.details[key] = dict(sorted(ds.details[key].items(), key=lambda kv: int(kv[0])))
        ds.recs[key]["pools"] = dict(sorted(ds.recs[key]["pools"].items(), key=lambda kv: int(kv[0])))
        dump(root / "details" / f"{key}.json", ds.details[key])
        dump(root / "recommendation-index" / f"{key}.json", ds.recs[key])

    m = ds.manifest
    total = len(all_rows)
    recommendable = m["recommendable_seed_count"] + sum(bool(p) for p in new_pools.values())
    for k in ("novel_count", "source_novel_count", "bootstrap_novel_count", "detail_novel_count",
              "recommendation_seed_count", "rich_recommendation_seed_count", "recommendation_index_seed_count"):
        m[k] = total
    m["recommendable_seed_count"] = m["rich_recommendable_seed_count"] = recommendable
    m["generated_at"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    digest = hashlib.sha256(f"{m['dataset_version']}:novelphoenix:{total}".encode()).hexdigest()[:12]
    m["dataset_version"] = f"{datetime.now(timezone.utc).date().isoformat()}-{digest}"
    dump(root / "manifest.json", m)
    verify_export(root, expected_novels=total, expected_bootstrap_novels=total)
    report["verified"] = True
    return report, new, new_pools, ds


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("data", type=Path, help="novelcompass-data checkout (edited in place)")
    ap.add_argument("--novels", type=Path, default=ROOT / "data" / "novelphoenix" / "novels.json")
    ap.add_argument("--embedding-cache", type=Path, default=Path("/tmp/tag_inference_emb.npy"))
    ap.add_argument("--neighbours", type=int, default=100)
    ap.add_argument("--power", type=float, default=4.0)
    ap.add_argument("--inferred-max-rank", type=int, default=25,
                    help="novels with inferred tags only enter existing pools at tag rank <= this")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    report, *_ = build(args)
    print(json.dumps(report, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
