import sqlite3
import json
from urllib.parse import urlsplit, urlunsplit
from typing import Dict, Any, List, Optional

class Repository:
    def __init__(self, conn: sqlite3.Connection):
        self.conn = conn

    def upsert_novel(self, novel_data: Dict[str, Any]) -> int:
        if not novel_data.get("id"):
            raise ValueError("Novel Updates numeric id is required")
        if not novel_data.get("title"):
            raise ValueError("Novel title is required")
        with self.conn:
            cur = self.conn.cursor()
            cur.execute("""
                INSERT INTO novels (
                    id, slug, title, associated_names, author, language, synopsis,
                    rating, rating_votes, reading_list_count, chapters_orig,
                    chapters_trans, status_trans, year, cover_url, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(id) DO UPDATE SET
                    slug=COALESCE(excluded.slug, novels.slug),
                    title=excluded.title,
                    associated_names=excluded.associated_names,
                    author=excluded.author,
                    language=excluded.language,
                    synopsis=excluded.synopsis,
                    rating=excluded.rating,
                    rating_votes=excluded.rating_votes,
                    reading_list_count=excluded.reading_list_count,
                    chapters_orig=excluded.chapters_orig,
                    chapters_trans=excluded.chapters_trans,
                    status_trans=excluded.status_trans,
                    year=excluded.year,
                    cover_url=excluded.cover_url,
                    updated_at=CURRENT_TIMESTAMP
            """, (
                novel_data.get('id'),
                novel_data.get('slug'),
                novel_data.get('title'),
                json.dumps(novel_data.get('associated_names', [])),
                novel_data.get('author'),
                novel_data.get('language'),
                novel_data.get('synopsis'),
                novel_data.get('rating', 0.0),
                novel_data.get('rating_votes', 0),
                novel_data.get('reading_list_count', 0),
                novel_data.get('chapters_orig', 0),
                novel_data.get('chapters_trans', 0),
                novel_data.get('status_trans'),
                novel_data.get('year'),
                novel_data.get('cover_url')
            ))
            novel_id = novel_data.get('id') or cur.lastrowid

            # A successful live page is authoritative for current taxonomy.
            cur.execute("DELETE FROM novel_tags WHERE novel_id = ?", (novel_id,))
            for tag_name in novel_data.get('tags', []):
                cur.execute("INSERT OR IGNORE INTO tags (name) VALUES (?)", (tag_name,))
                cur.execute("SELECT id FROM tags WHERE name = ?", (tag_name,))
                tag_id = cur.fetchone()[0]
                cur.execute("INSERT OR IGNORE INTO novel_tags (novel_id, tag_id) VALUES (?, ?)", (novel_id, tag_id))

            cur.execute("DELETE FROM novel_genres WHERE novel_id = ?", (novel_id,))
            for genre_name in novel_data.get('genres', []):
                cur.execute("INSERT OR IGNORE INTO genres (name) VALUES (?)", (genre_name,))
                cur.execute("SELECT id FROM genres WHERE name = ?", (genre_name,))
                genre_id = cur.fetchone()[0]
                cur.execute("INSERT OR IGNORE INTO novel_genres (novel_id, genre_id) VALUES (?, ?)", (novel_id, genre_id))

            return novel_id

    def replace_novel_relationships(
        self,
        source_novel_id: int,
        direct_recs: List[Dict[str, Any]],
        related_series: List[Dict[str, Any]],
    ) -> None:
        with self.conn:
            cur = self.conn.cursor()
            cur.execute(
                "DELETE FROM direct_recs WHERE source_novel_id = ?",
                (source_novel_id,),
            )
            cur.execute(
                "DELETE FROM related_series WHERE source_novel_id = ?",
                (source_novel_id,),
            )
            for rec in direct_recs:
                target_id = rec.get("id")
                if target_id and target_id != source_novel_id:
                    cur.execute(
                        """
                        INSERT OR REPLACE INTO direct_recs
                            (source_novel_id, target_novel_id, is_mutual, votes)
                        VALUES (?, ?, 0, ?)
                        """,
                        (source_novel_id, target_id, rec.get("votes", 1)),
                    )
            for rel in related_series:
                target_id = rel.get("id")
                if target_id and target_id != source_novel_id:
                    cur.execute(
                        """
                        INSERT OR REPLACE INTO related_series
                            (source_novel_id, target_novel_id, relation_type)
                        VALUES (?, ?, ?)
                        """,
                        (
                            source_novel_id,
                            target_id,
                            rel.get("relation_type", "related"),
                        ),
                    )
            cur.execute(
                """
                UPDATE direct_recs
                SET is_mutual = EXISTS (
                    SELECT 1 FROM direct_recs reverse
                    WHERE reverse.source_novel_id = direct_recs.target_novel_id
                      AND reverse.target_novel_id = direct_recs.source_novel_id
                )
                WHERE source_novel_id = ?
                   OR target_novel_id = ?
                """,
                (source_novel_id, source_novel_id),
            )

    def upsert_rec_list(self, list_data: Dict[str, Any]) -> int:
        with self.conn:
            cur = self.conn.cursor()
            cur.execute("""
                INSERT INTO rec_lists (id, title, description, curator, followers, item_count, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(id) DO UPDATE SET
                    title=excluded.title,
                    description=excluded.description,
                    curator=excluded.curator,
                    followers=excluded.followers,
                    item_count=excluded.item_count,
                    updated_at=CURRENT_TIMESTAMP
            """, (
                list_data.get('id'),
                list_data.get('title'),
                list_data.get('description'),
                list_data.get('curator'),
                list_data.get('followers', 0),
                len(list_data.get('items', []))
            ))
            list_id = list_data.get('id')

            cur.execute("DELETE FROM rec_list_items WHERE list_id = ?", (list_id,))
            for item in list_data.get('items', []):
                # If item novel ID is known, insert item
                novel_id = item.get('novel_id')
                if novel_id:
                    cur.execute("""
                        INSERT INTO rec_list_items (list_id, novel_id, position, tier, comment)
                        VALUES (?, ?, ?, ?, ?)
                        ON CONFLICT(list_id, novel_id) DO UPDATE SET
                            position=excluded.position,
                            tier=excluded.tier,
                            comment=excluded.comment
                    """, (list_id, novel_id, item.get('position'), item.get('tier'), item.get('comment')))

            return list_id

    @staticmethod
    def canonicalize_url(url: str) -> str:
        parts = urlsplit(url.strip())
        host = (parts.hostname or "").lower()
        if host not in {"novelupdates.com", "www.novelupdates.com"}:
            raise ValueError(f"Refusing out-of-scope crawl URL host: {host}")
        path = "/" + "/".join(segment for segment in parts.path.split("/") if segment)
        if path.startswith("/series/") or path.startswith("/viewlist/"):
            path += "/"
        return urlunsplit(("https", "www.novelupdates.com", path or "/", parts.query, ""))

    def add_to_crawl_queue(
        self,
        url: str,
        item_type: str,
        item_id: Optional[int] = None,
        priority: int = 0,
        phase: str = "refresh_existing",
    ):
        url = self.canonicalize_url(url)
        with self.conn:
            self.conn.execute("""
                INSERT INTO crawl_queue
                    (url, type, item_id, priority, phase, status)
                VALUES (?, ?, ?, ?, ?, 'pending')
                ON CONFLICT(url) DO UPDATE SET
                    item_id=COALESCE(crawl_queue.item_id, excluded.item_id),
                    priority=MAX(crawl_queue.priority, excluded.priority),
                    phase=CASE
                        WHEN crawl_queue.phase = 'refresh_existing'
                        THEN excluded.phase
                        ELSE crawl_queue.phase
                    END
            """, (url, item_type, item_id, priority, phase))

    def add_discovered_novel(
        self, url: str, item_id: Optional[int], priority: int = 30
    ) -> str:
        """Queue absent novels ahead of baseline refreshes."""
        known = None
        if item_id is not None:
            known = self.conn.execute(
                "SELECT 1 FROM novels WHERE id = ?", (item_id,)
            ).fetchone()
        phase = "refresh_existing" if known else "new_novel"
        self.add_to_crawl_queue(url, "novel", item_id, priority, phase)
        return phase

    def claim_next_queue_item(self, max_attempts: int = 4) -> Optional[sqlite3.Row]:
        with self.conn:
            row = self.conn.execute(
                """
                SELECT * FROM crawl_queue
                WHERE status = 'pending' AND attempts < ?
                ORDER BY CASE
                    WHEN phase = 'refresh_existing' THEN 1
                    ELSE 0
                END,
                priority DESC,
                CASE phase
                    WHEN 'new_novel' THEN 0
                    WHEN 'discovery' THEN 1
                    ELSE 2
                END,
                id ASC
                LIMIT 1
                """,
                (max_attempts,),
            ).fetchone()
            if row is None:
                return None
            self.conn.execute(
                """
                UPDATE crawl_queue
                SET status = 'in_progress', attempts = attempts + 1,
                    last_error = NULL, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (row["id"],),
            )
            return self.conn.execute(
                "SELECT * FROM crawl_queue WHERE id = ?", (row["id"],)
            ).fetchone()

    def recover_interrupted_items(self) -> int:
        with self.conn:
            cur = self.conn.execute(
                """
                UPDATE crawl_queue SET status = 'pending',
                    last_error = COALESCE(last_error, 'interrupted'),
                    updated_at = CURRENT_TIMESTAMP
                WHERE status = 'in_progress'
                """
            )
            return cur.rowcount

    def update_queue_status(self, queue_id: int, status: str, error: str = None):
        with self.conn:
            self.conn.execute("""
                UPDATE crawl_queue
                SET status = ?, last_error = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            """, (status, error, queue_id))

    def retry_queue_item(self, queue_id: int, error: str) -> None:
        with self.conn:
            self.conn.execute(
                """
                UPDATE crawl_queue SET status = 'pending', last_error = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (error[:1000], queue_id),
            )

    def complete_novel_aliases(
        self, novel_id: int, slug: str, current_queue_id: int
    ) -> None:
        canonical_url = self.canonicalize_url(
            f"https://www.novelupdates.com/series/{slug}/"
        )
        numeric_url = self.canonicalize_url(
            f"https://www.novelupdates.com/?p={novel_id}"
        )
        with self.conn:
            self.conn.execute(
                """
                UPDATE crawl_queue SET status = 'complete', last_error = NULL,
                    item_id = COALESCE(item_id, ?),
                    updated_at = CURRENT_TIMESTAMP
                WHERE type = 'novel' AND (
                    id = ? OR item_id = ? OR url IN (?, ?)
                )
                """,
                (
                    novel_id,
                    current_queue_id,
                    novel_id,
                    canonical_url,
                    numeric_url,
                ),
            )

    def queue_counts(self) -> Dict[str, int]:
        return {
            row["status"]: row["count"]
            for row in self.conn.execute(
                "SELECT status, COUNT(*) AS count FROM crawl_queue GROUP BY status"
            )
        }

    def start_scrape_run(self) -> int:
        with self.conn:
            cur = self.conn.execute(
                "INSERT INTO scrape_runs(status) VALUES ('running')"
            )
            return cur.lastrowid

    def update_scrape_run(
        self,
        run_id: int,
        *,
        pages_scraped: int,
        pages_cached: int,
        pages_discovered: int,
        errors: int,
        status: str = "running",
        stop_reason: Optional[str] = None,
        finished: bool = False,
    ) -> None:
        with self.conn:
            self.conn.execute(
                """
                UPDATE scrape_runs SET status = ?, pages_scraped = ?,
                    pages_cached = ?, pages_discovered = ?, errors = ?,
                    stop_reason = ?, heartbeat_at = CURRENT_TIMESTAMP,
                    finished_at = CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE NULL END
                WHERE id = ?
                """,
                (
                    status,
                    pages_scraped,
                    pages_cached,
                    pages_discovered,
                    errors,
                    stop_reason,
                    int(finished),
                    run_id,
                ),
            )
