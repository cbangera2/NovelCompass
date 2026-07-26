import pytest
import sqlite3
from src.engine.normalization import (
    SourceNormalizer,
    normalize_anilist_rating,
    normalize_database_sources,
)
from src.db.schema import SCHEMA_SQL


def test_normalize_anilist_rating_quantile_alignment():
    """AniList averageScore is 0-100; map to NU-like 1-5 by rank, not /20."""
    assert normalize_anilist_rating(0) == 0.0
    assert normalize_anilist_rating(50) == 3.0
    assert normalize_anilist_rating(72) == 4.15  # AL median ~ NU median
    assert normalize_anilist_rating(80) == 4.5  # between 78->4.40 and 83->4.65
    assert normalize_anilist_rating(85) == 4.71  # strong AL score, not a mid NU 4.25
    assert normalize_anilist_rating(92) == 4.87
    assert normalize_anilist_rating(100) == 5.0
    # Linear /20 would map 80 -> 4.0; quantile mapping should rank higher.
    assert normalize_anilist_rating(80) > 4.0


def test_source_normalizer_percentile():
    items = [
        {"id": 1, "source": "novelupdates", "reading_list_count": 100},
        {"id": 2, "source": "novelupdates", "reading_list_count": 500},
        {"id": 3, "source": "novelupdates", "reading_list_count": 1000},
        {"id": 10, "source": "anilist", "reading_list_count": 10000},
        {"id": 11, "source": "anilist", "reading_list_count": 50000},
        {"id": 12, "source": "anilist", "reading_list_count": 100000},
    ]
    
    normalizer = SourceNormalizer(target_max_readers=30000)
    normalized = normalizer.compute_source_percentiles(items)
    
    # Top item of NovelUpdates (id=3) and top item of AniList (id=12) should both scale to max 30000
    nu_top = next(item for item in normalized if item["id"] == 3)
    al_top = next(item for item in normalized if item["id"] == 12)
    
    assert nu_top["reading_list_count"] == 30000
    assert al_top["reading_list_count"] == 30000

    # Lowest item of both sources should scale to lowest percentile
    nu_bot = next(item for item in normalized if item["id"] == 1)
    al_bot = next(item for item in normalized if item["id"] == 10)
    assert nu_bot["reading_list_count"] == 10000 # 1/3 * 30000
    assert al_bot["reading_list_count"] == 10000 # 1/3 * 30000

def test_normalize_database_sources():
    conn = sqlite3.connect(":memory:")
    conn.executescript(SCHEMA_SQL)
    
    cursor = conn.cursor()
    cursor.executemany(
        "INSERT INTO novels (id, title, source, reading_list_count) VALUES (?, ?, ?, ?)",
        [
            (1, "NU 1", "novelupdates", 100),
            (2, "NU 2", "novelupdates", 500),
            (3, "NU 3", "novelupdates", 1000),
            (2000001, "AL 1", "anilist", 10000),
            (2000002, "AL 2", "anilist", 50000),
            (2000003, "AL 3", "anilist", 100000),
        ]
    )
    conn.commit()
    
    updated = normalize_database_sources(conn, target_max_readers=30000)
    assert updated == 6
    
    nu3_readers = cursor.execute("SELECT reading_list_count FROM novels WHERE id = 3").fetchone()[0]
    al3_readers = cursor.execute("SELECT reading_list_count FROM novels WHERE id = 2000003").fetchone()[0]
    
    assert nu3_readers == 30000
    assert al3_readers == 30000
    
    conn.close()
