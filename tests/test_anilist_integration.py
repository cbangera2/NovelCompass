import pytest
import sqlite3
from fastapi.testclient import TestClient
from src.db.schema import init_db
from src.db.repository import Repository
from src.scraper.anilist_client import AniListClient
from src.scraper.anilist_ingester import AniListIngester, map_anilist_media, ANILIST_ID_OFFSET
from src.engine.filters import HardFilterEngine
from src.engine.candidate_gen import CandidateGenerator
from src.api.main import app, get_db
import build_static_export

@pytest.fixture
def memory_db():
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    init_db_conn(conn)
    yield conn
    conn.close()

def init_db_conn(conn: sqlite3.Connection):
    from src.db.schema import SCHEMA_SQL
    with conn:
        conn.executescript(SCHEMA_SQL)
        novel_cols = {row["name"] for row in conn.execute("PRAGMA table_info(novels)")}
        for star in range(1, 6):
            if f"rating_votes_{star}" not in novel_cols:
                conn.execute(f"ALTER TABLE novels ADD COLUMN rating_votes_{star} INTEGER DEFAULT 0")
        for name, declaration in (
            ("media_type", "TEXT DEFAULT 'novel'"),
            ("source", "TEXT DEFAULT 'novelupdates'"),
            ("external_id", "TEXT"),
            ("external_url", "TEXT"),
        ):
            if name not in novel_cols:
                conn.execute(f"ALTER TABLE novels ADD COLUMN {name} {declaration}")

def test_map_anilist_media():
    raw_media = {
        "id": 105778,
        "title": {"english": "Chainsaw Man", "romaji": "Chainsaw Man", "native": "チェンソーマン"},
        "format": "MANGA",
        "status": "RELEASING",
        "description": "Denji has a simple dream—to live a happy and peaceful life.",
        "startDate": {"year": 2018},
        "countryOfOrigin": "JP",
        "genres": ["Action", "Supernatural"],
        "tags": [{"name": "Demons"}, {"name": "Gore"}],
        "averageScore": 85,
        "popularity": 150000,
        "favourites": 45000,
        "chapters": 150,
        "coverImage": {"large": "https://s4.anilist.co/cover.jpg"},
        "staff": {"edges": [{"role": "Story & Art", "node": {"name": {"full": "Tatsuki Fujimoto"}}}]},
        "recommendations": {"nodes": []},
        "relations": {"edges": []}
    }
    mapped = map_anilist_media(raw_media)
    assert mapped["id"] == ANILIST_ID_OFFSET + 105778
    assert mapped["title"] == "Chainsaw Man"
    assert mapped["media_type"] == "manga"
    assert mapped["source"] == "anilist"
    assert mapped["rating"] == 4.25
    assert mapped["author"] == "Tatsuki Fujimoto"
    assert "Action" in mapped["genres"]
    assert "Demons" in mapped["tags"]

def test_anilist_ingester_db(memory_db):
    ingester = AniListIngester(memory_db)
    raw_media = {
        "id": 30002,
        "title": {"english": "Berserk", "userPreferred": "Berserk"},
        "format": "MANGA",
        "status": "RELEASING",
        "description": "Guts, known as the Black Swordsman, seeks sanctuary from the demonic forces.",
        "startDate": {"year": 1989},
        "countryOfOrigin": "JP",
        "genres": ["Action", "Dark Fantasy"],
        "tags": [{"name": "Seinen"}, {"name": "Tragedy"}],
        "averageScore": 92,
        "popularity": 200000,
        "coverImage": {"large": "https://s4.anilist.co/berserk.jpg"},
        "staff": {"edges": [{"role": "Story & Art", "node": {"name": {"full": "Kentarou Miura"}}}]},
        "recommendations": {"nodes": []},
        "relations": {"edges": []}
    }
    db_ids = ingester.ingest_media_nodes([raw_media])
    assert len(db_ids) == 1
    assert db_ids[0] == ANILIST_ID_OFFSET + 30002

    row = memory_db.execute("SELECT * FROM novels WHERE id = ?", (db_ids[0],)).fetchone()
    assert row["title"] == "Berserk"
    assert row["media_type"] == "manga"
    assert row["source"] == "anilist"
    assert row["rating"] == 4.6

def test_hard_filter_media_type(memory_db):
    repo = Repository(memory_db)
    # Novel item
    repo.upsert_novel({"id": 1, "title": "Novel One", "media_type": "novel", "source": "novelupdates"})
    # Manga item
    repo.upsert_manga({"id": 2000002, "title": "Manga Two", "media_type": "manga", "source": "anilist"})

    filter_engine = HardFilterEngine(memory_db)
    
    # Filter for manga only
    manga_cands = filter_engine.filter_candidates([1, 2000002], {"media_type": "manga"})
    assert manga_cands == [2000002]

    # Filter for novels only
    novel_cands = filter_engine.filter_candidates([1, 2000002], {"media_type": "novel"})
    assert novel_cands == [1]

    # Filter all
    all_cands = filter_engine.filter_candidates([1, 2000002], {"media_type": "all"})
    assert set(all_cands) == {1, 2000002}

def test_map_anilist_anime():
    raw_media = {
        "id": 154587,
        "type": "ANIME",
        "title": {"english": "Frieren: Beyond Journey's End", "romaji": "Sousou no Frieren"},
        "format": "TV",
        "status": "FINISHED",
        "description": "The adventure is over but life goes on for an elf mage.",
        "seasonYear": 2023,
        "countryOfOrigin": "JP",
        "genres": ["Adventure", "Drama", "Fantasy"],
        "tags": [{"name": "Magic"}, {"name": "Elves"}],
        "averageScore": 91,
        "popularity": 250000,
        "episodes": 28,
        "coverImage": {"large": "https://s4.anilist.co/frieren.jpg"},
        "staff": {"edges": [{"role": "Director", "node": {"name": {"full": "Keisuke Saito"}}}]},
        "studios": {"nodes": [{"name": "Madhouse"}]},
        "recommendations": {"nodes": []},
        "relations": {"edges": []}
    }
    mapped = map_anilist_media(raw_media)
    assert mapped["id"] == 3_000_000 + 154587
    assert mapped["title"] == "Frieren: Beyond Journey's End"
    assert mapped["media_type"] == "anime"
    assert mapped["source"] == "anilist"
    assert mapped["rating"] == 4.55
    assert "Madhouse" in mapped["author"]
    assert mapped["external_url"] == "https://anilist.co/anime/154587"

def test_hard_filter_multi_media_types(memory_db):
    repo = Repository(memory_db)
    repo.upsert_novel({"id": 1, "title": "Novel One", "media_type": "novel", "source": "novelupdates"})
    repo.upsert_manga({"id": 2000002, "title": "Manga Two", "media_type": "manga", "source": "anilist"})
    repo.upsert_manga({"id": 3000003, "title": "Anime Three", "media_type": "anime", "source": "anilist"})

    filter_engine = HardFilterEngine(memory_db)
    
    # Filter for novel + anime combo
    combo_cands = filter_engine.filter_candidates([1, 2000002, 3000003], {"media_type": "novel,anime"})
    assert set(combo_cands) == {1, 3000003}

    # Filter for anime only
    anime_cands = filter_engine.filter_candidates([1, 2000002, 3000003], {"media_type": "anime"})
    assert anime_cands == [3000003]

def test_api_browse_media_type(tmp_path, monkeypatch):
    db_file = str(tmp_path / "test_media.db")
    conn = init_db(db_file)
    repo = Repository(conn)
    repo.upsert_novel({"id": 10, "title": "Overlord WN", "media_type": "novel", "source": "novelupdates"})
    repo.upsert_manga({"id": 2030013, "title": "One Piece Manga", "media_type": "manga", "source": "anilist"})
    repo.upsert_manga({"id": 3154587, "title": "Frieren Anime", "media_type": "anime", "source": "anilist"})
    conn.close()

    monkeypatch.setattr("src.api.main.get_db", lambda: init_db(db_file))
    client = TestClient(app)

    res_all = client.get("/api/browse?media_type=all")
    assert res_all.status_code == 200
    assert res_all.json()["total"] == 3

    res_combo = client.get("/api/browse?media_type=manga,anime")
    assert res_combo.status_code == 200
    assert res_combo.json()["total"] == 2

    res_anime = client.get("/api/browse?media_type=anime")
    assert res_anime.status_code == 200
    assert res_anime.json()["total"] == 1
    assert res_anime.json()["items"][0]["title"] == "Frieren Anime"
    assert res_anime.json()["items"][0]["media_type"] == "anime"
