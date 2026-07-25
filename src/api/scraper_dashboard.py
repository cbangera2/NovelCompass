"""Local-only scraper status and bounded-control endpoints.

The crawler retains ownership of request pacing, robots checks, caching, and
anti-bot stop behavior. This module only starts one bounded worker at a time.
"""

from __future__ import annotations

import threading
import os
from pathlib import Path
from typing import Optional
from urllib.parse import urlsplit

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from src.db.repository import Repository
from src.db.schema import init_db
from src.scraper.crawler import Crawler
from src.scraper.refresh import DEFAULT_ARTIFACT
from src.scraper.offline_import import MAX_UPLOAD_BYTES, import_har, import_html


router = APIRouter(prefix="/api/scraper", tags=["scraper"])

DISCOVERY_URLS = (
    "https://www.novelupdates.com/latest-series/?st=1&pg=1",
    "https://www.novelupdates.com/series-ranking/?rank=sixmonths&pg=1",
)

_lock = threading.Lock()
_worker: Optional[threading.Thread] = None
_crawler: Optional[Crawler] = None
_last_result: Optional[dict] = None


def _dashboard_db_path() -> Path:
    """Operate on the refresh artifact, never the preserved baseline."""
    return Path(os.environ.get("NOVEL_SCRAPER_DB", str(DEFAULT_ARTIFACT)))


def _dashboard_db():
    path = _dashboard_db_path()
    if not path.exists():
        raise HTTPException(
            status_code=409,
            detail=(
                "The refresh artifact has not been prepared. Run "
                "`.venv/bin/python -m src.scraper.refresh prepare` first."
            ),
        )
    return init_db(str(path))


class BatchRequest(BaseModel):
    max_items: int = Field(default=10, ge=1, le=100)


async def _bounded_body(request: Request) -> bytes:
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > MAX_UPLOAD_BYTES:
            raise HTTPException(status_code=413, detail="Import file exceeds 100 MB.")
    return bytes(body)


def _require_local(request: Request) -> None:
    """Prevent a remote deployment from becoming a public scraper control plane."""
    host = request.client.host if request.client else ""
    if host not in {"127.0.0.1", "::1", "localhost", "testclient"}:
        raise HTTPException(status_code=403, detail="Scraper controls are local-only.")
    origin = request.headers.get("origin")
    if origin:
        origin_host = (urlsplit(origin).hostname or "").lower()
        if origin_host not in {"127.0.0.1", "::1", "localhost"}:
            raise HTTPException(
                status_code=403,
                detail="Scraper controls only accept requests from a local page.",
            )


def _queue_breakdown(conn) -> dict:
    counts = {
        row["status"]: row["count"]
        for row in conn.execute(
            "SELECT status, COUNT(*) count FROM crawl_queue GROUP BY status"
        )
    }
    novel_work = conn.execute(
        """
        SELECT
          SUM(CASE WHEN n.id IS NULL THEN 1 ELSE 0 END) AS new_count,
          SUM(CASE WHEN n.id IS NOT NULL THEN 1 ELSE 0 END) AS refresh_count
        FROM crawl_queue q
        LEFT JOIN novels n ON q.type = 'novel' AND q.item_id = n.id
        WHERE q.type = 'novel' AND q.status = 'pending'
        """
    ).fetchone()
    by_type = {
        row["type"]: row["count"]
        for row in conn.execute(
            """
            SELECT type, COUNT(*) count FROM crawl_queue
            WHERE status = 'pending' GROUP BY type
            """
        )
    }
    by_phase = {
        row["phase"]: row["count"]
        for row in conn.execute(
            """
            SELECT phase, COUNT(*) count FROM crawl_queue
            WHERE status = 'pending' GROUP BY phase
            """
        )
    }
    return {
        "counts": counts,
        "pending_by_type": by_type,
        "pending_by_phase": by_phase,
        "pending_novels": {
            "new_or_unresolved": novel_work["new_count"] or 0,
            "refresh": novel_work["refresh_count"] or 0,
        },
    }


def _run_batch(max_items: int) -> None:
    global _crawler, _last_result
    conn = _dashboard_db()
    crawler = Crawler(conn)
    with _lock:
        _crawler = crawler
    try:
        result = crawler.run_queue(max_items=max_items)
    except Exception as exc:  # Keep worker failures visible in the local UI.
        result = {"status": "failed", "reason": str(exc), "errors": 1}
    finally:
        conn.close()
        with _lock:
            _last_result = result
            _crawler = None


@router.get("/status")
def scraper_status():
    conn = _dashboard_db()
    try:
        latest = conn.execute(
            """
            SELECT id, started_at, finished_at, status, pages_scraped,
                   pages_cached, pages_discovered, errors, stop_reason,
                   heartbeat_at
            FROM scrape_runs ORDER BY id DESC LIMIT 1
            """
        ).fetchone()
        recent_errors = [
            dict(row)
            for row in conn.execute(
                """
                SELECT type, url, status, attempts, last_error, updated_at
                FROM crawl_queue
                WHERE last_error IS NOT NULL
                ORDER BY updated_at DESC LIMIT 8
                """
            )
        ]
        with _lock:
            running = bool(_worker and _worker.is_alive())
            result = _last_result
        return {
            "database": str(_dashboard_db_path().resolve()),
            "artifact": dict(
                conn.execute("SELECT key, value FROM artifact_metadata")
            ),
            "running": running,
            "queue": _queue_breakdown(conn),
            "latest_run": dict(latest) if latest else None,
            "recent_errors": recent_errors,
            "last_worker_result": result,
            "safety": {
                "batch_limit_max": 100,
                "request_delay_seconds": "3–6",
                "stops_on_http": [401, 403, 429],
                "pause_behavior": "Stops after the current request finishes",
            },
        }
    finally:
        conn.close()


@router.post("/seed-discovery")
def seed_discovery(request: Request):
    _require_local(request)
    conn = _dashboard_db()
    try:
        with conn:
            for url in DISCOVERY_URLS:
                conn.execute(
                    """
                    INSERT INTO crawl_queue
                        (url, type, priority, phase, status)
                    VALUES (?, 'discovery', 90, 'discovery', 'pending')
                    ON CONFLICT(url) DO UPDATE SET
                      priority = MAX(priority, 90),
                      status = CASE
                        WHEN crawl_queue.status = 'complete' THEN 'pending'
                        ELSE crawl_queue.status
                      END
                    """,
                    (url,),
                )
        return {"seeded": len(DISCOVERY_URLS), "queue": _queue_breakdown(conn)}
    finally:
        conn.close()


@router.post("/run")
def run_batch(batch: BatchRequest, request: Request):
    global _worker
    _require_local(request)
    with _lock:
        if _worker and _worker.is_alive():
            raise HTTPException(status_code=409, detail="A scraper batch is already running.")
        _worker = threading.Thread(
            target=_run_batch,
            args=(batch.max_items,),
            name="bounded-novel-scraper",
            daemon=True,
        )
        _worker.start()
    return {"started": True, "max_items": batch.max_items}


@router.post("/pause")
def pause_scraper(request: Request):
    _require_local(request)
    with _lock:
        crawler = _crawler
        running = bool(_worker and _worker.is_alive())
        if crawler:
            crawler.request_stop()
    return {
        "requested": bool(crawler),
        "running": running,
        "message": "The batch will stop after its current request." if running else "No batch is running.",
    }


@router.post("/import")
async def import_saved_pages(request: Request):
    """Process a HAR or saved HTML locally; never replay session credentials."""
    _require_local(request)
    body = await _bounded_body(request)
    filename = request.headers.get("x-filename", "").lower()
    content_type = request.headers.get("content-type", "").split(";", 1)[0]
    conn = _dashboard_db()
    try:
        repo = Repository(conn)
        if filename.endswith(".har") or content_type == "application/json":
            result = import_har(repo, body)
        elif filename.endswith((".html", ".htm")) or content_type == "text/html":
            source_url = request.headers.get("x-source-url", "")
            if not source_url:
                raise HTTPException(
                    status_code=422,
                    detail="Saved HTML imports require its original Novel Updates URL.",
                )
            result = import_html(repo, body, source_url)
        else:
            raise HTTPException(
                status_code=415, detail="Choose a .har, .html, or .htm file."
            )
        return {
            **result,
            "message": (
                "Processed locally. Request headers and cookies were ignored; "
                "the uploaded file was not stored."
            ),
        }
    finally:
        conn.close()
