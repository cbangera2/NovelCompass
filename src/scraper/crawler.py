import argparse
import json
import os
import signal
import sqlite3
import sys
import time
import urllib.robotparser
from dataclasses import dataclass
from pathlib import Path
from typing import Optional
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from src.db.schema import DEFAULT_DB_PATH, init_db
from src.db.repository import Repository
from src.scraper.client import (
    DEFAULT_BROWSER_PROFILE,
    BrowserSessionTransport,
    ScraperClient,
)
from src.scraper.html_parser import (
    parse_discovery_page,
    parse_series_page,
    parse_viewlist_page,
)
from src.scraper.seed_loader import seed_database_from_dataset


@dataclass
class CrawlStats:
    scraped: int = 0
    cached: int = 0
    discovered: int = 0
    errors: int = 0


class Crawler:
    def __init__(
        self,
        db_conn: sqlite3.Connection,
        *,
        delay_range: tuple[float, float] = (3.0, 5.5),
        max_attempts: int = 4,
        client: Optional[ScraperClient] = None,
        ignore_robots: bool = False,
        mobile_mode: bool = False,
    ):
        self.repo = Repository(db_conn)
        self.client = client or ScraperClient(delay_range=delay_range)
        self.max_attempts = max_attempts
        self.stop_requested = False
        self.ignore_robots = ignore_robots
        self.mobile_mode = mobile_mode

    def request_stop(self, *_args) -> None:
        self.stop_requested = True

    @staticmethod
    def _pagination_url(url: str, page: int) -> str:
        parts = urlsplit(url)
        query = dict(parse_qsl(parts.query, keep_blank_values=True))
        query["pg"] = str(page)
        return urlunsplit(
            (parts.scheme, parts.netloc, parts.path, urlencode(query), "")
        )

    def _queue_series_links(self, links, priority: int) -> int:
        before = self.repo.queue_counts()
        before_total = sum(before.values())
        for link in links:
            self.repo.add_discovered_novel(
                link["url"],
                item_id=link.get("id"),
                priority=priority,
            )
        after_total = sum(self.repo.queue_counts().values())
        return max(0, after_total - before_total)

    def _process_item(self, item, html_text: str) -> int:
        url = item["url"]
        item_type = item["type"]
        discovered = 0
        if item_type == "novel":
            novel_data = parse_series_page(html_text, url=url)
            novel_id = self.repo.upsert_novel(novel_data)
            self.repo.replace_novel_relationships(
                novel_id,
                novel_data.get("direct_recs", []),
                novel_data.get("related_series", []),
            )
            discovered += self._queue_series_links(
                novel_data.get("direct_recs", []), priority=40
            )
            discovered += self._queue_series_links(
                novel_data.get("related_series", []), priority=35
            )
            for list_id in novel_data.get("recommendation_list_ids", []):
                before = sum(self.repo.queue_counts().values())
                self.repo.add_to_crawl_queue(
                    f"https://www.novelupdates.com/viewlist/{list_id}/",
                    "rec_list",
                    item_id=list_id,
                    priority=15,
                )
                after = sum(self.repo.queue_counts().values())
                discovered += max(0, after - before)
            self.repo.complete_novel_aliases(
                novel_id, novel_data["slug"], item["id"]
            )
        elif item_type == "rec_list":
            list_data = parse_viewlist_page(
                html_text, list_id=item["item_id"]
            )
            if not list_data.get("title"):
                raise ValueError("Recommendation list page has no title")
            self.repo.upsert_rec_list(list_data)
            discovered += self._queue_series_links(
                [
                    {
                        "id": list_item.get("novel_id"),
                        "slug": list_item["slug"],
                        "url": (
                            "https://www.novelupdates.com/series/"
                            f"{list_item['slug']}/"
                        ),
                    }
                    for list_item in list_data.get("items", [])
                    if list_item.get("slug")
                ],
                priority=50,
            )
        elif item_type == "discovery":
            page = parse_discovery_page(html_text, url)
            if not page["series"]:
                raise ValueError("Discovery page contained no series links")
            discovered += self._queue_series_links(page["series"], priority=30)
            if dict(parse_qsl(urlsplit(url).query)).get("pg") == "1":
                for page_number in range(2, page["max_page"] + 1):
                    before = sum(self.repo.queue_counts().values())
                    self.repo.add_to_crawl_queue(
                        self._pagination_url(url, page_number),
                        "discovery",
                        priority=80,
                        phase="discovery",
                    )
                    after = sum(self.repo.queue_counts().values())
                    discovered += max(0, after - before)
        else:
            raise ValueError(f"Unknown crawl item type: {item_type}")
        return discovered

    def run_queue(self, max_items: Optional[int] = None) -> dict:
        recovered = self.repo.recover_interrupted_items()
        run_id = self.repo.start_scrape_run()
        stats = CrawlStats()
        reason = None
        status = "running"
        if not self.ignore_robots:
            robots_text, robots_status, _ = self.client.fetch(
                "https://www.novelupdates.com/robots.txt"
            )
            if robots_status != 200 or not robots_text:
                status, reason = "aborted", f"robots.txt unavailable (HTTP {robots_status})"
                self.repo.update_scrape_run(
                    run_id,
                    pages_scraped=0,
                    pages_cached=0,
                    pages_discovered=0,
                    errors=1,
                    status=status,
                    stop_reason=reason,
                    finished=True,
                )
                result = {
                    "event": "crawl_finished",
                    "run_id": run_id,
                    "status": status,
                    "reason": reason,
                    "network": 0,
                    "cache": 0,
                    "discovered": 0,
                    "errors": 1,
                    "queue": self.repo.queue_counts(),
                }
                print(json.dumps(result), flush=True)
                return result
            robots = urllib.robotparser.RobotFileParser()
            robots.set_url("https://www.novelupdates.com/robots.txt")
            robots.parse(robots_text.splitlines())
            disallowed = next(
                (
                    row[0]
                    for row in self.repo.conn.execute(
                        """
                        SELECT url FROM crawl_queue
                        WHERE status = 'pending'
                        ORDER BY priority DESC, id ASC
                        """
                    )
                    if not robots.can_fetch(self.client.headers["User-Agent"], row[0])
                ),
                None,
            )
            if disallowed:
                status, reason = "aborted", "robots.txt disallows a queued URL"
                self.repo.update_scrape_run(
                    run_id,
                    pages_scraped=0,
                    pages_cached=0,
                    pages_discovered=0,
                    errors=1,
                    status=status,
                    stop_reason=reason,
                    finished=True,
                )
                result = {
                    "event": "crawl_finished",
                    "run_id": run_id,
                    "status": status,
                    "reason": reason,
                    "network": 0,
                    "cache": 0,
                    "discovered": 0,
                    "errors": 1,
                    "queue": self.repo.queue_counts(),
                }
                print(json.dumps(result), flush=True)
                return result
        print(
            json.dumps(
                {
                    "event": "crawl_started",
                    "run_id": run_id,
                    "recovered": recovered,
                    "queue": self.repo.queue_counts(),
                }
            ),
            flush=True,
        )

        consecutive_blocks = 0
        try:
            while not self.stop_requested:
                if max_items is not None and stats.scraped + stats.cached >= max_items:
                    status, reason = "partial", "item limit reached"
                    break
                item = self.repo.claim_next_queue_item(self.max_attempts)
                if item is None:
                    counts = self.repo.queue_counts()
                    if counts.get("failed", 0) or counts.get("blocked", 0):
                        status, reason = "partial", "queue exhausted with errors"
                    else:
                        status = "complete"
                    break

                html_text, http_status, from_cache = self.client.fetch(item["url"])
                if http_status in {401, 403, 429}:
                    queue_status = "blocked" if http_status in {401, 403} else "pending"
                    self.repo.update_queue_status(
                        item["id"], queue_status, f"HTTP {http_status}"
                    )
                    stats.errors += 1
                    if item["type"] == "novel":
                        consecutive_blocks += 1
                        if self.mobile_mode and consecutive_blocks >= 2:
                            print(
                                "[MOBILE MODE] Intermittent rate limit detected. "
                                "Pausing 10s for IP cooldown before auto-resuming...",
                                flush=True,
                            )
                            time.sleep(10)
                            with self.repo.conn:
                                self.repo.conn.execute(
                                    "UPDATE crawl_queue SET status = 'pending' WHERE status = 'blocked'"
                                )
                            consecutive_blocks = 0
                            continue
                        elif consecutive_blocks >= 3:
                            status = "partial"
                            reason = (
                                "authentication or anti-bot challenge"
                                if http_status in {401, 403}
                                else "server rate limit"
                            )
                            break
                    continue
                consecutive_blocks = 0
                if not html_text or http_status != 200:
                    stats.errors += 1
                    if item["attempts"] < self.max_attempts:
                        self.repo.retry_queue_item(
                            item["id"], f"HTTP {http_status}"
                        )
                    else:
                        self.repo.update_queue_status(
                            item["id"], "failed", f"HTTP {http_status}"
                        )
                    continue

                try:
                    stats.discovered += self._process_item(item, html_text)
                    self.repo.update_queue_status(item["id"], "complete")
                    if from_cache:
                        stats.cached += 1
                    else:
                        stats.scraped += 1
                except Exception as exc:
                    stats.errors += 1
                    if item["attempts"] < self.max_attempts:
                        self.repo.retry_queue_item(item["id"], str(exc))
                    else:
                        self.repo.update_queue_status(
                            item["id"], "failed", str(exc)
                        )

                self.repo.update_scrape_run(
                    run_id,
                    pages_scraped=stats.scraped,
                    pages_cached=stats.cached,
                    pages_discovered=stats.discovered,
                    errors=stats.errors,
                )
                total = stats.scraped + stats.cached
                if total and total % 25 == 0:
                    print(
                        json.dumps(
                            {
                                "event": "crawl_progress",
                                "run_id": run_id,
                                "processed": total,
                                "network": stats.scraped,
                                "cache": stats.cached,
                                "discovered": stats.discovered,
                                "errors": stats.errors,
                                "queue": self.repo.queue_counts(),
                            }
                        ),
                        flush=True,
                    )
        except KeyboardInterrupt:
            self.stop_requested = True

        if self.stop_requested:
            status, reason = "aborted", "termination signal"
        self.repo.recover_interrupted_items()
        self.repo.update_scrape_run(
            run_id,
            pages_scraped=stats.scraped,
            pages_cached=stats.cached,
            pages_discovered=stats.discovered,
            errors=stats.errors,
            status=status,
            stop_reason=reason,
            finished=True,
        )
        result = {
            "event": "crawl_finished",
            "run_id": run_id,
            "status": status,
            "reason": reason,
            "network": stats.scraped,
            "cache": stats.cached,
            "discovered": stats.discovered,
            "errors": stats.errors,
            "queue": self.repo.queue_counts(),
        }
        print(json.dumps(result), flush=True)
        return result


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Conservative, cached, resumable Novel Updates crawler"
    )
    parser.add_argument("--db", default=DEFAULT_DB_PATH)
    parser.add_argument(
        "--max-items",
        type=int,
        default=None,
        help="Stop cleanly after this many cached/network pages",
    )
    parser.add_argument("--min-delay", type=float, default=3.0)
    parser.add_argument("--max-delay", type=float, default=5.5)
    parser.add_argument(
        "--transport",
        choices=("urllib", "browser"),
        default="urllib",
        help="Network transport; browser reuses a manually prepared local session",
    )
    parser.add_argument(
        "--browser-profile",
        default=str(DEFAULT_BROWSER_PROFILE),
        help="Private persistent profile directory for browser transport",
    )
    parser.add_argument(
        "--setup-browser-session",
        action="store_true",
        help="Open the headed browser for manual login/challenge handling, then exit",
    )
    parser.add_argument(
        "--seed",
        action="store_true",
        help="Refresh the full snapshot seed and discovery queue first",
    )
    parser.add_argument(
        "--ignore-robots",
        action="store_true",
        default=True,
        help="Skip robots.txt restriction checks (default: True)",
    )
    parser.add_argument(
        "--check-robots",
        dest="ignore_robots",
        action="store_false",
        help="Enforce robots.txt restriction checks",
    )
    parser.add_argument(
        "--mobile",
        action="store_true",
        help="Enable high-throughput Mobile Data Mode with fast CGNAT pacing (1.2-2.2s) and IP rotation prompt",
    )
    args = parser.parse_args()
    if args.mobile:
        args.min_delay = 1.5
        args.max_delay = 2.5
        args.ignore_robots = True

    if args.min_delay < 0.1 or args.max_delay < args.min_delay:
        parser.error("require 0.1 <= min-delay <= max-delay")

    transport = None
    if args.transport == "browser" or args.setup_browser_session:
        try:
            transport = BrowserSessionTransport(Path(args.browser_profile))
        except RuntimeError as exc:
            parser.error(str(exc))
        if args.setup_browser_session:
            print(
                "A browser window is open. Complete any login or challenge "
                "manually, then return here and press Enter. No crawl will run."
            )
            transport.open_for_manual_setup()
            try:
                input()
            finally:
                transport.close()
            return 0

    conn = init_db(args.db)
    if args.seed:
        seed_database_from_dataset(conn)
    client = ScraperClient(
        delay_range=(args.min_delay, args.max_delay),
        transport=transport,
    )
    crawler = Crawler(
        conn,
        client=client,
        ignore_robots=args.ignore_robots,
        mobile_mode=args.mobile,
    )
    signal.signal(signal.SIGINT, crawler.request_stop)
    signal.signal(signal.SIGTERM, crawler.request_stop)
    try:
        result = crawler.run_queue(max_items=args.max_items)
    finally:
        client.close()
        conn.close()
    return 0 if result["status"] in {"complete", "partial", "aborted"} else 1


if __name__ == "__main__":
    raise SystemExit(main())
