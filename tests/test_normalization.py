import pytest
import sqlite3
from src.engine.normalization import SourceNormalizer, normalize_database_sources
from src.db.schema import SCHEMA_SQL

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
