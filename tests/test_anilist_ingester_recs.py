"""Regression test: ingest_media_nodes must store recs/relations for EVERY
page item, not just the last one.

The rec/relation block used to sit outside the `for raw in media_nodes`
loop, so a 50-item page only kept the last item's recommendations and
relations. Production data showed the damage: 111 of 6,086 AniList rows
(about one per scraped page) had any direct recs at all.
"""
import sqlite3

import pytest

from src.db.schema import SCHEMA_SQL
from src.scraper.anilist_ingester import AniListIngester


@pytest.fixture
def memory_db():
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    with conn:
        conn.executescript(SCHEMA_SQL)
    yield conn
    conn.close()


def mock_node(mid, rec_targets, rel_target):
    return {
        "id": mid,
        "type": "MANGA",
        "title": {"english": f"Mock Title {mid}", "romaji": None, "native": None, "userPreferred": None},
        "synonyms": [],
        "format": "MANGA",
        "countryOfOrigin": "JP",
        "averageScore": 80,
        "popularity": 1000,
        "favourites": 10,
        "status": "FINISHED",
        "startDate": {"year": 2020},
        "coverImage": {"large": None, "medium": None},
        "genres": ["Action"],
        "tags": [{"name": "Test"}],
        "chapters": 10,
        "description": "mock",
        "recommendations": {
            "nodes": [
                {
                    "rating": 5,
                    "mediaRecommendation": {
                        "id": t,
                        "type": "MANGA",
                        "title": {"english": f"Rec {t}", "romaji": None, "native": None, "userPreferred": None},
                    },
                }
                for t in rec_targets
            ]
        },
        "relations": {
            "edges": [
                {
                    "relationType": "SEQUEL",
                    "node": {
                        "id": rel_target,
                        "type": "MANGA",
                        "title": {"english": f"Rel {rel_target}", "romaji": None, "native": None, "userPreferred": None},
                    },
                }
            ]
        },
    }


def test_ingest_media_nodes_keeps_recs_for_every_item(memory_db):
    ingester = AniListIngester(memory_db, client=object())
    nodes = [
        mock_node(101, [901, 902], 801),
        mock_node(102, [903, 904], 802),
        mock_node(103, [905, 906], 803),
    ]
    ingester.ingest_media_nodes(nodes)

    for mid, rec_targets, rel_target in (
        (101, [2000901, 2000902], 2000801),
        (102, [2000903, 2000904], 2000802),
        (103, [2000905, 2000906], 2000803),
    ):
        db_id = 2_000_000 + mid
        recs = sorted(
            r[0]
            for r in memory_db.execute(
                "SELECT target_novel_id FROM direct_recs WHERE source_novel_id = ?", (db_id,)
            )
        )
        rels = sorted(
            r[0]
            for r in memory_db.execute(
                "SELECT target_novel_id FROM related_series WHERE source_novel_id = ?", (db_id,)
            )
        )
        assert recs == rec_targets, f"source {db_id} lost direct recs"
        assert rels == [rel_target], f"source {db_id} lost relations"
