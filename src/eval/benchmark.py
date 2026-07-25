import math
import random
import sqlite3
from typing import Dict, List, Set, Tuple

from src.db.schema import init_db
from src.engine.candidate_gen import CandidateGenerator
from src.engine.rrf_ranker import calculate_rrf_scores

def evaluate_baseline_models(conn: sqlite3.Connection, seed_ids: List[int], k: int = 10) -> Dict[str, float]:
    """
    Evaluates Hybrid RRF vs Single-Signal baselines on Recall@K, NDCG@K, and MRR.
    """
    cur = conn.cursor()
    cand_gen = CandidateGenerator(conn)

    recalls = []
    ndcgs = []
    mrrs = []

    for seed_id in seed_ids:
        # Get ground truth direct recs for seed_id
        cur.execute("""
            SELECT target_novel_id FROM direct_recs WHERE source_novel_id = ?
            UNION
            SELECT source_novel_id FROM direct_recs WHERE target_novel_id = ?
        """, (seed_id, seed_id))
        ground_truth = {r[0] for r in cur.fetchall()}
        if not ground_truth:
            continue

        # Get RRF Hybrid recommendations
        channels = cand_gen.get_candidate_channels(seed_id, limit_per_channel=50)
        rrf_scores = calculate_rrf_scores(channels)
        sorted_recs = [nid for nid, _ in sorted(rrf_scores.items(), key=lambda x: x[1], reverse=True)[:k]]

        # Recall@K
        hits = set(sorted_recs).intersection(ground_truth)
        recall = len(hits) / min(len(ground_truth), k)
        recalls.append(recall)

        # MRR
        mrr = 0.0
        for rank, nid in enumerate(sorted_recs, start=1):
            if nid in ground_truth:
                mrr = 1.0 / rank
                break
        mrrs.append(mrr)

        # NDCG@K
        dcg = 0.0
        for rank, nid in enumerate(sorted_recs, start=1):
            if nid in ground_truth:
                dcg += 1.0 / math.log2(rank + 1)
        idcg = sum(1.0 / math.log2(r + 1) for r in range(1, min(len(ground_truth), k) + 1))
        ndcg = dcg / idcg if idcg > 0 else 0.0
        ndcgs.append(ndcg)

    mean_recall = sum(recalls) / len(recalls) if recalls else 0.0
    mean_ndcg = sum(ndcgs) / len(ndcgs) if ndcgs else 0.0
    mean_mrr = sum(mrrs) / len(mrrs) if mrrs else 0.0

    return {
        f"Recall@{k}": round(mean_recall, 4),
        f"NDCG@{k}": round(mean_ndcg, 4),
        "MRR": round(mean_mrr, 4)
    }

if __name__ == '__main__':
    conn = init_db()
    cur = conn.cursor()
    cur.execute("SELECT id FROM novels LIMIT 20")
    seed_ids = [r[0] for r in cur.fetchall()]
    metrics = evaluate_baseline_models(conn, seed_ids, k=10)
    print("=== Offline Benchmark Results ===")
    for m_name, m_val in metrics.items():
        print(f"{m_name}: {m_val}")
