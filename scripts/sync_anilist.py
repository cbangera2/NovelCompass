"""Standalone script to sync AniList popular anime and manga data (including community direct recommendations and franchise relations) into recommender.db."""

from __future__ import annotations

import argparse
import sys
import os
import time
from datetime import datetime
from pathlib import Path

# Add project root to sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from src.db.schema import DEFAULT_DB_PATH, get_connection
from src.scraper.anilist_client import AniListClient
from src.scraper.anilist_ingester import AniListIngester


def log(msg: str) -> None:
    ts = datetime.now().strftime("%H:%M:%S")
    print(f"[{ts}] {msg}", flush=True)


def sync_anilist(
    pages: int = 10,
    per_page: int = 50,
    media_type: str = "all",
    db_path: str = DEFAULT_DB_PATH,
) -> None:
    log(f"Connecting to database at {db_path}...")
    conn = get_connection(db_path)
    client = AniListClient()
    ingester = AniListIngester(conn, client)

    sync_types = ["anime", "manga"] if media_type == "all" else [media_type]

    total_ingested = 0
    t_start = time.perf_counter()

    try:
        for m_type in sync_types:
            log(f"--- Starting {m_type.upper()} sync ({pages} page(s), {per_page} items/page) ---")
            for p in range(1, pages + 1):
                log(f"Fetching page {p}/{pages} for {m_type}...")
                if m_type == "anime":
                    ingested_ids = ingester.sync_popular_anime(page=p, per_page=per_page)
                else:
                    ingested_ids = ingester.sync_popular_manga(page=p, per_page=per_page)
                
                total_ingested += len(ingested_ids)
                log(f"✓ Page {p}/{pages} [{m_type}]: Ingested {len(ingested_ids)} items (Total so far: {total_ingested})")

        # Summary stats
        anilist_count = conn.execute(
            "SELECT COUNT(*) FROM novels WHERE COALESCE(source, 'novelupdates') = 'anilist'"
        ).fetchone()[0]
        rec_count = conn.execute(
            """SELECT COUNT(*) FROM direct_recs d 
               JOIN novels n ON d.source_novel_id = n.id 
               WHERE n.source = 'anilist'"""
        ).fetchone()[0]
        rel_count = conn.execute(
            """SELECT COUNT(*) FROM related_series r 
               JOIN novels n ON r.source_novel_id = n.id 
               WHERE n.source = 'anilist'"""
        ).fetchone()[0]

        elapsed = time.perf_counter() - t_start
        log("==================================================")
        log(f"✓ Sync complete in {elapsed:.1f}s!")
        log(f"  Total items ingested in run: {total_ingested}")
        log(f"  Total AniList items in DB:   {anilist_count}")
        log(f"  AniList Direct Recs in DB:   {rec_count}")
        log(f"  AniList Related Series in DB: {rel_count}")
        log("==================================================")
    finally:
        conn.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Sync AniList anime/manga metadata & recommendations into recommender.db")
    parser.add_argument("--pages", type=int, default=10, help="Number of pages to sync (default: 10)")
    parser.add_argument("--per-page", type=int, default=50, help="Items per page (default: 50, max 50)")
    parser.add_argument("--media-type", choices=["anime", "manga", "all"], default="all", help="Media type to sync (default: all)")
    parser.add_argument("--db", default=DEFAULT_DB_PATH, help=f"Path to SQLite database (default: {DEFAULT_DB_PATH})")

    args = parser.parse_args()
    sync_anilist(pages=args.pages, per_page=args.per_page, media_type=args.media_type, db_path=args.db)


if __name__ == "__main__":
    main()
