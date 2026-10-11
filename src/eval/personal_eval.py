"""Personal offline eval for Novel Compass ranking.

Measures the For-You multi-seed path against a real imported profile
(default: novel-compass-profile-2026-07-26.json) instead of the
direct_recs-reconstruction benchmark in benchmark.py.

Experiments:
  (a) library-hit  — For-You top-40 with library VISIBLE (exclude_novel_ids=[]).
                     hit = rec is loved / completed / 4-star-plus personal.
  (b) leave-one-out — hold out each 5-star title, rank from remaining seeds,
                      record the held-out title's rank (limit=100).
  (c) ablation      — repeat (a) + a LOO sample with each channel weight = 0.
  (d) audit         — popularity (reading_list_count) + diversity (pairwise
                      IDF-weighted tag Jaccard) of top-20 vs the library.

Usage:
  .venv/bin/python src/eval/personal_eval.py [--db data/recommender.db] \\
      [--profile novel-compass-profile-2026-07-26.json] [--loo-cap 25] [--out out.csv]

Caveats (also printed with results): single user (n=1); (a) is
recall-flavored self-reconstruction, a sanity floor not precision; LOO
penalizes serendipity and conflates misses with catalog gaps; only ~19% of
the catalog has synopses so the vector channel is under-tested here.
"""

import argparse
import csv
import hashlib
import json
import sqlite3
import sys
from collections import defaultdict
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))

from src.engine.candidate_gen import CandidateGenerator  # noqa: E402
from src.engine.filters import HardFilterEngine  # noqa: E402
from src.engine.ranking_contract import RRF_K, calculate_match_percent  # noqa: E402
from src.engine.rrf_ranker import (  # noqa: E402
    DEFAULT_CHANNEL_WEIGHTS,
    apply_mmr_reranking,
    calculate_rrf_scores,
)
from src.nlp.taxonomy import weighted_tag_similarity  # noqa: E402
from src.nlp.taxonomy import calculate_tag_idf  # noqa: E402

CHANNELS = ["vector", "tag", "direct_rec", "rec_list", "structural"]


# ---------------------------------------------------------------------------
# Taste profile (port of web/src/profile/taste.ts entryWeight / isNegative)
# ---------------------------------------------------------------------------

def entry_weight(entry, loved: bool):
    rating = entry.get("rating")
    status = entry.get("status")
    if status == "dropped":
        return None
    if rating is not None and rating <= 2.5:
        return None
    if loved and rating is not None and rating >= 4:
        return (max(rating, 4.5) + 0.5, f"Loved x {rating}*")
    if loved:
        return (4.5, "Loved")
    if rating is not None and rating >= 4:
        return (float(rating), f"{rating}* personal rating")
    if status == "completed":
        return (float(rating) if rating is not None else 3.8,
                f"Completed{f' x {rating}*' if rating else ' (unrated)'}")
    if rating is not None and rating >= 3.5:
        return (rating * 0.85, f"{rating}* (still reading)")
    return None


def is_negative(entry):
    if entry.get("status") == "dropped":
        return True
    rating = entry.get("rating")
    return rating is not None and rating <= 2.5


def select_positive_seeds(entries, limit, list_favorites=frozenset(), list_mixed=frozenset()):
    """Mirrors taste.ts selectPositiveSeeds incl. list-membership seeds."""
    seeds = []
    for entry in entries:
        nid = entry.get("novel_id")
        if nid is None:
            continue
        scored = entry_weight(entry, False)  # feedback always empty offline
        if scored:
            weight, reason = scored
            seeds.append({"novel_id": nid, "title": entry.get("imported_title", ""),
                          "weight": weight, "reason": reason,
                          "rating": entry.get("rating"), "status": entry.get("status")})
        # Your own lists are explicit curation (ratings are sparse).
        slug = str(entry.get("slug", "")).lower()
        if slug in list_favorites:
            seeds.append({"novel_id": nid, "title": entry.get("imported_title", ""),
                          "weight": 4.5, "reason": "In your favorites list",
                          "rating": entry.get("rating"), "status": entry.get("status")})
        elif slug in list_mixed:
            seeds.append({"novel_id": nid, "title": entry.get("imported_title", ""),
                          "weight": 3.2, "reason": "In your mixed list",
                          "rating": entry.get("rating"), "status": entry.get("status")})
    seeds.sort(key=lambda s: (-s["weight"], s["title"]))
    seen, unique = set(), []
    for seed in seeds:
        if seed["novel_id"] in seen:
            continue
        seen.add(seed["novel_id"])
        unique.append(seed)
        if len(unique) >= limit:
            break
    return unique


# ---------------------------------------------------------------------------
# Profile loading + slug resolution
# ---------------------------------------------------------------------------

def resolve_slugs(conn, slugs):
    """Resolve slugs to novel ids exactly like POST /api/resolve-slugs."""
    slugs = list(dict.fromkeys(s.strip().lower() for s in slugs if s and s.strip()))
    resolved = {}
    for offset in range(0, len(slugs), 500):
        chunk = slugs[offset:offset + 500]
        placeholders = ",".join("?" for _ in chunk)
        rows = conn.execute(
            f"SELECT id, lower(slug) FROM novels WHERE lower(slug) IN ({placeholders})",
            chunk,
        ).fetchall()
        for nid, slug in rows:
            resolved[slug] = nid
    return resolved


def load_profile(path: Path):
    return json.loads(path.read_text())


def dataset_fingerprint(conn):
    novel_stats = conn.execute(
        "SELECT COUNT(*), COALESCE(MAX(updated_at), ''), COALESCE(MAX(id), 0) FROM novels"
    ).fetchone()
    dimensions = [str(v) for v in novel_stats]
    for table in ("tags", "novel_tags", "genres", "novel_genres",
                  "direct_recs", "related_series", "rec_lists", "rec_list_items"):
        dimensions.append(str(conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]))
    return "db-" + hashlib.sha256("|".join(dimensions).encode()).hexdigest()[:12]


# ---------------------------------------------------------------------------
# For-You runner (port of _get_for_you_recommendations, affinity ON)
# ---------------------------------------------------------------------------

def affinity_multiplier(shared_tags, liked, avoided):
    like_score = sum(liked.get(t.lower(), 0.0) for t in shared_tags or [])
    avoid_score = sum(avoided.get(t.lower(), 0.0) for t in shared_tags or [])
    raw = 1.0 + min(0.35, like_score * 0.012) - min(0.4, avoid_score * 0.016)
    return max(0.55, min(1.45, raw))


CONTESTED_FACET_DISCOUNT = 0.25


def build_affinity(conn, seeds, negatives):
    """liked/avoided tag maps mirroring web taste.ts (incl. contested discount)."""
    seed_ids = [s["novel_id"] for s in seeds]
    neg_ids = [e["novel_id"] for e in negatives if e.get("novel_id") is not None]
    details = fetch_details(conn, seed_ids + neg_ids)
    liked = defaultdict(float)
    for s in seeds:
        for t in details.get(s["novel_id"], {}).get("tags", []):
            liked[t.lower()] += s["weight"]
    avoided = defaultdict(float)
    for e in negatives:
        rating = e.get("rating")
        w = max(0.5, 5 - rating) if rating is not None else 2.0
        for t in details.get(e["novel_id"], {}).get("tags", []):
            avoided[t.lower()] += w
    contested = set(liked) & set(avoided)
    for key in contested:
        liked[key] *= CONTESTED_FACET_DISCOUNT
        avoided[key] *= CONTESTED_FACET_DISCOUNT
    return dict(liked), dict(avoided), sorted(contested)


def fetch_details(conn, ids):
    """id -> {'genres': [...], 'tags': [...]} for affinity maps."""
    details = {}
    for nid in ids:
        genres = [r[0] for r in conn.execute(
            """SELECT g.name FROM genres g JOIN novel_genres ng ON ng.genre_id = g.id
               WHERE ng.novel_id = ?""", (nid,))]
        tags = [r[0] for r in conn.execute(
            """SELECT t.name FROM tags t JOIN novel_tags nt ON nt.tag_id = t.id
               WHERE nt.novel_id = ?""", (nid,))]
        details[nid] = {"genres": genres, "tags": tags}
    return details


def for_you_run(conn, cand_gen, filter_engine, tags_map, seeds, exclude_ids,
                limit=40, channel_weights=None, liked=None, avoided=None,
                use_affinity=True, mmr_lambda=0.0):
    """Returns (ranked, coverage) where ranked = [(nid, score, pct)] and
    coverage = {'seeds': n, 'vector_covered': m}."""
    liked = liked or {}
    avoided = avoided or {}
    preferences = {
        "exclude_tags": [], "include_tags": [], "include_genres": [],
        "exclude_genres": [], "language": "", "min_rating": 0,
        "min_rating_votes": 0, "max_readers": 0, "min_year": 0, "max_year": 0,
        "require_completed": False, "min_chapters": 0,
        "media_type": "all", "source": "all",
        "exclude_novel_ids": list(exclude_ids),
    }
    seed_ids = {s["novel_id"] for s in seeds}
    scores: dict = {}
    best_seed: dict = {}
    vector_covered = 0
    for seed in seeds:
        seed_id = seed["novel_id"]
        weight = max(0.1, min(10.0, float(seed["weight"] or 1.0)))
        channels = cand_gen.get_candidate_channels(seed_id, limit_per_channel=150)
        if channels.get("vector"):
            vector_covered += 1
        all_ids = {nid for cands in channels.values() for nid, _ in cands}
        valid = set(filter_engine.filter_candidates(list(all_ids), preferences))
        filtered = {name: [(nid, sc) for nid, sc in cands if nid in valid]
                    for name, cands in channels.items()}
        rrf = calculate_rrf_scores(filtered,
                                   channel_weights=channel_weights or None)
        for nid, score in rrf.items():
            if nid in seed_ids:
                continue
            contrib = score * weight
            scores[nid] = scores.get(nid, 0.0) + contrib
            if nid not in best_seed or contrib > best_seed[nid][1]:
                best_seed[nid] = (seed_id, contrib)

    ranked = sorted(scores.items(), key=lambda kv: kv[1], reverse=True)
    ranked = ranked[:max(limit * 3, limit)]
    effective = dict(channel_weights) if channel_weights else dict(DEFAULT_CHANNEL_WEIGHTS)
    # Drop zeroed channels from the match-percent contract (they contribute nothing).
    active = [c for c in CHANNELS if effective.get(c, 1.0) > 0]
    out = []
    for nid, base in ranked:
        primary, _ = best_seed.get(nid, (seeds[0]["novel_id"], 0.0))
        shared = [t for t in (tags_map.get(nid) or set())
                  if t in (tags_map.get(primary) or set())]
        mult = affinity_multiplier(shared, liked, avoided) if use_affinity else 1.0
        score = base * mult
        pct = calculate_match_percent(base * mult, active, effective, k=RRF_K)
        out.append((nid, score, pct))
    out.sort(key=lambda r: -r[1])
    out = out[:limit]
    if mmr_lambda > 0 and len(out) > 1:
        idf = calculate_tag_idf(conn)
        ids = [nid for nid, _, _ in out]
        score_map = {nid: sc for nid, sc, _ in out}
        sim = {}
        for i in range(len(ids)):
            for j in range(i + 1, len(ids)):
                s = weighted_tag_similarity(tags_map.get(ids[i], set()),
                                            tags_map.get(ids[j], set()), idf)
                sim[(ids[i], ids[j])] = s
                sim[(ids[j], ids[i])] = s
        order = apply_mmr_reranking(ids, score_map, sim, top_k=len(ids),
                                    lambda_param=mmr_lambda)
        by_id = {nid: (nid, sc, pct) for nid, sc, pct in out}
        out = [by_id[nid] for nid in order]
    return out, {"seeds": len(seeds), "vector_covered": vector_covered}


# ---------------------------------------------------------------------------
# Experiments
# ---------------------------------------------------------------------------

def is_hit(entry):
    return (entry.get("status") == "completed"
            or (entry.get("rating") or 0) >= 4)


def run_library_hit(conn, cand_gen, filt, tags_map, seeds, liked, avoided, args):
    ranked, cov = for_you_run(conn, cand_gen, filt, tags_map, seeds, set(),
                              limit=args.limit, liked=liked, avoided=avoided,
                              use_affinity=not args.no_affinity,
                              mmr_lambda=args.mmr_lambda)
    by_id = {e["novel_id"]: e for e in args.entries if e.get("novel_id") is not None}
    hits = [nid for nid, _, _ in ranked if nid in by_id and is_hit(by_id[nid])]
    rated = [by_id[n]["rating"] for n in hits if by_id[n].get("rating") is not None]
    return {
        "hit_rate": len(hits) / len(ranked) if ranked else 0.0,
        "hits": len(hits), "total": len(ranked),
        "avg_personal": sum(rated) / len(rated) if rated else None,
        "ranked": ranked, "coverage": cov,
    }


def run_loo(conn, cand_gen, filt, tags_map, entries, holds, args,
            channel_weights=None):
    by_id = {e["novel_id"]: e for e in entries if e.get("novel_id") is not None}
    lib_ids = set(by_id)
    favorites = {s.strip().lower() for s in args.list_favorites}
    to_read = {s.strip().lower() for s in args.list_to_read}
    ranks = []
    for h in holds:
        rest = [e for e in entries if e.get("novel_id") != h]
        seeds = select_positive_seeds(rest, args.seed_limit, favorites)
        if not seeds:
            ranks.append(None)
            continue
        negs = [e for e in rest if is_negative(e)]
        liked, avoided, _ = build_affinity(conn, seeds, negs)
        ranked, _ = for_you_run(conn, cand_gen, filt, tags_map, seeds,
                                lib_ids - {h}, limit=args.loo_limit,
                                channel_weights=channel_weights,
                                liked=liked, avoided=avoided,
                                use_affinity=not args.no_affinity,
                                mmr_lambda=args.mmr_lambda)
        rank = next((i + 1 for i, (nid, _, _) in enumerate(ranked) if nid == h), None)
        ranks.append(rank)
    found = [r for r in ranks if r is not None]
    def recall(k):
        return sum(1 for r in found if r <= k) / len(ranks) if ranks else 0.0
    mrr = sum(1.0 / r for r in found) / len(ranks) if ranks else 0.0
    found_sorted = sorted(found)
    median = found_sorted[len(found_sorted) // 2] if found_sorted else None
    return {"mrr": mrr, "r10": recall(10), "r20": recall(20), "r40": recall(40),
            "median_rank": median, "misses": len(ranks) - len(found),
            "n": len(ranks)}


def audit_popularity_diversity(conn, tags_map, ranked, entries):
    top = [nid for nid, _, _ in ranked[:20]]
    rows = conn.execute(
        f"SELECT id, reading_list_count FROM novels WHERE id IN ({','.join('?' * len(top))})",
        top).fetchall() if top else []
    readers = sorted(r[1] or 0 for r in rows)
    lib_readers = sorted(
        (conn.execute("SELECT reading_list_count FROM novels WHERE id = ?", (e["novel_id"],)).fetchone() or [0])[0] or 0
        for e in entries if e.get("novel_id") is not None) if entries else [0]
    def med(v):
        return v[len(v) // 2] if v else 0
    idf = calculate_tag_idf(conn)
    sims = []
    for i in range(len(top)):
        for j in range(i + 1, len(top)):
            sims.append(weighted_tag_similarity(tags_map.get(top[i], set()),
                                                tags_map.get(top[j], set()), idf))
    return {
        "med_readers": med(readers),
        "lib_med_readers": med(lib_readers),
        "mean_pairwise_jaccard": sum(sims) / len(sims) if sims else 0.0,
    }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=str(REPO_ROOT / "data" / "recommender.db"))
    ap.add_argument("--profile", default=str(REPO_ROOT / "novel-compass-profile-2026-07-26.json"))
    ap.add_argument("--seed-limit", type=int, default=12)
    ap.add_argument("--limit", type=int, default=40)
    ap.add_argument("--loo-cap", type=int, default=25,
                    help="Max 5-star holds for LOO (0 = all)")
    ap.add_argument("--loo-limit", type=int, default=100)
    ap.add_argument("--ablation-loo-cap", type=int, default=10)
    ap.add_argument("--no-affinity", action="store_true")
    ap.add_argument("--mmr-lambda", type=float, default=0.0)
    ap.add_argument("--pin-like", action="append", default=[],
                    help="Pin a tag as liked (repeatable, weight 12, mirrors UI pins)")
    ap.add_argument("--pin-avoid", action="append", default=[],
                    help="Pin a tag as avoided (repeatable, weight 10)")
    ap.add_argument("--mute", action="append", default=[],
                    help="Mute a tag in affinity (repeatable)")
    ap.add_argument("--list-favorites", action="append", default=[],
                    help="Slug to treat as favorites-list member (weight 4.5); repeatable")
    ap.add_argument("--list-to-read", action="append", default=[],
                    help="Slug to treat as to-read-list member (excluded, never seeds); repeatable")
    ap.add_argument("--out", default="")
    args = ap.parse_args()

    conn = sqlite3.connect(f"file:{args.db}?mode=ro", uri=True)
    profile = load_profile(Path(args.profile))
    entries = profile.get("entries", [])

    # Re-resolve slugs (dataset drift since import).
    claimed = {e["slug"].lower(): e for e in entries if e.get("slug")}
    resolved = resolve_slugs(conn, list(claimed))
    for slug, nid in resolved.items():
        claimed[slug]["novel_id"] = nid
    matched = [e for e in entries if e.get("novel_id") is not None]
    print(f"profile entries={len(entries)} claimed_matched={sum(1 for e in entries if e.get('novel_id') is not None)} "
          f"resolved_today={len(matched)} dataset={dataset_fingerprint(conn)} "
          f"affinity={'off' if args.no_affinity else 'on'} mmr={args.mmr_lambda}")
    args.entries = matched

    cand_gen = CandidateGenerator(conn)
    filt = HardFilterEngine(conn)
    tags_map = cand_gen._get_novel_tags_map()
    seeds = select_positive_seeds(matched, args.seed_limit,
                                  {s.strip().lower() for s in args.list_favorites})
    print(f"positive_seeds={len(seeds)} " +
          ", ".join(f"{s['title'][:28]}({s['weight']:.1f})" for s in seeds[:6]) +
          (" ..." if len(seeds) > 6 else ""))
    negs = [e for e in matched if is_negative(e)]
    liked, avoided, contested = build_affinity(conn, seeds, negs)
    for name in args.pin_like:
        liked[name.strip().lower()] = 12.0
    for name in args.pin_avoid:
        avoided[name.strip().lower()] = 10.0
    for name in args.mute:
        liked.pop(name.strip().lower(), None)
        avoided.pop(name.strip().lower(), None)
    print(f"contested_tags={contested[:8]}")

    rows = []
    # (a) library-hit baseline
    hit = run_library_hit(conn, cand_gen, filt, tags_map, seeds, liked, avoided, args)
    aud = audit_popularity_diversity(conn, tags_map, hit["ranked"], matched)
    print(f"[hit] {hit['hits']}/{hit['total']} in-library "
          f"avg_personal={hit['avg_personal'] and round(hit['avg_personal'], 2)} "
          f"vec_covered_seeds={hit['coverage']['vector_covered']}/{hit['coverage']['seeds']} "
          f"med_readers={aud['med_readers']} lib_med={aud['lib_med_readers']} "
          f"pairwise_j={aud['mean_pairwise_jaccard']:.3f}")
    rows.append(("full", hit, None, aud))

    # (b) LOO over 5-star holds
    holds_all = sorted({e["novel_id"] for e in matched if e.get("rating") == 5})
    holds = holds_all if args.loo_cap == 0 else holds_all[:args.loo_cap]
    print(f"loo_holds={len(holds)}/{len(holds_all)} (5-star, resolved today)")
    loo = run_loo(conn, cand_gen, filt, tags_map, matched, holds, args)
    print(f"[loo-full] mrr={loo['mrr']:.3f} r10={loo['r10']:.3f} r20={loo['r20']:.3f} "
          f"r40={loo['r40']:.3f} median={loo['median_rank']} misses={loo['misses']}/{loo['n']}")
    rows[0] = ("full", hit, loo, aud)

    # (c) ablation: zero each channel
    for ch in CHANNELS:
        w = dict(DEFAULT_CHANNEL_WEIGHTS)
        w[ch] = 0.0
        ranked, _ = for_you_run(conn, cand_gen, filt, tags_map, seeds, set(),
                                limit=args.limit, channel_weights=w,
                                liked=liked, avoided=avoided,
                                use_affinity=not args.no_affinity,
                                mmr_lambda=args.mmr_lambda)
        by_id = {e["novel_id"]: e for e in matched}
        hits = [nid for nid, _, _ in ranked if nid in by_id and is_hit(by_id[nid])]
        rated = [by_id[n]["rating"] for n in hits if by_id[n].get("rating") is not None]
        ahit = {"hit_rate": len(hits) / len(ranked) if ranked else 0.0,
                "hits": len(hits), "total": len(ranked),
                "avg_personal": sum(rated) / len(rated) if rated else None}
        aloo = run_loo(conn, cand_gen, filt, tags_map, matched,
                       holds[:args.ablation_loo_cap], args, channel_weights=w)
        aaud = audit_popularity_diversity(conn, tags_map, ranked, matched)
        print(f"[-{ch}] hit={ahit['hits']}/{ahit['total']} "
              f"loo_mrr={aloo['mrr']:.3f} r20={aloo['r20']:.3f} "
              f"med_readers={aaud['med_readers']} pairwise_j={aaud['mean_pairwise_jaccard']:.3f}")
        rows.append((f"-{ch}", ahit, aloo, aaud))

    # Table
    header = ["config", "hit", "hit_rate", "avg_personal", "loo_mrr", "loo_r10",
              "loo_r20", "loo_r40", "loo_median", "loo_miss", "med_readers", "pairwise_j"]
    table = [header]
    for name, h, l, a in rows:
        table.append([
            name, f"{h['hits']}/{h['total']}", round(h["hit_rate"], 3),
            round(h["avg_personal"], 2) if h["avg_personal"] else "-",
            round(l["mrr"], 3) if l else "-", round(l["r10"], 3) if l else "-",
            round(l["r20"], 3) if l else "-", round(l["r40"], 3) if l else "-",
            l["median_rank"] if l and l["median_rank"] else "-",
            f"{l['misses']}/{l['n']}" if l else "-",
            a["med_readers"], round(a["mean_pairwise_jaccard"], 3),
        ])
    widths = [max(len(str(r[i])) for r in table) for i in range(len(header))]
    print("\n" + "\n".join("  ".join(str(v).ljust(widths[i]) for i, v in enumerate(r)) for r in table))
    if args.out:
        with open(args.out, "w", newline="") as f:
            csv.writer(f).writerows(table)
        print(f"wrote {args.out}")

    print("\nCAVEATS: n=1 user; (a) is self-reconstruction sanity floor, not precision; "
          "LOO penalizes serendipity and conflates misses with catalog gaps; "
          "vector channel under-tested (few synopses); ablation deltas are "
          "correlational (channels overlap).")


if __name__ == "__main__":
    main()
