import math
import sqlite3
from typing import Dict, List, Set, Tuple

TAG_CATEGORY_WEIGHTS = {
    "trope": 1.0,
    "protagonist": 1.0,
    "relationship": 1.0,
    "tone": 1.0,
    "setting": 0.5,
    "mechanism": 0.5,
    "genre": 0.1,
    "general": 0.5
}

# Specially highlighted specific tags
HIGH_PRIORITY_TAGS = {
    "cunning protagonist", "time loop", "yandere", "female yandere",
    "misunderstandings", "obsessive love", "tragedy", "self-sacrifice",
    "regret", "dark", "no harem", "smart protagonist", "unwilling protagonist"
}

def calculate_tag_idf(conn: sqlite3.Connection) -> Dict[str, float]:
    """
    Computes Inverse Document Frequency (IDF) for all tags in the database.
    IDF = log( (Total_Novels + 1) / (Tag_Novel_Count + 1) ) + 1.0
    """
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) FROM novels")
    total_novels = cur.fetchone()[0] or 1

    cur.execute("""
        SELECT t.name, COUNT(nt.novel_id) as doc_freq
        FROM tags t
        LEFT JOIN novel_tags nt ON t.id = nt.tag_id
        GROUP BY t.id
    """)
    rows = cur.fetchall()

    idf_dict = {}
    for tag_name, freq in rows:
        tag_lower = tag_name.lower()
        base_idf = math.log((total_novels + 1.0) / (freq + 1.0)) + 1.0

        # Priority boost
        if tag_lower in HIGH_PRIORITY_TAGS:
            base_idf *= 1.5

        idf_dict[tag_lower] = base_idf

    return idf_dict

def weighted_tag_similarity(tags_a: Set[str], tags_b: Set[str], idf_dict: Dict[str, float]) -> float:
    """
    Computes IDF-weighted Jaccard similarity between two sets of tags.
    """
    if not tags_a or not tags_b:
        return 0.0

    set_a = {t.lower() for t in tags_a}
    set_b = {t.lower() for t in tags_b}

    intersection = set_a.intersection(set_b)
    union = set_a.union(set_b)

    if not union:
        return 0.0

    intersection_weight = sum(idf_dict.get(t, 1.0) for t in intersection)
    union_weight = sum(idf_dict.get(t, 1.0) for t in union)

    return intersection_weight / union_weight if union_weight > 0 else 0.0
