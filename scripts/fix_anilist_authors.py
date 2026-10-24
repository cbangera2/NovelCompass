#!/usr/bin/env python3
"""
Rewrite the author field of AniList titles that were ingested with every staff member and
licensor. Re-fetches each title's staff and studios from AniList and stores only the creators
and animation studios chosen by src/scraper/anilist_credits.py.

Usage:
    python scripts/fix_anilist_authors.py --dry-run --limit 100      # preview, writes nothing
    python scripts/fix_anilist_authors.py                            # rewrite every AniList title
    python scripts/fix_anilist_authors.py --media-type anime         # anime only

Rebuild the static catalog afterwards so the web app picks the new values up.
"""
from __future__ import annotations

import argparse
import sqlite3
import sys
import time
from pathlib import Path
from typing import Dict, List, Optional

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from backfill_anilist_covers import graphql_query  # noqa: E402
from src.scraper.anilist_credits import extract_creators  # noqa: E402

ANIME_ID_OFFSET = 3_000_000


def load_titles(conn: sqlite3.Connection, media_type: Optional[str]) -> List[sqlite3.Row]:
    where = "source = 'anilist' AND external_id IS NOT NULL"
    params: List[int] = []
    if media_type == "anime":
        where += " AND id >= ?"
        params.append(ANIME_ID_OFFSET)
    elif media_type == "manga":
        where += " AND id < ?"
        params.append(ANIME_ID_OFFSET)
    return conn.execute(f"SELECT id, title, external_id, author FROM novels WHERE {where} ORDER BY id", params).fetchall()


def run(db_path: str, media_type: Optional[str], limit: Optional[int], batch_size: int, delay: float, dry_run: bool) -> None:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    titles = load_titles(conn, media_type)
    if limit:
        titles = titles[:limit]
    print(f"{len(titles)} AniList titles to check{' (dry run)' if dry_run else ''}")

    changed = missing = 0
    for kind, is_anime in (("ANIME", True), ("MANGA", False)):
        group = [t for t in titles if (t["id"] >= ANIME_ID_OFFSET) == is_anime]
        for start in range(0, len(group), batch_size):
            batch = group[start:start + batch_size]
            by_external: Dict[int, sqlite3.Row] = {int(t["external_id"]): t for t in batch}
            time.sleep(delay)
            result = graphql_query({"ids": list(by_external), "type": kind}, delay=delay)
            media_list = (result.get("data") or {}).get("Page", {}).get("media") or []
            returned = set()
            with conn:
                for media in media_list:
                    row = by_external.get(media.get("id"))
                    if not row:
                        continue
                    returned.add(media["id"])
                    creators = extract_creators(media)
                    if not creators:
                        continue  # keep the old value rather than blanking the author
                    new_author = ", ".join(creators)
                    if new_author == row["author"]:
                        continue
                    changed += 1
                    if dry_run and changed <= 15:
                        print(f"  {row['title']}: {(row['author'] or '')[:70]!r} -> {new_author!r}")
                    if not dry_run:
                        conn.execute(
                            "UPDATE novels SET author = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                            (new_author, row["id"]),
                        )
            missing += len(by_external) - len(returned)
            print(f"{kind} {min(start + batch_size, len(group))}/{len(group)} · {changed} changed so far")
    conn.close()
    print(f"\nDone. {changed} authors {'would change' if dry_run else 'rewritten'}, {missing} titles not returned by AniList.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Rewrite AniList author fields to creators and animation studios only")
    parser.add_argument("--db", default="data/recommender.db", help="SQLite DB path")
    parser.add_argument("--media-type", choices=["anime", "manga"], help="Limit to anime or to manga/novels (default: both)")
    parser.add_argument("--limit", type=int, help="Only check the first N titles")
    parser.add_argument("--batch-size", type=int, default=50)
    parser.add_argument("--delay", type=float, default=0.7)
    parser.add_argument("--dry-run", action="store_true", help="Print changes without writing them")
    args = parser.parse_args()
    if not Path(args.db).exists():
        print(f"DB not found: {args.db}", file=sys.stderr)
        sys.exit(1)
    run(args.db, args.media_type, args.limit, args.batch_size, args.delay, args.dry_run)
