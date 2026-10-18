"""Import saved Novel Updates /viewlist/ pages (one or many pages per list) into the DB.

Files are grouped by list ID (read from the page's og:url), ordered by pagination
page, and written to rec_lists / rec_list_items with positions ranked across pages.

    .venv/bin/python scripts/import_saved_lists.py DIR_OR_FILES... [--db data/recommender.db] [--dry-run]
"""
import argparse
import re
import sqlite3
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from bs4 import BeautifulSoup  # noqa: E402

from src.db.repository import Repository  # noqa: E402
from src.scraper.html_parser import parse_viewlist_page  # noqa: E402
from src.scraper.offline_import import looks_like_challenge  # noqa: E402

PAGE_SIZE = 25
VIEWLIST = re.compile(r"/viewlist/(\d+)")


def inspect_page(path: Path):
    html = path.read_text(encoding="utf-8", errors="ignore")
    if looks_like_challenge(html):
        return None, "challenge page"
    soup = BeautifulSoup(html, "html.parser")
    og = soup.find("meta", property="og:url")
    match = VIEWLIST.search(og["content"]) if og and og.get("content") else None
    if not match:
        return None, "not a viewlist page"
    current = soup.select_one(".digg_pagination em.current")
    page = int(current.text) if current and current.text.strip().isdigit() else 1
    pages = [
        int(m.group(1))
        for a in soup.select(".digg_pagination a[href]")
        if (m := re.search(r"[?&]pg=(\d+)", a["href"]))
    ]
    return (int(match.group(1)), page, max(pages + [page]), html), None


def collect(paths):
    files = []
    for p in paths:
        p = Path(p)
        files.extend(sorted(p.glob("*.html")) if p.is_dir() else [p])
    return files


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("paths", nargs="+")
    parser.add_argument("--db", default=str(ROOT / "data" / "recommender.db"))
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    by_list = defaultdict(dict)
    total_pages = {}
    for path in collect(args.paths):
        info, err = inspect_page(path)
        if err:
            print(f"SKIP {path.name}: {err}")
            continue
        list_id, page, last_page, html = info
        by_list[list_id][page] = html
        total_pages[list_id] = max(total_pages.get(list_id, 1), last_page)

    conn = sqlite3.connect(args.db)
    repo = Repository(conn)
    for list_id, pages in sorted(by_list.items()):
        items, meta = [], None
        for page in sorted(pages):
            parsed = parse_viewlist_page(pages[page], list_id)
            page_items = parsed.pop("items")
            meta = meta or parsed
            for item in page_items:
                item["position"] = (page - 1) * PAGE_SIZE + item["position"]
            items.extend(page_items)
        missing = sorted(set(range(1, total_pages[list_id] + 1)) - set(pages))
        note = f" MISSING pages {missing}" if missing else ""
        print(f"{list_id} {meta['title']!r}: {len(items)} items from pages {sorted(pages)}{note}")
        if not args.dry_run:
            repo.upsert_rec_list({**meta, "id": list_id, "items": items})
    conn.close()


if __name__ == "__main__":
    main()
