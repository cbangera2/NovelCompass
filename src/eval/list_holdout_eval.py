"""Hold-out evaluation of For You against a curated list the user loves.

Seeds are sampled from the list; the remaining members are the ground truth.
The evaluated list is deleted from an in-memory copy of the DB so the rec_list
channel cannot retrieve held-out members through that list itself.

    .venv/bin/python -m src.eval.list_holdout_eval --list-id 88138 --trials 5 --seeds 12
"""
import argparse
import math
import random
import sqlite3
import statistics
import time
from typing import Dict, List

import src.api.main as api
from src.engine.candidate_gen import CandidateGenerator

DEFAULT_DB = "data/recommender.db"
KS = (10, 20, 50, 100)


def memory_copy(path: str, drop_list_id: int) -> sqlite3.Connection:
    disk = sqlite3.connect(path)
    mem = sqlite3.connect(":memory:")
    disk.backup(mem)
    disk.close()
    mem.execute("DELETE FROM rec_list_items WHERE list_id = ?", (drop_list_id,))
    mem.commit()
    return mem


def list_members(conn: sqlite3.Connection, list_id: int) -> List[int]:
    rows = conn.execute(
        "SELECT i.novel_id FROM rec_list_items i JOIN novels n ON n.id = i.novel_id "
        "WHERE i.list_id = ? ORDER BY i.position",
        (list_id,),
    ).fetchall()
    return [r[0] for r in rows]


def score(ranked: List[int], truth: set) -> Dict[str, float]:
    out: Dict[str, float] = {}
    for k in KS:
        out[f"recall@{k}"] = len(set(ranked[:k]) & truth) / len(truth)
    first = next((i for i, nid in enumerate(ranked, 1) if nid in truth), None)
    out["mrr"] = 1.0 / first if first else 0.0
    dcg = sum(1.0 / math.log2(i + 1) for i, nid in enumerate(ranked[:50], 1) if nid in truth)
    ideal = sum(1.0 / math.log2(i + 1) for i in range(1, min(len(truth), 50) + 1))
    out["ndcg@50"] = dcg / ideal if ideal else 0.0
    return out


def popularity_ranking(conn: sqlite3.Connection, exclude: set, limit: int) -> List[int]:
    rows = conn.execute(
        "SELECT id FROM novels WHERE COALESCE(media_type,'novel') IN ('novel','light_novel') "
        "ORDER BY reading_list_count DESC LIMIT ?",
        (limit + len(exclude),),
    ).fetchall()
    return [r[0] for r in rows if r[0] not in exclude][:limit]


def mean(rows: List[Dict[str, float]]) -> Dict[str, float]:
    return {k: statistics.mean(r[k] for r in rows) for k in rows[0]}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=DEFAULT_DB)
    ap.add_argument("--list-id", type=int, required=True)
    ap.add_argument("--trials", type=int, default=5)
    ap.add_argument("--seeds", type=int, default=12)
    ap.add_argument("--limit", type=int, default=100)
    ap.add_argument("--rng", type=int, default=7)
    ap.add_argument("--channel-weights", default="", help="e.g. vector=1,tag=0.8")
    ap.add_argument("--sweep", action="store_true", help="compare preset channel-weight mixes")
    args = ap.parse_args()

    conn = memory_copy(args.db, args.list_id)
    members = list_members(sqlite3.connect(args.db), args.list_id)
    members = [m for m in members]
    print(f"list {args.list_id}: {len(members)} catalog members")
    weights = {k: float(v) for k, v in (p.split("=") for p in args.channel_weights.split(",") if p)}

    shared = CandidateGenerator(conn)
    api.CandidateGenerator = lambda _conn: shared  # reuse one vector cache across trials
    def run(weights, verbose):
        rng = random.Random(args.rng)
        model_rows, pop_rows = [], []
        for t in range(args.trials):
            seeds = rng.sample(members, args.seeds)
            truth = set(members) - set(seeds)
            req = api.ForYouRecommendRequest(
                seeds=[api.ForYouSeed(id=s) for s in seeds],
                limit=args.limit,
                channel_weights=weights,
            )
            res = api._get_for_you_recommendations(conn, req)
            ranked = [r["target_id"] for r in res["recommendations"]]
            model_rows.append(score(ranked, truth))
            pop_rows.append(score(popularity_ranking(conn, set(seeds), args.limit), truth))
            if verbose:
                m = model_rows[-1]
                print(f"trial {t + 1}: r@20={m['recall@20']:.3f} r@100={m['recall@100']:.3f} mrr={m['mrr']:.3f}")
        return mean(model_rows), mean(pop_rows)

    if args.sweep:
        mixes = {
            "default": {},
            "ease only": {"ease": 1, "vector": 0, "tag": 0, "direct_rec": 0, "rec_list": 0, "structural": 0},
            "no ease": {"ease": 0},
            "ease x3": {"ease": 3},
            "ease x3, no vector": {"ease": 3, "vector": 0},
            "ease+direct": {"ease": 2, "direct_rec": 1.5, "vector": 0, "tag": 0.3, "rec_list": 0.5, "structural": 0},
            "ease+vector": {"ease": 2, "vector": 1, "tag": 0, "direct_rec": 0, "rec_list": 0, "structural": 0},
            "ease+tag": {"ease": 2, "tag": 1, "vector": 0, "direct_rec": 0, "rec_list": 0, "structural": 0},
        }
        print(f"{'mix':<22}{'r@20':>7}{'r@50':>7}{'r@100':>7}{'mrr':>7}{'ndcg50':>8}")
        for name, w in mixes.items():
            m, _ = run(w, False)
            print(f"{name:<22}{m['recall@20']:7.3f}{m['recall@50']:7.3f}{m['recall@100']:7.3f}{m['mrr']:7.3f}{m['ndcg@50']:8.3f}", flush=True)
        return

    mm, pp = run(weights, True)
    print("\nmetric        model   popularity")
    for k in mm:
        print(f"{k:<12} {mm[k]:7.3f} {pp[k]:10.3f}")
    print(f"\ncaveats: {len(members)} members, {args.trials} trials, 1 user; "
          "see embedder log line for vector backend.")


if __name__ == "__main__":
    main()
