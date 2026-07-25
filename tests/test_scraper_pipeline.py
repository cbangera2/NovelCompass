import sqlite3
from pathlib import Path

from src.db.repository import Repository
from src.db.schema import SCHEMA_SQL
from src.scraper.html_parser import parse_discovery_page, parse_series_page
from src.scraper.client import ScraperClient
from src.scraper.refresh import artifact_status, prepare_artifact


FIXTURES = Path(__file__).parent / "fixtures"


class FakeTransport:
    def __init__(self, text, status=200):
        self.text = text
        self.status = status
        self.calls = []
        self.closed = False

    def fetch(self, url, *, post_data=None, timeout=30.0):
        self.calls.append((url, post_data, timeout))
        return self.text, self.status

    def close(self):
        self.closed = True


def test_client_transport_caches_success_and_can_be_closed(tmp_path):
    transport = FakeTransport("<html>catalog</html>")
    client = ScraperClient(
        cache_dir=str(tmp_path),
        delay_range=(0, 0),
        transport=transport,
    )

    first = client.fetch("https://www.novelupdates.com/latest-series/")
    second = client.fetch("https://www.novelupdates.com/latest-series/")
    client.close()

    assert first == ("<html>catalog</html>", 200, False)
    assert second == ("<html>catalog</html>", 200, True)
    assert len(transport.calls) == 1
    assert transport.closed


def test_client_marks_browser_challenge_as_blocked_without_caching(tmp_path):
    transport = FakeTransport("<title>Just a moment...</title>")
    client = ScraperClient(
        cache_dir=str(tmp_path),
        delay_range=(0, 0),
        transport=transport,
    )

    assert client.fetch("https://www.novelupdates.com/") == (None, 403, False)
    assert list(tmp_path.iterdir()) == []


def memory_repo() -> Repository:
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA_SQL)
    return Repository(conn)


def test_current_series_markup_discovers_relationships_and_lists():
    parsed = parse_series_page(
        (FIXTURES / "series_page.html").read_text(encoding="utf-8"),
        url=(
            "https://www.novelupdates.com/series/"
            "sword-devouring-swordmaster/"
        ),
    )
    assert parsed["id"] == 135608
    assert parsed["direct_recs"] == [
        {
            "id": 161263,
            "slug": "the-sleeping-demon-god",
            "title": "The Sleeping Demon God",
            "url": (
                "https://www.novelupdates.com/series/"
                "the-sleeping-demon-god/"
            ),
            "votes": 1,
        }
    ]
    assert 141735 in parsed["recommendation_list_ids"]


def test_discovery_parser_extracts_canonical_links_and_pagination():
    parsed = parse_discovery_page(
        """
        <a id="sid42" href="/series/a-title/">A title</a>
        <a href="?rank=sixmonths&pg=9">9</a>
        """,
        "https://www.novelupdates.com/series-ranking/?rank=sixmonths&pg=1",
    )
    assert parsed["max_page"] == 9
    assert parsed["series"][0]["id"] == 42
    assert parsed["series"][0]["url"] == (
        "https://www.novelupdates.com/series/a-title/"
    )


def test_queue_claim_is_restartable_and_relationships_are_replaced():
    repo = memory_repo()
    repo.add_to_crawl_queue(
        "http://novelupdates.com/series/source", "novel", 1
    )
    claimed = repo.claim_next_queue_item()
    assert claimed["status"] == "in_progress"
    assert claimed["attempts"] == 1
    assert repo.recover_interrupted_items() == 1
    assert repo.claim_next_queue_item()["attempts"] == 2

    repo.conn.executemany(
        "INSERT INTO novels(id, slug, title) VALUES (?, ?, ?)",
        [(1, "source", "Source"), (2, "target", "Target")],
    )
    repo.replace_novel_relationships(
        1,
        [{"id": 2, "votes": 3}],
        [{"id": 2, "relation_type": "sequel"}],
    )
    assert tuple(
        repo.conn.execute(
            """
            SELECT target_novel_id, votes FROM direct_recs
            WHERE source_novel_id = 1
            """
        ).fetchone()
    ) == (2, 3)


def test_discovered_novels_are_claimed_before_baseline_refreshes():
    repo = memory_repo()
    repo.conn.execute(
        "INSERT INTO novels(id, slug, title) VALUES (1, 'known', 'Known')"
    )
    repo.add_to_crawl_queue(
        "https://www.novelupdates.com/?p=1",
        "novel",
        1,
        priority=1000,
        phase="refresh_existing",
    )
    assert repo.add_discovered_novel(
        "https://www.novelupdates.com/series/new/", 2
    ) == "new_novel"
    assert repo.claim_next_queue_item()["item_id"] == 2


def test_refresh_artifact_is_a_separate_versioned_copy(tmp_path):
    source = tmp_path / "baseline.db"
    target = tmp_path / "novelupdates-2026.sqlite"
    conn = sqlite3.connect(source)
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA_SQL)
    conn.execute(
        "INSERT INTO novels(id, slug, title) VALUES (1, 'baseline', 'Baseline')"
    )
    conn.commit()
    conn.close()

    result = prepare_artifact(source, target)
    status = artifact_status(target)

    assert result["status"] == "prepared"
    assert status["novels"] == 1
    assert status["metadata"]["artifact_version"] == "2026"
    assert status["queue"]["discovery"]["pending"] == 7
    assert status["queue"]["refresh_existing"]["pending"] == 1
    assert target.with_suffix(".manifest.json").exists()

    baseline = sqlite3.connect(source)
    assert baseline.execute("SELECT COUNT(*) FROM crawl_queue").fetchone()[0] == 0
    baseline.close()
