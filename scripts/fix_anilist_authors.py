#!/usr/bin/env python3
"""
Rewrite the author field of AniList titles that were ingested with every staff member and
licensor. Re-fetches each title's staff and studios from AniList and stores only the creators
and animation studios chosen by src/scraper/anilist_credits.py.

Two targets:

    # The local SQLite DB
    python scripts/fix_anilist_authors.py --dry-run --limit 100
    python scripts/fix_anilist_authors.py
    python scripts/fix_anilist_authors.py --media-type anime

    # The published static dataset (a novelcompass-data checkout). Only the `author`
    # column of AniList rows in catalog.json changes; formatting is preserved.
    python scripts/fix_anilist_authors.py --catalog ../novelcompass-data/catalog.json --dry-run --limit 100
    python scripts/fix_anilist_authors.py --catalog ../novelcompass-data/catalog.json

Rebuild the static catalog afterwards if you fixed the DB.
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
import time
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from backfill_anilist_covers import graphql_query  # noqa: E402
from src.scraper.anilist_credits import extract_creators  # noqa: E402

ANIME_ID_OFFSET = 3_000_000
PREVIEW_ROWS = 15

# (catalog id, external id, title, current author)
Title = Tuple[int, int, str, str]


def fetch_new_authors(
    titles: List[Title],
    batch_size: int,
    delay: float,
    apply: Callable[[Title, str], None],
    dry_run: bool,
) -> Tuple[int, int]:
    """Look titles up on AniList and call `apply(title, new_author)` for each changed author."""
    changed = missing = 0
    for kind, is_anime in (("ANIME", True), ("MANGA", False)):
        group = [t for t in titles if (t[0] >= ANIME_ID_OFFSET) == is_anime]
        for start in range(0, len(group), batch_size):
            batch = group[start:start + batch_size]
            by_external: Dict[int, Title] = {t[1]: t for t in batch}
            result: Dict[str, Any] = {}
            for _attempt in range(4):  # graphql_query returns {} on HTTP errors, after sleeping out a 429
                time.sleep(delay)
                result = graphql_query({"ids": list(by_external), "type": kind}, delay=delay)
                if result.get("data"):
                    break
            media_list = (result.get("data") or {}).get("Page", {}).get("media") or []
            returned = set()
            for media in media_list:
                title = by_external.get(media.get("id"))
                if not title:
                    continue
                returned.add(media["id"])
                creators = extract_creators(media)
                if not creators:
                    continue  # keep the old value rather than blanking the author
                new_author = ", ".join(creators)
                if new_author == title[3]:
                    continue
                changed += 1
                if dry_run and changed <= PREVIEW_ROWS:
                    print(f"  {title[2]}: {(title[3] or '')[:70]!r} -> {new_author!r}")
                apply(title, new_author)
            missing += len(by_external) - len(returned)
            print(f"{kind} {min(start + batch_size, len(group))}/{len(group)} · {changed} changed so far", flush=True)
    return changed, missing


def run_db(db_path: str, media_type: Optional[str], limit: Optional[int], batch_size: int, delay: float, dry_run: bool) -> None:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    where = "source = 'anilist' AND external_id IS NOT NULL"
    params: List[int] = []
    if media_type == "anime":
        where += " AND id >= ?"
        params.append(ANIME_ID_OFFSET)
    elif media_type == "manga":
        where += " AND id < ?"
        params.append(ANIME_ID_OFFSET)
    rows = conn.execute(f"SELECT id, title, external_id, author FROM novels WHERE {where} ORDER BY id", params).fetchall()
    titles: List[Title] = [(r["id"], int(r["external_id"]), r["title"], r["author"] or "") for r in rows]
    if limit:
        titles = titles[:limit]
    print(f"{len(titles)} AniList titles to check{' (dry run)' if dry_run else ''}")

    def apply(title: Title, new_author: str) -> None:
        if not dry_run:
            with conn:
                conn.execute(
                    "UPDATE novels SET author = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                    (new_author, title[0]),
                )

    changed, missing = fetch_new_authors(titles, batch_size, delay, apply, dry_run)
    conn.close()
    print(f"\nDone. {changed} authors {'would change' if dry_run else 'rewritten'}, {missing} titles not returned by AniList.")


def run_catalog(path: str, media_type: Optional[str], limit: Optional[int], batch_size: int, delay: float, dry_run: bool) -> None:
    catalog_path = Path(path)
    original = catalog_path.read_text(encoding="utf-8")
    catalog: Dict[str, Any] = json.loads(original)
    fields: List[str] = catalog["fields"]
    id_i, title_i, author_i, source_i, external_i = (fields.index(k) for k in ("id", "title", "author", "source", "external_id"))

    rows_by_id: Dict[int, List[Any]] = {}
    titles: List[Title] = []
    for row in catalog["rows"]:
        if row[source_i] != "anilist" or not row[external_i]:
            continue
        if media_type == "anime" and row[id_i] < ANIME_ID_OFFSET:
            continue
        if media_type == "manga" and row[id_i] >= ANIME_ID_OFFSET:
            continue
        rows_by_id[row[id_i]] = row
        titles.append((row[id_i], int(row[external_i]), row[title_i], row[author_i] or ""))
    if limit:
        titles = titles[:limit]
    print(f"{len(titles)} AniList titles to check in {catalog_path.name}{' (dry run)' if dry_run else ''}")

    def apply(title: Title, new_author: str) -> None:
        rows_by_id[title[0]][author_i] = new_author

    changed, missing = fetch_new_authors(titles, batch_size, delay, apply, dry_run)
    if not dry_run and changed:
        # Same serialisation as the exporter (compact separators, no ASCII escaping, trailing newline).
        catalog_path.write_text(json.dumps(catalog, separators=(",", ":"), ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"\nDone. {changed} authors {'would change' if dry_run else 'rewritten'}, {missing} titles not returned by AniList.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Rewrite AniList author fields to creators and animation studios only")
    parser.add_argument("--db", default="data/recommender.db", help="SQLite DB path")
    parser.add_argument("--catalog", help="Rewrite this static catalog.json instead of the DB")
    parser.add_argument("--media-type", choices=["anime", "manga"], help="Limit to anime or to manga/novels (default: both)")
    parser.add_argument("--limit", type=int, help="Only check the first N titles")
    parser.add_argument("--batch-size", type=int, default=50)
    parser.add_argument("--delay", type=float, default=0.7)
    parser.add_argument("--dry-run", action="store_true", help="Print changes without writing them")
    args = parser.parse_args()

    target = args.catalog or args.db
    if not Path(target).exists():
        print(f"Not found: {target}", file=sys.stderr)
        sys.exit(1)
    runner = run_catalog if args.catalog else run_db
    runner(target, args.media_type, args.limit, args.batch_size, args.delay, args.dry_run)
