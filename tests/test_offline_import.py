import json
import sqlite3

from src.db.repository import Repository
from src.db.schema import SCHEMA_SQL
from src.scraper.offline_import import import_har, import_html


def memory_repo():
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA_SQL)
    return Repository(conn)


PROFILE_HTML = """
<html><body>
  <a href="/series/new-story/">New Story</a>
  <a href="/series/new-story/">New Story duplicate</a>
</body></html>
"""


def har_entry(url, html, *, status=200, mime="text/html"):
    return {
        "request": {
            "url": url,
            # Sensitive request data is present to prove the importer ignores it.
            "headers": [{"name": "Cookie", "value": "secret"}],
            "cookies": [{"name": "session", "value": "secret"}],
        },
        "response": {
            "status": status,
            "content": {"mimeType": mime, "text": html},
        },
    }


def test_har_import_accepts_only_successful_novelupdates_html():
    repo = memory_repo()
    url = "https://www.novelupdates.com/user/1/example/"
    body = json.dumps(
        {
            "log": {
                "entries": [
                    har_entry(url, PROFILE_HTML),
                    har_entry(url, PROFILE_HTML),
                    har_entry("https://evil.example/user/1/", PROFILE_HTML),
                    har_entry(
                        "https://www.novelupdates.com/user/2/example/",
                        PROFILE_HTML,
                        status=403,
                    ),
                    har_entry(
                        "https://www.novelupdates.com/user/3/example/",
                        "Just a moment... cf-chl-token",
                    ),
                ]
            }
        }
    ).encode()

    result = import_har(repo, body)

    assert result["accepted"] == 1
    assert result["duplicate"] == 1
    assert result["rejected"] == 3
    assert result["novels_queued"] == 1
    assert repo.conn.execute("SELECT COUNT(*) FROM novels").fetchone()[0] == 0
    queued = repo.conn.execute("SELECT url FROM crawl_queue").fetchone()[0]
    assert queued == "https://www.novelupdates.com/series/new-story/"


def test_saved_html_requires_novelupdates_https_and_rejects_challenges():
    repo = memory_repo()

    assert import_html(repo, PROFILE_HTML.encode(), "file:///tmp/page.html")[
        "rejected"
    ] == 1
    assert import_html(
        repo,
        b"<html>Checking your browser</html>",
        "https://www.novelupdates.com/user/1/example/",
    )["rejected"] == 1


def test_malformed_har_is_reported_as_parse_failure():
    assert import_har(memory_repo(), b"{not json")["parse_failed"] == 1
