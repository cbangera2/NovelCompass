import sqlite3

from src.api import main
from src.db.schema import SCHEMA_SQL
from src.engine.ranking_contract import (
    ALGORITHM_VERSION,
    SCHEMA_VERSION,
    calculate_match_percent,
)
from src.engine.explainer import EvidenceExplainer


def contract_db() -> sqlite3.Connection:
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA_SQL)
    conn.execute(
        "INSERT INTO novels(id, slug, title, updated_at) VALUES (?, ?, ?, ?)",
        (38, "stellar-transformation", "Stellar Transformation", "2026-07-25 12:00:00"),
    )
    return conn


def test_match_percent_uses_active_channel_rank_one_ceiling():
    weights = {"tag": 0.8, "direct_rec": 1.2}
    ceiling = (0.8 / 61) + (1.2 / 61)

    assert calculate_match_percent(ceiling, ["tag", "direct_rec"], weights) == 100
    assert calculate_match_percent(ceiling / 2, ["tag", "direct_rec"], weights) == 50
    assert calculate_match_percent(ceiling * 2, ["tag", "direct_rec"], weights) == 100
    assert calculate_match_percent(-1, ["tag"], weights) == 0
    assert calculate_match_percent(1, [], weights) == 0


def test_dataset_version_is_deterministic_and_supports_build_override(monkeypatch):
    first = main.get_dataset_version(contract_db())
    second = main.get_dataset_version(contract_db())
    assert first == second
    assert first.startswith("db-")

    monkeypatch.setenv("NOVEL_DATASET_VERSION", "snapshot-2026-07-25")
    assert main.get_dataset_version(contract_db()) == "snapshot-2026-07-25"


def test_health_exposes_compatibility_contract(monkeypatch):
    monkeypatch.setenv("NOVEL_DATASET_VERSION", "fixture-v1")
    monkeypatch.setattr(main, "get_db", contract_db)

    payload = main.health()

    assert payload == {
        "status": "ok",
        "schema_version": SCHEMA_VERSION,
        "algorithm_version": ALGORITHM_VERSION,
        "dataset_version": "fixture-v1",
        "novel_count": 1,
    }


def test_resolve_slugs_uses_exact_slug_without_title_search(monkeypatch):
    def resolve_db():
        conn = contract_db()
        conn.execute(
            """INSERT INTO novels(id, slug, title, author, rating, rating_votes)
               VALUES (39, 'canonical-import-key', 'A Completely Different Display Title',
                       'Author', 4.5, 120)"""
        )
        return conn

    monkeypatch.setattr(main, "get_db", resolve_db)
    result = main.resolve_novel_slugs(main.SlugResolveRequest(
        slugs=["CANONICAL-IMPORT-KEY", "missing", "canonical-import-key"]
    ))

    assert len(result["results"]) == 1
    assert result["results"][0]["id"] == 39
    assert result["results"][0]["slug"] == "canonical-import-key"


def test_browse_uses_real_catalog_fields_for_sorting_and_pagination(monkeypatch):
    def browse_db():
        conn = contract_db()
        conn.executemany(
            """
            INSERT INTO novels(
                id, slug, title, author, rating, rating_votes, reading_list_count,
                language, year
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (39, "popular", "Popular", "A", 3.5, 2000, 9000, "Chinese", 2020),
                (40, "acclaimed", "Acclaimed", "B", 4.9, 500, 1000, "Korean", 2024),
            ],
        )
        conn.execute("INSERT INTO genres(name) VALUES ('Fantasy')")
        genre_id = conn.execute(
            "SELECT id FROM genres WHERE name='Fantasy'"
        ).fetchone()[0]
        conn.execute(
            "INSERT INTO novel_genres(novel_id, genre_id) VALUES (40, ?)",
            (genre_id,),
        )
        return conn

    monkeypatch.setattr(main, "get_db", browse_db)
    result = main.browse_novels(
        query="", page=1, page_size=1, sort="popular", language="",
        author="", genre="", tag="", min_rating=0, min_votes=0
    )
    assert result["total"] == 3
    assert result["items"][0]["title"] == "Popular"
    assert result["has_more"] is True

    filtered = main.browse_novels(
        query="", page=1, page_size=10, sort="rating", language="Korean",
        author="B", genre="Fantasy", tag="", min_rating=4, min_votes=100
    )
    assert [item["title"] for item in filtered["items"]] == ["Acclaimed"]
    assert filtered["items"][0]["genres"] == ["Fantasy"]


def test_browse_supports_honest_hidden_gem_and_catalog_range_filters(monkeypatch):
    def filtered_db():
        conn = contract_db()
        conn.executemany(
            """INSERT INTO novels(
                id, slug, title, rating, rating_votes, reading_list_count,
                year, chapters_trans, status_trans
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            [
                (39, "hidden", "Hidden", 4.4, 40, 900, 2024, 120, "Completed"),
                (40, "popular", "Popular", 4.5, 500, 9000, 2025, 300, "Ongoing"),
            ],
        )
        return conn

    monkeypatch.setattr(main, "get_db", filtered_db)
    result = main.browse_novels(
        query="", page=1, page_size=24, sort="rating", direction="desc",
        language="", author="", genre="", tag="",
        min_rating=4.2, max_rating=0, min_votes=10,
        min_year=2020, max_year=2024, status="complete",
        min_chapters=100, max_chapters=200,
        min_readers=0, max_readers=2000,
        include_genres="", exclude_genres="", include_tags="", exclude_tags="",
        exclude_ids="",
    )

    assert [item["slug"] for item in result["items"]] == ["hidden"]
    assert result["items"][0]["status_trans"] == "Completed"
    assert result["items"][0]["chapters_trans"] == 120


def test_evidence_uses_real_list_titles_and_labels_missing_titles_honestly():
    conn = contract_db()
    conn.execute(
        "INSERT INTO novels(id, slug, title) VALUES (39, 'target', 'Target')"
    )
    conn.executemany(
        "INSERT INTO rec_lists(id, title, item_count) VALUES (?, ?, 2)",
        [(10, "Carefully curated gems"), (11, "Novel Updates List 11")],
    )
    conn.executemany(
        "INSERT INTO rec_list_items(list_id, novel_id, position) VALUES (?, ?, ?)",
        [(10, 38, 1), (10, 39, 2), (11, 38, 1), (11, 39, 2)],
    )
    result = EvidenceExplainer(conn).explain_recommendation(38, 39, 0.1, {})
    assert result["curated_lists"] == [
        {"id": 10, "title": "Carefully curated gems"},
        {"id": 11, "title": None},
    ]
    assert any("Carefully curated gems" in item for item in result["evidence_bullets"])
    assert all("Novel Updates List 11" not in item for item in result["evidence_bullets"])


def test_random_browse_is_seeded_and_respects_filters(monkeypatch):
    def random_db():
        conn = contract_db()
        conn.executemany(
            """INSERT INTO novels(id, slug, title, author, language, rating)
               VALUES (?, ?, ?, ?, ?, ?)""",
            [
                (39, "one", "One", "A", "Korean", 4.5),
                (40, "two", "Two", "A", "Korean", 4.2),
                (41, "other", "Other", "B", "Chinese", 5.0),
            ],
        )
        return conn

    monkeypatch.setattr(main, "get_db", random_db)
    args = dict(
        query="", sort="title", language="Korean", author="A", genre="",
        tag="", min_rating=4, min_votes=0, seed=123
    )
    first = main.random_browse_novel(**args)
    second = main.random_browse_novel(**args)
    assert first == second
    assert first["eligible_count"] == 2
    assert first["novel"]["author"] == "A"
    assert first["novel"]["language"] == "Korean"


def test_novel_insights_percentiles_and_cohorts_are_catalog_relative(monkeypatch):
    def insights_db():
        conn = contract_db()
        conn.execute(
            """UPDATE novels SET rating=4, rating_votes=100,
               reading_list_count=500, language='Korean', year=2020 WHERE id=38"""
        )
        conn.execute(
            """INSERT INTO novels(id, slug, title, rating, rating_votes,
               reading_list_count, language, year)
               VALUES (39, 'peer', 'Peer', 5, 200, 1000, 'Korean', 2020)"""
        )
        conn.execute("INSERT INTO genres(name) VALUES ('Fantasy')")
        genre_id = conn.execute("SELECT id FROM genres").fetchone()[0]
        conn.executemany(
            "INSERT INTO novel_genres(novel_id, genre_id) VALUES (?, ?)",
            [(38, genre_id), (39, genre_id)],
        )
        return conn

    monkeypatch.setattr(main, "get_db", insights_db)
    result = main.get_novel_insights(38)
    rating = next(item for item in result["metrics"] if item["key"] == "rating")
    assert rating == {
        "key": "rating", "value": 4, "percentile": 50.0,
        "rank": 2, "population": 2,
    }
    assert result["cohorts"][0] == {
        "dimension": "primary_genre", "value": "Fantasy",
        "population": 2, "readership_rank": 2,
    }
    assert result["peers"][0]["title"] == "Peer"


def test_get_novel_detail_returns_rating_distribution(monkeypatch):
    def detail_db():
        conn = contract_db()
        conn.execute(
            """UPDATE novels SET rating=4.0, rating_votes=3140,
               rating_votes_5=1855, rating_votes_4=448, rating_votes_3=271,
               rating_votes_2=183, rating_votes_1=383 WHERE id=38"""
        )
        return conn

    monkeypatch.setattr(main, "get_db", detail_db)
    result = main.get_novel_detail(38)

    assert result["rating_votes_5"] == 1855
    assert result["rating_votes_4"] == 448
    assert result["rating_votes_3"] == 271
    assert result["rating_votes_2"] == 183
    assert result["rating_votes_1"] == 383
    assert result["rating_dist"] == {
        "5": 1855,
        "4": 448,
        "3": 271,
        "2": 183,
        "1": 383,
    }

