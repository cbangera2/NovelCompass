#!/usr/bin/env python3
"""
Backfill cover URLs for AniList stub entries (ingested as relation/recommendation
targets with no coverImage). Fetches full media data for each stub and updates
the DB in batches using AniList's id_in bulk query.

Usage:
    python scripts/backfill_anilist_covers.py [--db PATH] [--batch-size N] [--delay F]
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path
from typing import Any, Dict, List

ANILIST_API_URL = "https://graphql.anilist.co"

BULK_COVER_QUERY = """
query ($ids: [Int], $type: MediaType) {
  Page(page: 1, perPage: 50) {
    media(id_in: $ids, type: $type) {
      id
      type
      format
      countryOfOrigin
      coverImage { large medium }
      title { english romaji native userPreferred }
      description(asHtml: false)
      staff {
        edges { role node { name { full } } }
      }
      studios { nodes { name } }
      averageScore
      meanScore
      popularity
      favourites
      chapters
      episodes
      startDate { year }
      status
    }
  }
}
"""


def graphql_query(variables: Dict[str, Any], delay: float = 0.6) -> Dict[str, Any]:
    body = json.dumps({"query": BULK_COVER_QUERY, "variables": variables}).encode()
    req = urllib.request.Request(
        ANILIST_API_URL,
        data=body,
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "NovelCompass/1.0 (backfill-covers)",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        err = e.read().decode(errors="replace")
        print(f"  [HTTP {e.code}] {err[:200]}", file=sys.stderr)
        if e.code == 429:
            print("  Rate limited — sleeping 60s", file=sys.stderr)
            time.sleep(60)
        return {}
    except Exception as e:
        print(f"  [Error] {e}", file=sys.stderr)
        return {}


def backfill(db_path: str, batch_size: int = 50, delay: float = 0.7) -> None:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    # Gather all stubs (author='Unknown' with zeroed data) for both manga and anime
    cur.execute("""
        SELECT id, external_id, source,
               CASE WHEN id >= 3000000 THEN 'ANIME' ELSE 'MANGA' END as media_type
        FROM novels
        WHERE source = 'anilist'
          AND (author = 'Unknown' OR author IS NULL
               OR cover_url IS NULL OR cover_url = ''
               OR rating IS NULL OR rating = 0)
        ORDER BY id
    """)
    stubs = cur.fetchall()
    total = len(stubs)
    print(f"Found {total} AniList stubs without cover images")

    updated = 0
    errors = 0

    # Split into manga vs anime batches (API requires same type per query)
    manga_stubs = [s for s in stubs if s["media_type"] == "MANGA"]
    anime_stubs = [s for s in stubs if s["media_type"] == "ANIME"]

    for media_type_str, stub_list in [("MANGA", manga_stubs), ("ANIME", anime_stubs)]:
        if not stub_list:
            continue
        print(f"\nProcessing {len(stub_list)} {media_type_str} stubs in batches of {batch_size}...")

        for batch_start in range(0, len(stub_list), batch_size):
            batch = stub_list[batch_start : batch_start + batch_size]
            anilist_ids = [int(s["external_id"]) for s in batch]
            id_to_db_id = {int(s["external_id"]): s["id"] for s in batch}

            print(f"  Fetching {media_type_str} ids {anilist_ids[0]}..{anilist_ids[-1]} ({batch_start+1}-{batch_start+len(batch)}/{len(stub_list)})...", end=" ", flush=True)

            time.sleep(delay)
            result = graphql_query({"ids": anilist_ids, "type": media_type_str})

            media_list = (result.get("data") or {}).get("Page", {}).get("media") or []
            batch_updated = 0

            with conn:
                for media in media_list:
                    anilist_id = media.get("id")
                    if not anilist_id:
                        continue
                    db_id = id_to_db_id.get(anilist_id)
                    if not db_id:
                        continue

                    cover_img = (media.get("coverImage") or {}).get("large") or \
                                (media.get("coverImage") or {}).get("medium")

                    # Author / Staff
                    authors = []
                    for edge in (media.get("staff") or {}).get("edges") or []:
                        role = (edge.get("role") or "").lower()
                        if any(k in role for k in ["story", "art", "author", "original creator", "writer", "mangaka", "director"]):
                            name = (edge.get("node") or {}).get("name", {}).get("full")
                            if name and name not in authors:
                                authors.append(name)
                    for studio in (media.get("studios") or {}).get("nodes") or []:
                        sname = studio.get("name")
                        if sname and sname not in authors:
                            authors.append(sname)
                    author_str = ", ".join(authors) if authors else None

                    # Rating / popularity
                    score_100 = media.get("averageScore") or media.get("meanScore") or 0
                    rating = round(1.0 + (score_100 / 100.0) * 4.0, 2) if score_100 else None
                    popularity = media.get("popularity") or 0
                    favourites = media.get("favourites") or 0
                    scaled_readers = max(1, round(popularity * 0.10)) if popularity else None
                    scaled_votes = favourites if favourites > 0 else (max(1, round(popularity * 0.04)) if popularity else None)

                    # Chapters / episodes
                    chapters = media.get("chapters") or media.get("episodes") or None

                    # Year
                    year = (media.get("startDate") or {}).get("year") or None

                    # Synopsis
                    import html, re
                    raw_desc = media.get("description") or ""
                    if raw_desc:
                        synopsis = html.unescape(raw_desc)
                        synopsis = re.sub(r"<br\s*/?>", "\n", synopsis, flags=re.I)
                        synopsis = re.sub(r"<[^>]+>", "", synopsis).strip()
                    else:
                        synopsis = None

                    # Status
                    status_map = {"FINISHED": "Completed", "RELEASING": "Ongoing", "NOT_YET_RELEASED": "Upcoming", "CANCELLED": "Cancelled", "HIATUS": "Hiatus"}
                    status_raw = (media.get("status") or "").upper()
                    status_trans = status_map.get(status_raw) or None

                    # Build UPDATE — only overwrite fields that have real values
                    updates = []
                    params = []
                    if cover_img:
                        updates.append("cover_url = ?"); params.append(cover_img)
                    if author_str:
                        updates.append("author = CASE WHEN author IS NULL OR author='Unknown' THEN ? ELSE author END"); params.append(author_str)
                    if rating:
                        updates.append("rating = CASE WHEN rating IS NULL OR rating=0 THEN ? ELSE rating END"); params.append(rating)
                    if scaled_votes:
                        updates.append("rating_votes = CASE WHEN rating_votes IS NULL OR rating_votes=0 THEN ? ELSE rating_votes END"); params.append(scaled_votes)
                    if scaled_readers:
                        updates.append("reading_list_count = CASE WHEN reading_list_count IS NULL OR reading_list_count=0 THEN ? ELSE reading_list_count END"); params.append(scaled_readers)
                    if chapters:
                        updates.append("chapters_trans = CASE WHEN chapters_trans IS NULL OR chapters_trans=0 THEN ? ELSE chapters_trans END"); params.append(chapters)
                        updates.append("chapters_orig = CASE WHEN chapters_orig IS NULL OR chapters_orig=0 THEN ? ELSE chapters_orig END"); params.append(chapters)
                    if year:
                        updates.append("year = CASE WHEN year IS NULL THEN ? ELSE year END"); params.append(year)
                    if synopsis:
                        updates.append("synopsis = CASE WHEN synopsis IS NULL OR synopsis='' THEN ? ELSE synopsis END"); params.append(synopsis)
                    if status_trans:
                        updates.append("status_trans = CASE WHEN status_trans IS NULL THEN ? ELSE status_trans END"); params.append(status_trans)

                    if updates:
                        updates.append("updated_at = CURRENT_TIMESTAMP")
                        params.append(db_id)
                        cur.execute(f"UPDATE novels SET {', '.join(updates)} WHERE id = ?", params)
                        if cover_img:
                            batch_updated += 1
                            updated += 1

            if not media_list:
                errors += 1

            print(f"updated {batch_updated}/{len(batch)}")

    conn.close()
    print(f"\nDone. Updated {updated}/{total} entries. Errors: {errors}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Backfill AniList cover URLs for stub entries")
    parser.add_argument("--db", default="data/recommender.db", help="SQLite DB path")
    parser.add_argument("--batch-size", type=int, default=50, help="AniList IDs per API request")
    parser.add_argument("--delay", type=float, default=0.7, help="Seconds between API requests")
    args = parser.parse_args()

    db = args.db
    if not Path(db).exists():
        print(f"DB not found: {db}", file=sys.stderr)
        sys.exit(1)

    backfill(db, batch_size=args.batch_size, delay=args.delay)
