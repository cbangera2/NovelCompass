"""Import saved Novel Updates /viewlist/ pages (one or more pages per list)."""
import re
import sqlite3
from collections import defaultdict
from typing import Any, Dict, List, Tuple

from bs4 import BeautifulSoup

from src.db.repository import Repository
from src.scraper.html_parser import parse_viewlist_page
from src.scraper.offline_import import looks_like_challenge

PAGE_SIZE = 25
_VIEWLIST = re.compile(r"/viewlist/(\d+)")


def inspect_list_page(html: str) -> Tuple[Tuple[int, int, int] | None, str]:
    """Return ((list_id, page, last_page), "") or (None, reason)."""
    if looks_like_challenge(html):
        return None, "challenge page"
    soup = BeautifulSoup(html, "html.parser")
    og = soup.find("meta", property="og:url")
    match = _VIEWLIST.search(og["content"]) if og and og.get("content") else None
    if not match:
        return None, "not a Novel Updates list page"
    current = soup.select_one(".digg_pagination em.current")
    page = int(current.text) if current and current.text.strip().isdigit() else 1
    linked = [
        int(m.group(1))
        for a in soup.select(".digg_pagination a[href]")
        if (m := re.search(r"[?&]pg=(\d+)", a["href"]))
    ]
    return (int(match.group(1)), page, max(linked + [page])), ""


def import_list_pages(
    conn: sqlite3.Connection, pages: List[Tuple[str, str]], dry_run: bool = False
) -> Dict[str, Any]:
    """Group saved pages by list ID, rank members across pages and upsert them."""
    by_list: Dict[int, Dict[int, str]] = defaultdict(dict)
    last_pages: Dict[int, int] = {}
    skipped: List[Dict[str, str]] = []
    for name, html in pages:
        info, reason = inspect_list_page(html)
        if info is None:
            skipped.append({"name": name, "reason": reason})
            continue
        list_id, page, last_page = info
        by_list[list_id][page] = html
        last_pages[list_id] = max(last_pages.get(list_id, 1), last_page)

    repo = Repository(conn)
    imported = []
    for list_id, by_page in sorted(by_list.items()):
        items, meta = [], None
        for page in sorted(by_page):
            parsed = parse_viewlist_page(by_page[page], list_id)
            page_items = parsed.pop("items")
            meta = meta or parsed
            for item in page_items:
                item["position"] = (page - 1) * PAGE_SIZE + item["position"]
            items.extend(page_items)
        missing = sorted(set(range(1, last_pages[list_id] + 1)) - set(by_page))
        if not dry_run:
            repo.upsert_rec_list({**meta, "id": list_id, "items": items})
        imported.append(
            {"id": list_id, "title": meta["title"], "items": len(items), "pages": sorted(by_page), "missing_pages": missing}
        )
    return {"lists": imported, "skipped": skipped}
