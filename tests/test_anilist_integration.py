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
    assert mapped["rating"] == 4.71  # quantile-aligned, not score/20
    assert mapped["reading_list_count"] == 15000  # 150000 * 0.1
    assert mapped["rating_votes"] == 45000  # favourites count
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
    assert row["rating"] == 4.87


def test_anilist_ingester_preserves_recommendations_and_relations(memory_db):
    """Ensure direct_recs and related_series are both persisted without stepping on each other."""
    ingester = AniListIngester(memory_db)

    # Pre-populate recommended and related targets
    target_rec = {
        "id": 11771,
        "type": "ANIME",
        "title": {"english": "Kuroko's Basketball"},
        "format": "TV",
        "averageScore": 84,
        "popularity": 120000,
        "recommendations": {"nodes": []},
        "relations": {"edges": []},
    }
    target_rel = {
        "id": 20992,
        "type": "ANIME",
        "title": {"english": "Haikyuu!! Second Season"},
        "format": "TV",
        "averageScore": 87,
        "popularity": 130000,
        "recommendations": {"nodes": []},
        "relations": {"edges": []},
    }
    ingester.ingest_media_nodes([target_rec, target_rel])

    raw_haikyuu = {
        "id": 20464,
        "type": "ANIME",
        "title": {"english": "Haikyuu!!"},
        "format": "TV",
        "status": "FINISHED",
        "description": "Shouyou Hinata, inspired to play volleyball...",
        "seasonYear": 2014,
        "countryOfOrigin": "JP",
        "genres": ["Comedy", "Sports"],
        "tags": [{"name": "Volleyball"}, {"name": "School"}],
        "averageScore": 86,
        "popularity": 180000,
        "episodes": 25,
        "recommendations": {
            "nodes": [
                {
                    "rating": 209,
                    "mediaRecommendation": {
                        "id": 11771,
                        "type": "ANIME",
                        "title": {"english": "Kuroko's Basketball"},
                    },
                }
            ]
        },
        "relations": {
            "edges": [
                {
                    "relationType": "SEQUEL",
                    "node": {
                        "id": 20992,
                        "type": "ANIME",
                        "title": {"english": "Haikyuu!! Second Season"},
                    },
                }
            ]
        },
    }

    db_ids = ingester.ingest_media_nodes([raw_haikyuu])
    haikyuu_id = db_ids[0]
    assert haikyuu_id == 3_000_000 + 20464

    # Both direct_recs and related_series must exist in DB
    recs = memory_db.execute(
        "SELECT target_novel_id, votes FROM direct_recs WHERE source_novel_id = ?",
        (haikyuu_id,),
    ).fetchall()
    assert len(recs) == 1
    assert recs[0]["target_novel_id"] == 3_000_000 + 11771
    assert recs[0]["votes"] == 209

    rels = memory_db.execute(
        "SELECT target_novel_id, relation_type FROM related_series WHERE source_novel_id = ?",
        (haikyuu_id,),
    ).fetchall()
    assert len(rels) == 1
    assert rels[0]["target_novel_id"] == 3_000_000 + 20992
    assert rels[0]["relation_type"] == "sequel"

    # Verify CandidateGenerator sees direct_rec channel candidates
    cand_gen = CandidateGenerator(memory_db)
    channels = cand_gen.get_candidate_channels(haikyuu_id)
    assert len(channels["direct_rec"]) == 1
    assert channels["direct_rec"][0][0] == 3_000_000 + 11771

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
    assert mapped["rating"] == 4.85
    assert "Madhouse" in mapped["author"]
    assert mapped["external_url"] == "https://anilist.co/anime/154587"


def test_map_anilist_light_novel_stays_distinct_from_manga():
    raw_media = {
        "id": 135276,
        "type": "MANGA",
        "title": {
            "english": "Too Many Losing Heroines!",
            "romaji": "Make Heroine ga Oosugiru!",
            "userPreferred": "Make Heroine ga Oosugiru!",
        },
        "format": "NOVEL",
        "status": "RELEASING",
        "countryOfOrigin": "JP",
        "averageScore": 80,
        "popularity": 50000,
        "recommendations": {"nodes": []},
        "relations": {"edges": []},
    }
    mapped = map_anilist_media(raw_media)
    assert mapped["media_type"] == "light_novel"
    assert mapped["title"] == "Too Many Losing Heroines!"
    assert "Make Heroine ga Oosugiru!" in mapped["associated_names"]
    assert mapped["id"] == 2_000_000 + 135276

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


def test_api_search_multi_media_and_fuzzy_punctuation(tmp_path, monkeypatch):
    """UI sends comma-separated media types; punctuation should not block matches."""
    db_file = str(tmp_path / "test_search.db")
    conn = init_db(db_file)
    repo = Repository(conn)
    repo.upsert_novel({
        "id": 46924,
        "title": "Too Many Losing Heroines!",
        "slug": "too-many-losing-heroines",
        "associated_names": ["Makeine"],
        "media_type": "novel",
        "source": "novelupdates",
        "reading_list_count": 100,
    })
    repo.upsert_manga({
        "id": 2_135_276,
        "title": "Too Many Losing Heroines!",
        "slug": "anilist-135276-too-many-losing-heroines",
        "associated_names": ["Make Heroine ga Oosugiru!"],
        "media_type": "light_novel",
        "source": "anilist",
        "external_id": "135276",
        "external_url": "https://anilist.co/manga/135276",
        "reading_list_count": 80,
    })
    repo.upsert_manga({
        "id": 2_147_664,
        "title": "Too Many Losing Heroines! @comic",
        "slug": "anilist-147664-comic",
        "associated_names": ["Make Heroine ga Oosugiru! @comic"],
        "media_type": "manga",
        "source": "anilist",
        "external_id": "147664",
        "reading_list_count": 70,
    })
    repo.upsert_manga({
        "id": 3_171_457,
        "title": "Makeine: Too Many Losing Heroines!",
        "slug": "anilist-anime-171457",
        "associated_names": ["Make Heroine ga Oosugiru!"],
        "media_type": "anime",
        "source": "anilist",
        "external_id": "171457",
        "external_url": "https://anilist.co/anime/171457",
        "reading_list_count": 200,
    })
    conn.close()

    monkeypatch.setattr("src.api.main.get_db", lambda: init_db(db_file))
    client = TestClient(app)

    # Default UI selection joins all media types — previously matched nothing.
    multi = client.get(
        "/api/search",
        params={"q": "Too Many Losing Heroines!", "limit": 20, "media_type": "novel,manga,anime"},
    )
    assert multi.status_code == 200
    multi_ids = {item["id"] for item in multi.json()["results"]}
    assert multi_ids == {46924, 2_135_276, 2_147_664, 3_171_457}

    # Punctuation / casing should not matter.
    fuzzy = client.get(
        "/api/search",
        params={"q": "too many losing heroines", "limit": 20, "media_type": "all"},
    )
    assert {item["id"] for item in fuzzy.json()["results"]} == multi_ids

    anime_only = client.get(
        "/api/search",
        params={"q": "losing heroines", "limit": 20, "media_type": "anime"},
    )
    assert [item["id"] for item in anime_only.json()["results"]] == [3_171_457]
    assert anime_only.json()["results"][0]["external_url"].endswith("/anime/171457")
