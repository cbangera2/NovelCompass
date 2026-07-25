import os
import json
import gzip
import sqlite3
import re
import unicodedata
from typing import List, Dict, Any

DATASET_JSON_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
    "supporting",
    "seed",
    "novels_0.1.5.json.gz",
)

# Core seed lists from problem statement
SEED_LIST_IDS = [83544, 94083, 83473, 115510]
CBBOSS_PROFILE_URL = "https://www.novelupdates.com/user/546333/cbboss/"

def _slugify(value: str) -> str:
    value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")


def _first_int(value: Any) -> int:
    if isinstance(value, (int, float)):
        return int(value)
    match = re.search(r"\d[\d,]*", str(value or ""))
    return int(match.group(0).replace(",", "")) if match else 0


def seed_database_from_dataset(
    conn: sqlite3.Connection,
    max_novels: int | None = None,
    seed_crawl_queue: bool = True,
) -> int:
    """
    Import the local novel-dataset snapshot into the application schema.

    The snapshot is a bootstrap catalog, not the final scrape. Importing its graph
    and list membership fields makes the recommender useful before a fresh crawl
    has completed.
    """
    if not os.path.exists(DATASET_JSON_PATH):
        print(f"Dataset file not found at {DATASET_JSON_PATH}")
        return 0

    print(f"Loading seed dataset from {DATASET_JSON_PATH}...")
    with gzip.open(DATASET_JSON_PATH, "rt", encoding="utf-8") as f:
        novels_data = json.load(f)

    # Convert dictionary or list
    if isinstance(novels_data, dict):
        novel_list = list(novels_data.values())
    else:
        novel_list = novels_data

    print(f"Total novels in dataset snapshot: {len(novel_list)}")

    selected = novel_list if max_novels is None else novel_list[:max_novels]
    valid_items = [
        item for item in selected
        if (item.get("id") or item.get("series_id")) and (item.get("title") or item.get("name"))
    ]
    known_ids = {int(item.get("id") or item.get("series_id")) for item in valid_items}
    cur = conn.cursor()

    with conn:
        if seed_crawl_queue:
            for list_id in SEED_LIST_IDS:
                cur.execute("""
                    INSERT OR IGNORE INTO crawl_queue
                        (url, type, item_id, priority, phase, status)
                    VALUES (?, 'rec_list', ?, 100, 'discovery', 'pending')
                """, (f"https://www.novelupdates.com/viewlist/{list_id}/", list_id))

        seen_slugs = set()
        novel_rows = []
        item_by_id = {}
        for item in valid_items:
            novel_id = int(item.get("id") or item.get("series_id"))
            title = item.get("title") or item.get("name")
            slug = item.get("slug") or _slugify(title) or f"novel-{novel_id}"
            if slug in seen_slugs:
                slug = f"{slug}-{novel_id}"
            seen_slugs.add(slug)
            item_by_id[novel_id] = (item, slug)

            authors = item.get("authors") or item.get("author") or []
            if isinstance(authors, str):
                author = authors
            else:
                author = ", ".join(authors)

            associated_names = item.get("assoc_names", item.get("associated_names", []))
            novel_rows.append((
                novel_id,
                slug,
                title,
                json.dumps(associated_names or [], ensure_ascii=False),
                author,
                item.get("original_language", item.get("language", "")),
                item.get("synopsis", item.get("description", "")) or "",
                float(item.get("rating", 0.0) or 0.0),
                int(item.get("rating_votes", 0) or 0),
                int(item.get("on_reading_lists", item.get("reading_list_count", 0)) or 0),
                _first_int(item.get("chapters_original_current", item.get("chapters_orig", 0))),
                _first_int(item.get("chapters_translated_current", item.get("chapters_trans", 0))),
                "completed" if item.get("complete_translated") else "",
                _first_int(item.get("start_year", item.get("year"))),
                item.get("cover_url", ""),
            ))

        cur.executemany("""
            INSERT INTO novels (
                id, slug, title, associated_names, author, language, synopsis,
                rating, rating_votes, reading_list_count, chapters_orig,
                chapters_trans, status_trans, year, cover_url, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(id) DO UPDATE SET
                slug=excluded.slug,
                title=excluded.title,
                associated_names=excluded.associated_names,
                author=excluded.author,
                language=excluded.language,
                synopsis=CASE WHEN excluded.synopsis != '' THEN excluded.synopsis ELSE novels.synopsis END,
                rating=excluded.rating,
                rating_votes=excluded.rating_votes,
                reading_list_count=excluded.reading_list_count,
                chapters_orig=excluded.chapters_orig,
                chapters_trans=excluded.chapters_trans,
                status_trans=excluded.status_trans,
                year=excluded.year,
                cover_url=excluded.cover_url,
                updated_at=CURRENT_TIMESTAMP
        """, novel_rows)

        tag_names = sorted({
            tag.strip().lower()
            for item, _ in item_by_id.values()
            for tag in (item.get("tags") or [])
            if tag and tag.strip()
        })
        genre_names = sorted({
            genre.strip().lower()
            for item, _ in item_by_id.values()
            for genre in (item.get("genres") or [])
            if genre and genre.strip()
        })
        cur.executemany("INSERT OR IGNORE INTO tags (name) VALUES (?)", [(name,) for name in tag_names])
        cur.executemany("INSERT OR IGNORE INTO genres (name) VALUES (?)", [(name,) for name in genre_names])
        tag_ids = dict(cur.execute("SELECT name, id FROM tags"))
        genre_ids = dict(cur.execute("SELECT name, id FROM genres"))

        novel_tag_rows = {
            (novel_id, tag_ids[tag.strip().lower()])
            for novel_id, (item, _) in item_by_id.items()
            for tag in (item.get("tags") or [])
            if tag and tag.strip().lower() in tag_ids
        }
        novel_genre_rows = {
            (novel_id, genre_ids[genre.strip().lower()])
            for novel_id, (item, _) in item_by_id.items()
            for genre in (item.get("genres") or [])
            if genre and genre.strip().lower() in genre_ids
        }
        cur.executemany(
            "INSERT OR IGNORE INTO novel_tags (novel_id, tag_id) VALUES (?, ?)",
            novel_tag_rows,
        )
        cur.executemany(
            "INSERT OR IGNORE INTO novel_genres (novel_id, genre_id) VALUES (?, ?)",
            novel_genre_rows,
        )

        direct_rec_rows = {
            (source_id, int(target_id))
            for source_id, (item, _) in item_by_id.items()
            for target_id in (item.get("recommended_series_ids") or [])
            if int(target_id) in known_ids and int(target_id) != source_id
        }
        related_rows = {
            (source_id, int(target_id), "related")
            for source_id, (item, _) in item_by_id.items()
            for target_id in (item.get("related_series_ids") or [])
            if int(target_id) in known_ids and int(target_id) != source_id
        }
        cur.executemany("""
            INSERT OR IGNORE INTO direct_recs
                (source_novel_id, target_novel_id, is_mutual, votes)
            VALUES (?, ?, 0, 1)
        """, direct_rec_rows)
        cur.executemany("""
            INSERT OR IGNORE INTO related_series
                (source_novel_id, target_novel_id, relation_type)
            VALUES (?, ?, ?)
        """, related_rows)

        direct_rec_pairs = set(direct_rec_rows)
        mutual_rows = [
            (source_id, target_id)
            for source_id, target_id in direct_rec_pairs
            if (target_id, source_id) in direct_rec_pairs
        ]
        cur.executemany("""
            UPDATE direct_recs SET is_mutual = 1
            WHERE source_novel_id = ? AND target_novel_id = ?
        """, mutual_rows)

        list_ids = {
            int(list_id)
            for item, _ in item_by_id.values()
            for list_id in (item.get("recommendation_list_ids") or [])
        }
        cur.executemany("""
            INSERT OR IGNORE INTO rec_lists (id, title)
            VALUES (?, ?)
        """, [(list_id, f"Novel Updates List {list_id}") for list_id in list_ids])
        rec_list_rows = {
            (int(list_id), novel_id)
            for novel_id, (item, _) in item_by_id.items()
            for list_id in (item.get("recommendation_list_ids") or [])
        }
        cur.executemany("""
            INSERT OR IGNORE INTO rec_list_items (list_id, novel_id)
            VALUES (?, ?)
        """, rec_list_rows)

        if seed_crawl_queue:
            # The legacy dataset has numeric ids but no authoritative slugs.
            # Remove only untouched, low-priority synthesized rows from older
            # builds; the numeric endpoint redirects to the site's canonical URL.
            cur.execute(
                """
                DELETE FROM crawl_queue
                WHERE status = 'pending' AND attempts = 0 AND priority = 10
                  AND type = 'novel'
                  AND url LIKE 'https://www.novelupdates.com/series/%'
                  AND item_id IN (SELECT id FROM novels)
                """
            )
            queue_rows = [
                (
                    f"https://www.novelupdates.com/?p={novel_id}",
                    novel_id,
                )
                for novel_id, (_, slug) in item_by_id.items()
            ]
            cur.executemany("""
                INSERT OR IGNORE INTO crawl_queue
                    (url, type, item_id, priority, phase, status)
                VALUES (?, 'novel', ?, 10, 'refresh_existing', 'pending')
            """, queue_rows)

            # Independent discovery sources find novels absent from the snapshot.
            cur.executemany(
                """
                INSERT OR IGNORE INTO crawl_queue
                    (url, type, priority, phase, status)
                VALUES (?, 'discovery', 90, 'discovery', 'pending')
                """,
                [
                    (
                        "https://www.novelupdates.com/"
                        "series-ranking/?rank=sixmonths&pg=1",
                    ),
                    ("https://www.novelupdates.com/latest-series/?st=1&pg=1",),
                ],
            )

    print(
        f"Seeded {len(novel_rows)} novels, {len(novel_tag_rows)} tag links, "
        f"{len(direct_rec_rows)} recommendation edges, and "
        f"{len(rec_list_rows)} list memberships."
    )
    return len(novel_rows)

if __name__ == '__main__':
    from src.db.schema import init_db
    conn = init_db()
    seed_database_from_dataset(conn)
