"""Standalone script to sync AniList popular anime and manga data (including community direct recommendations and franchise relations) into recommender.db."""

from __future__ import annotations

import argparse
import sys
import os
from pathlib import Path

# Add project root to sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from src.db.schema import DEFAULT_DB_PATH, get_connection
from src.scraper.anilist_client import AniListClient
from src.scraper.anilist_ingester import AniListIngester


def sync_anilist(
    pages: int = 10,
    per_page: int = 50,
    media_type: str = "all",
    db_path: str = DEFAULT_DB_PATH,
) -> None:
    print(f"Connecting to database at {db_path}...")
    conn = get_connection(db_path)
    client = AniListClient()
    ingester = AniListIngester(conn, client)

    sync_types = ["anime", "manga"] if media_type == "all" else [media_type]

    total_ingested = 0
    try:
        for m_type in sync_types:
            print(f"\n--- Syncing {m_type.upper()} ({pages} page(s), {per_page} items/page) ---")
            for p in range(1, pages + 1):
                if m_type == "anime":
                    ingested_ids = ingester.sync_popular_anime(page=p, per_page=per_page)
                else:
                    ingested_ids = ingester.sync_popular_manga(page=p, per_page=per_page)
                total_ingested += len(ingested_ids)
                print(f"Page {p}/{pages} [{m_type}]: Ingested {len(ingested_ids)} items (IDs: {ingested_ids[:3]}...)")

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

        print("\n==================================================")
        print(f"✓ Sync complete!")
        print(f"  Total items ingested in run: {total_ingested}")
        print(f"  Total AniList items in DB:   {anilist_count}")
        print(f"  AniList Direct Recs in DB:   {rec_count}")
        print(f"  AniList Related Series in DB: {rel_count}")
        print("==================================================")
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
