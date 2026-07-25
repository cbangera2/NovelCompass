import math
import sqlite3
from typing import Dict, List, Set, Tuple

DEFAULT_CHANNEL_WEIGHTS = {
    'vector': 1.0,
    'tag': 0.8,
    'direct_rec': 1.2,
    'rec_list': 1.0,
    'structural': 0.6
}

def calculate_rrf_scores(
    channel_candidates: Dict[str, List[Tuple[int, float]]],
    k: int = 60,
    channel_weights: Dict[str, float] = None
) -> Dict[int, float]:
    """
    Computes Reciprocal Rank Fusion (RRF) scores across multiple channels.
    RRF(d) = sum_{c} w_c / (k + rank_c(d))
    """
    weights = channel_weights or DEFAULT_CHANNEL_WEIGHTS
    rrf_scores: Dict[int, float] = {}

    for channel_name, candidates in channel_candidates.items():
        w_c = weights.get(channel_name, 1.0)
        for rank, (novel_id, _score) in enumerate(candidates, start=1):
            rrf_val = w_c / (k + rank)
            rrf_scores[novel_id] = rrf_scores.get(novel_id, 0.0) + rrf_val

    return rrf_scores

def calculate_bayesian_rating(rating: float, votes: int, catalog_mean: float = 3.8, min_votes: int = 25) -> float:
    """
    Weighted Bayesian Rating formula:
    WR = (v / (v + m)) * R + (m / (v + m)) * C
    """
    if votes <= 0:
        return catalog_mean
    return (votes / (votes + min_votes)) * rating + (min_votes / (votes + min_votes)) * catalog_mean

def apply_hidden_gem_boost(rrf_score: float, reading_list_count: int, max_count: int = 10000, gamma: float = 0.3) -> float:
    """
    Applies inverse popularity boost for hidden gems.
    """
    count = max(0, reading_list_count)
    boost = 1.0 + gamma * math.log10((max_count + 10) / (count + 10))
    return rrf_score * boost

def apply_mmr_reranking(
    candidate_ids: List[int],
    scores: Dict[int, float],
    similarity_matrix: Dict[Tuple[int, int], float],
    top_k: int = 20,
    lambda_param: float = 0.7
) -> List[int]:
    """
    Maximal Marginal Relevance (MMR) diversity reranking.
    """
    selected = []
    unselected = set(candidate_ids)

    while unselected and len(selected) < top_k:
        best_candidate = None
        best_mmr_score = -float('inf')

        for candidate in unselected:
            c_score = scores.get(candidate, 0.0)

            # Max similarity to already selected candidates
            max_sim = 0.0
            if selected:
                max_sim = max(similarity_matrix.get((candidate, s), 0.0) for s in selected)

            mmr_val = lambda_param * c_score - (1.0 - lambda_param) * max_sim

            if mmr_val > best_mmr_score:
                best_mmr_score = mmr_val
                best_candidate = candidate

        if best_candidate is not None:
            selected.append(best_candidate)
            unselected.remove(best_candidate)
        else:
            break

    return selected
