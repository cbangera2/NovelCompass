"""
Multi-Source Quantile Normalizer for Cross-Platform Datasets.

This module provides distribution-based (percentile/quantile) normalization
across arbitrary media sources (NovelUpdates, AniList, MyAnimeList, Syosetu, etc.).
Instead of magic multipliers, each item's metrics (readership, votes) are evaluated
relative to the empirical distribution of its origin source.
"""

from typing import Any, Dict, List


def normalize_anilist_rating(score_100: float) -> float:
    """
    Normalizes AniList 0-100 score to NovelUpdates equivalent 1.0-5.0 scale.
    
    AniList ratings have a tighter distribution (median ~72, 80+ is top 15%, 85+ is top 5%).
    NovelUpdates ratings have a higher median (~4.15, 4.5+ is top 15%, 4.7+ is top 5%).
    
    Piecewise linear quantile alignment:
      < 50 -> 2.50
      50   -> 3.00
      65   -> 3.70
      72   -> 4.15 (AniList Median -> NU Median)
      78   -> 4.40
      83   -> 4.65 (AniList Top 10% -> NU Top 10%)
      88   -> 4.80 (AniList Top 3%  -> NU Top 3%)
      100  -> 5.00
    """
    if not score_100 or score_100 <= 0:
        return 0.0

    points = [
        (0.0, 1.00),
        (50.0, 3.00),
        (65.0, 3.70),
        (72.0, 4.15),
        (78.0, 4.40),
        (83.0, 4.65),
        (88.0, 4.80),
        (100.0, 5.00),
    ]

    for i in range(len(points) - 1):
        x0, y0 = points[i]
        x1, y1 = points[i + 1]
        if x0 <= score_100 <= x1:
            t = (score_100 - x0) / (x1 - x0)
            return round(y0 + t * (y1 - y0), 2)

    return 5.0


class SourceNormalizer:
    """
    Quantile / Percentile Normalizer for multi-source datasets.
    
    Maps arbitrary raw metrics from any source S onto a standardized canonical scale [0, target_max].
    """
    
    def __init__(self, target_max_readers: float = 30000.0, target_max_votes: float = 5000.0):
        self.target_max_readers = target_max_readers
        self.target_max_votes = target_max_votes

    def compute_source_percentiles(self, items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Computes percentile ranks for `reading_list_count` and `rating_votes`
        grouped by `source`, then maps them to the canonical target scale.
        """
        if not items:
            return items

        # Group indices by source
        source_groups: Dict[str, List[int]] = {}
        for idx, item in enumerate(items):
            src = item.get("source") or "novelupdates"
            source_groups.setdefault(src, []).append(idx)

        normalized_items = [dict(item) for item in items]

        for src, indices in source_groups.items():
            n = len(indices)
            if n == 0:
                continue

            # Sort indices by raw reading_list_count
            by_readers = sorted(indices, key=lambda i: items[i].get("reading_list_count") or 0)
            for rank_idx, item_idx in enumerate(by_readers):
                percentile = (rank_idx + 1) / n if n > 1 else 1.0
                normalized_items[item_idx]["reading_list_count"] = round(percentile * self.target_max_readers)

            # Sort indices by raw rating_votes
            by_votes = sorted(indices, key=lambda i: items[i].get("rating_votes") or 0)
            for rank_idx, item_idx in enumerate(by_votes):
                percentile = (rank_idx + 1) / n if n > 1 else 1.0
                normalized_items[item_idx]["rating_votes"] = round(percentile * self.target_max_votes)

        return normalized_items


def normalize_database_sources(conn, target_max_readers: int = 30000) -> int:
    """
    Applies percentile normalization across all sources in the SQLite database.
    Ensures that top 1% items from any source have equal readership scores.
    """
    cursor = conn.cursor()
    sources = [row[0] for row in cursor.execute("SELECT DISTINCT COALESCE(source, 'novelupdates') FROM novels").fetchall()]
    
    total_updated = 0
    for src in sources:
        rows = cursor.execute(
            "SELECT id, reading_list_count FROM novels WHERE COALESCE(source, 'novelupdates') = ? ORDER BY reading_list_count ASC",
            (src,)
        ).fetchall()
        
        n = len(rows)
        if n == 0:
            continue

        updates = []
        for rank_idx, row in enumerate(rows):
            nid = row[0]
            percentile = (rank_idx + 1) / n if n > 1 else 1.0
            norm_readers = round(percentile * target_max_readers)
            updates.append((norm_readers, nid))
            
        cursor.executemany("UPDATE novels SET reading_list_count = ? WHERE id = ?", updates)
        total_updated += len(updates)
        
    conn.commit()
    return total_updated
