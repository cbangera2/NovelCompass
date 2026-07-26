"""Local-only scraper status and bounded-control endpoints.

The crawler retains ownership of request pacing, robots checks, caching, and
anti-bot stop behavior. This module only starts one bounded worker at a time.
"""

from __future__ import annotations

import threading
import os
from pathlib import Path
from typing import Literal, Optional
from urllib.parse import urlsplit

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from src.db.repository import Repository
from src.db.schema import init_db
from src.scraper.crawler import Crawler
from src.scraper.client import (
    DEFAULT_BROWSER_PROFILE,
    BrowserSessionTransport,
    ScraperClient,
)
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
_browser_setup_thread: Optional[threading.Thread] = None
_browser_setup_stop = threading.Event()
_browser_setup_ready = threading.Event()
_browser_setup_error: Optional[str] = None


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
    transport: Literal["urllib", "browser"] = "urllib"


def _browser_profile_path() -> Path:
    return Path(
        os.environ.get("NOVEL_SCRAPER_BROWSER_PROFILE", str(DEFAULT_BROWSER_PROFILE))
    )


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


def _run_batch(max_items: int, transport_name: str) -> None:
    global _crawler, _last_result
    conn = _dashboard_db()
    transport = None
    client = None
    with _lock:
        _crawler = None
    try:
        if transport_name == "browser":
            transport = BrowserSessionTransport(_browser_profile_path())
        client = ScraperClient(transport=transport)
        crawler = Crawler(conn, client=client)
        with _lock:
            _crawler = crawler
        result = crawler.run_queue(max_items=max_items)
    except Exception as exc:  # Keep worker failures visible in the local UI.
        result = {"status": "failed", "reason": str(exc), "errors": 1}
    finally:
        if client:
            client.close()
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
            setup_running = bool(
                _browser_setup_thread and _browser_setup_thread.is_alive()
            )
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
            "browser_session": {
                "setup_running": setup_running,
                "ready": _browser_setup_ready.is_set(),
                "prepared": (
                    _browser_profile_path().exists()
                    and any(_browser_profile_path().iterdir())
                ),
                "error": _browser_setup_error,
                "profile": str(_browser_profile_path().resolve()),
            },
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
        if _browser_setup_thread and _browser_setup_thread.is_alive():
            raise HTTPException(
                status_code=409,
                detail=(
                    "Finish the browser setup session before starting a batch."
                ),
            )
        _worker = threading.Thread(
            target=_run_batch,
            args=(batch.max_items, batch.transport),
            name="bounded-novel-scraper",
            daemon=True,
        )
        _worker.start()
    return {
        "started": True,
        "max_items": batch.max_items,
        "transport": batch.transport,
    }


def _browser_setup_worker() -> None:
    global _browser_setup_error
    transport = None
    try:
        transport = BrowserSessionTransport(_browser_profile_path())
        transport.open_for_manual_setup()
        _browser_setup_ready.set()
        _browser_setup_stop.wait()
    except Exception as exc:
        _browser_setup_error = str(exc)
    finally:
        if transport:
            transport.close()
        _browser_setup_ready.clear()
        _browser_setup_stop.clear()


@router.post("/browser-session/open")
def open_browser_session(request: Request):
    global _browser_setup_thread, _browser_setup_error
    _require_local(request)
    with _lock:
        if _worker and _worker.is_alive():
            raise HTTPException(
                status_code=409, detail="Stop the scraper batch before browser setup."
            )
        if _browser_setup_thread and _browser_setup_thread.is_alive():
            return {"started": False, "message": "Browser setup is already open."}
        _browser_setup_error = None
        _browser_setup_ready.clear()
        _browser_setup_stop.clear()
        _browser_setup_thread = threading.Thread(
            target=_browser_setup_worker,
            name="novel-scraper-browser-setup",
            daemon=True,
        )
        _browser_setup_thread.start()
    return {
        "started": True,
        "message": (
            "Browser setup is launching. Complete any login or challenge manually, "
            "then click Finish session setup."
        ),
    }


@router.post("/browser-session/finish")
def finish_browser_session(request: Request):
    _require_local(request)
    with _lock:
        running = bool(
            _browser_setup_thread and _browser_setup_thread.is_alive()
        )
        if running:
            _browser_setup_stop.set()
    return {
        "requested": running,
        "message": (
            "Browser session saved. Wait for setup to close before running a batch."
            if running
            else "No browser setup session is open."
        ),
    }


@router.post("/retry-blocked")
def retry_blocked(request: Request):
    """Retry blocked items only after an explicit local user action."""
    _require_local(request)
    with _lock:
        if _worker and _worker.is_alive():
            raise HTTPException(
                status_code=409, detail="Stop the scraper before retrying items."
            )
    conn = _dashboard_db()
    try:
        with conn:
            cursor = conn.execute(
                """
                UPDATE crawl_queue
                SET status = 'pending', attempts = 0, last_error = NULL,
                    updated_at = CURRENT_TIMESTAMP
                WHERE status = 'blocked'
                """
            )
        return {"retried": cursor.rowcount, "queue": _queue_breakdown(conn)}
    finally:
        conn.close()


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


class AniListSyncRequest(BaseModel):
    pages: int = Field(default=1, ge=1, le=10)
    per_page: int = Field(default=20, ge=1, le=50)
    query: Optional[str] = None
    media_type: Literal["manga", "anime", "all"] = "manga"


@router.post("/anilist/sync")
def sync_anilist_media(req: AniListSyncRequest, request: Request):
    _require_local(request)
    from src.scraper.anilist_ingester import AniListIngester
    from src.api.main import get_db
    conn = get_db()
    try:
        ingester = AniListIngester(conn)
        ingested_ids = []
        sync_types = ["manga", "anime"] if req.media_type == "all" else [req.media_type]

        for m_type in sync_types:
            if req.query and req.query.strip():
                for p in range(1, req.pages + 1):
                    if m_type == "anime":
                        ids = ingester.sync_anime_by_query(req.query.strip(), page=p, per_page=req.per_page)
                    else:
                        ids = ingester.sync_manga_by_query(req.query.strip(), page=p, per_page=req.per_page)
                    ingested_ids.extend(ids)
            else:
                for p in range(1, req.pages + 1):
                    if m_type == "anime":
                        ids = ingester.sync_popular_anime(page=p, per_page=req.per_page)
                    else:
                        ids = ingester.sync_popular_manga(page=p, per_page=req.per_page)
                    ingested_ids.extend(ids)

        media_count = conn.execute(
            "SELECT COUNT(*) FROM novels WHERE COALESCE(source, 'novelupdates') = 'anilist'"
        ).fetchone()[0]
        return {
            "success": True,
            "ingested_count": len(ingested_ids),
            "ingested_ids": ingested_ids,
            "total_anilist_media": media_count,
            "message": f"Successfully ingested {len(ingested_ids)} AniList {req.media_type} items across {req.pages} page(s).",
        }
    finally:
        conn.close()
