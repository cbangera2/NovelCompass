import sqlite3

from src.api import main
from src.db.schema import SCHEMA_SQL
from src.engine.ranking_contract import (
    ALGORITHM_VERSION,
    SCHEMA_VERSION,
    calculate_match_percent,
)


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
