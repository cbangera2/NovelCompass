"""Prepare and inspect a versioned, missing-novels-first refresh artifact."""

import argparse
import json
import os
import signal
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from src.db.schema import DEFAULT_DB_PATH, init_db
from src.scraper.client import (
    DEFAULT_BROWSER_PROFILE,
    BrowserSessionTransport,
    ScraperClient,
)
from src.scraper.crawler import Crawler
from src.scraper.seed_loader import CBBOSS_PROFILE_URL, SEED_LIST_IDS


PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_ARTIFACT = (
    PROJECT_ROOT / "supporting" / "artifacts" / "novelupdates-2026.sqlite"
)
DISCOVERY_URLS = (
    "https://www.novelupdates.com/latest-series/?st=1&pg=1",
    "https://www.novelupdates.com/series-ranking/?rank=sixmonths&pg=1",
)


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _write_manifest(db_path: Path, payload: dict) -> Path:
    manifest_path = db_path.with_suffix(".manifest.json")
    manifest_path.write_text(
        json.dumps(payload, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return manifest_path


def prepare_artifact(
    source_path: Path, target_path: Path, *, replace: bool = False
) -> dict:
    source_path = source_path.resolve()
    target_path = target_path.resolve()
    if source_path == target_path:
        raise ValueError("source and target databases must be different")
    if not source_path.exists():
        raise FileNotFoundError(f"baseline database not found: {source_path}")
    if target_path.exists() and not replace:
        raise FileExistsError(
            f"artifact already exists: {target_path}; pass --replace explicitly"
        )

    target_path.parent.mkdir(parents=True, exist_ok=True)
    temporary = target_path.with_suffix(target_path.suffix + ".tmp")
    if temporary.exists():
        temporary.unlink()
    source = sqlite3.connect(source_path)
    destination = sqlite3.connect(temporary)
    try:
        source.backup(destination)
    finally:
        destination.close()
        source.close()
    os.replace(temporary, target_path)

    conn = init_db(str(target_path))
    baseline_count = conn.execute("SELECT COUNT(*) FROM novels").fetchone()[0]
    prepared_at = _utc_now()
    with conn:
        conn.execute("DELETE FROM crawl_queue")
        conn.execute("DELETE FROM scrape_runs")
        metadata = {
            "artifact_version": "2026",
            "artifact_status": "prepared",
            "baseline_path": str(source_path),
            "baseline_novel_count": str(baseline_count),
            "prepared_at": prepared_at,
            "refresh_strategy": "discover_missing_then_refresh_existing",
        }
        conn.executemany(
            """
            INSERT INTO artifact_metadata(key, value) VALUES (?, ?)
            ON CONFLICT(key) DO UPDATE SET value=excluded.value
            """,
            metadata.items(),
        )
        conn.executemany(
            """
            INSERT INTO crawl_queue(url, type, priority, phase, status)
            VALUES (?, 'discovery', 100, 'discovery', 'pending')
            """,
            [(url,) for url in DISCOVERY_URLS],
        )
        conn.executemany(
            """
            INSERT INTO crawl_queue
                (url, type, item_id, priority, phase, status)
            VALUES (?, 'rec_list', ?, 95, 'discovery', 'pending')
            """,
            [
                (f"https://www.novelupdates.com/viewlist/{list_id}/", list_id)
                for list_id in SEED_LIST_IDS
            ],
        )
        conn.execute(
            """
            INSERT INTO crawl_queue(url, type, priority, phase, status)
            VALUES (?, 'discovery', 90, 'discovery', 'pending')
            """,
            (CBBOSS_PROFILE_URL,),
        )
        conn.execute(
            """
            INSERT INTO crawl_queue
                (url, type, item_id, priority, phase, status)
            SELECT 'https://www.novelupdates.com/?p=' || id,
                   'novel', id, 10, 'refresh_existing', 'pending'
            FROM novels
            """
        )
    queue = _queue_summary(conn)
    conn.close()
    manifest = {
        "artifact_version": "2026",
        "status": "prepared",
        "prepared_at": prepared_at,
        "baseline": {
            "path": str(source_path),
            "novel_count": baseline_count,
        },
        "database": target_path.name,
        "strategy": [
            "enumerate discovery pages and curated lists",
            "fetch newly discovered novels absent from the baseline",
            "refresh existing baseline novels",
        ],
        "queue": queue,
        "publishable": False,
        "note": "A prepared or partial artifact is not a current 2026 snapshot.",
    }
    manifest_path = _write_manifest(target_path, manifest)
    return {"database": str(target_path), "manifest": str(manifest_path), **manifest}


def _queue_summary(conn: sqlite3.Connection) -> dict:
    return {
        row[0]: {status: count for status, count in json.loads(row[1])}
        for row in conn.execute(
            """
            SELECT phase, json_group_array(json_array(status, count))
            FROM (
                SELECT phase, status, COUNT(*) AS count
                FROM crawl_queue GROUP BY phase, status
            )
            GROUP BY phase ORDER BY phase
            """
        )
    }


def artifact_status(db_path: Path) -> dict:
    if not db_path.exists():
        raise FileNotFoundError(f"refresh artifact not found: {db_path}")
    conn = init_db(str(db_path))
    metadata = dict(conn.execute("SELECT key, value FROM artifact_metadata"))
    result = {
        "database": str(db_path.resolve()),
        "novels": conn.execute("SELECT COUNT(*) FROM novels").fetchone()[0],
        "metadata": metadata,
        "queue": _queue_summary(conn),
    }
    conn.close()
    return result


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Build a separate 2026 refresh artifact without modifying the baseline"
    )
    commands = parser.add_subparsers(dest="command", required=True)
    prepare = commands.add_parser("prepare")
    prepare.add_argument("--source", type=Path, default=Path(DEFAULT_DB_PATH))
    prepare.add_argument("--target", type=Path, default=DEFAULT_ARTIFACT)
    prepare.add_argument("--replace", action="store_true")
    status = commands.add_parser("status")
    status.add_argument("--db", type=Path, default=DEFAULT_ARTIFACT)
    crawl = commands.add_parser("crawl")
    crawl.add_argument("--db", type=Path, default=DEFAULT_ARTIFACT)
    crawl.add_argument("--max-items", type=int, default=None)
    crawl.add_argument("--min-delay", type=float, default=3.0)
    crawl.add_argument("--max-delay", type=float, default=6.0)
    crawl.add_argument(
        "--transport", choices=("urllib", "browser"), default="urllib"
    )
    crawl.add_argument(
        "--browser-profile", type=Path, default=DEFAULT_BROWSER_PROFILE
    )
    args = parser.parse_args()

    if args.command == "prepare":
        result = prepare_artifact(args.source, args.target, replace=args.replace)
    elif args.command == "status":
        result = artifact_status(args.db)
    else:
        if args.min_delay < 1 or args.max_delay < args.min_delay:
            parser.error("require 1 <= min-delay <= max-delay")
        conn = init_db(str(args.db))
        transport = None
        if args.transport == "browser":
            try:
                transport = BrowserSessionTransport(args.browser_profile)
            except RuntimeError as exc:
                conn.close()
                parser.error(str(exc))
        client = ScraperClient(
            delay_range=(args.min_delay, args.max_delay),
            transport=transport,
        )
        crawler = Crawler(conn, client=client)
        signal.signal(signal.SIGINT, crawler.request_stop)
        signal.signal(signal.SIGTERM, crawler.request_stop)
        try:
            result = crawler.run_queue(max_items=args.max_items)
        finally:
            client.close()
            conn.close()
        status = artifact_status(args.db)
        artifact_state = (
            "complete" if result["status"] == "complete" else "partial"
        )
        conn = init_db(str(args.db))
        with conn:
            conn.execute(
                """
                INSERT INTO artifact_metadata(key, value)
                VALUES ('artifact_status', ?)
                ON CONFLICT(key) DO UPDATE SET value=excluded.value
                """,
                (artifact_state,),
            )
        conn.close()
        _write_manifest(
            args.db,
            {
                "artifact_version": "2026",
                "status": artifact_state,
                "database": args.db.name,
                "novels": status["novels"],
                "queue": status["queue"],
                "last_crawl": result,
                "publishable": artifact_state == "complete",
                "updated_at": _utc_now(),
            },
        )
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
