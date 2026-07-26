"""Unit tests for AniList GDPR list mapping (Python mirror of web parser rules)."""

from __future__ import annotations


# Keep these constants in sync with web/src/profile/anilistGdpr.ts
STATUS_IN_PROGRESS = 0
STATUS_PLANNING = 1
STATUS_COMPLETED = 2
STATUS_DROPPED = 3
STATUS_PAUSED = 4
STATUS_REPEATING = 5

SERIES_ANIME = 0
SERIES_MANGA = 1

SCORE_POINT_100 = 0


def map_status(status: int) -> str:
    return {
        STATUS_COMPLETED: "completed",
        STATUS_PLANNING: "plan_to_read",
        STATUS_DROPPED: "dropped",
        STATUS_PAUSED: "paused",
        STATUS_REPEATING: "reading",
        STATUS_IN_PROGRESS: "reading",
    }.get(status, "reading")


def map_score(score: float | int | None, score_type: int = SCORE_POINT_100) -> float | None:
    if score is None or score <= 0:
        return None
    if score_type in (1, 2):  # 10-point variants
        on_five = float(score) / 2
    elif score_type == 3:  # 5-point
        on_five = float(score)
    elif score_type == 4:  # 3-point
        on_five = 2.0 if score <= 1 else 3.5 if score <= 2 else 5.0
    else:
        on_five = float(score) / 20.0
    return round(min(5.0, max(1.0, on_five)), 1)


def catalog_id(series_type: int, series_id: int) -> int:
    return (3_000_000 if series_type == SERIES_ANIME else 2_000_000) + series_id


def slug(series_type: int, series_id: int) -> str:
    return f"anilist-anime-{series_id}" if series_type == SERIES_ANIME else f"anilist-{series_id}"


def test_status_and_score_mapping():
    assert map_status(STATUS_IN_PROGRESS) == "reading"
    assert map_status(STATUS_PLANNING) == "plan_to_read"
    assert map_status(STATUS_COMPLETED) == "completed"
    assert map_status(STATUS_DROPPED) == "dropped"
    assert map_status(STATUS_PAUSED) == "paused"
    assert map_score(0) is None
    assert map_score(100) == 5.0
    assert map_score(80) == 4.0
    assert map_score(8, score_type=2) == 4.0


def test_id_offsets_and_slugs():
    assert catalog_id(SERIES_ANIME, 171457) == 3_171_457
    assert catalog_id(SERIES_MANGA, 135276) == 2_135_276
    assert slug(SERIES_ANIME, 171457) == "anilist-anime-171457"
    assert slug(SERIES_MANGA, 135276) == "anilist-135276"


def test_resolve_ids_endpoint(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient
    from src.api.main import app, get_db
    from src.db.repository import Repository
    from src.db.schema import init_db

    db_file = str(tmp_path / "gdpr.db")
    conn = init_db(db_file)
    repo = Repository(conn)
    repo.upsert_manga({
        "id": 3_171_457,
        "title": "Makeine: Too Many Losing Heroines!",
        "slug": "anilist-anime-171457-makeine",
        "media_type": "anime",
        "source": "anilist",
        "external_id": "171457",
    })
    conn.close()
    monkeypatch.setattr("src.api.main.get_db", lambda: init_db(db_file))
    client = TestClient(app)

    res = client.post("/api/resolve-ids", json={"ids": [3_171_457, 2_000_001]})
    assert res.status_code == 200
    results = res.json()["results"]
    assert len(results) == 1
    assert results[0]["id"] == 3_171_457
    assert results[0]["media_type"] == "anime"
