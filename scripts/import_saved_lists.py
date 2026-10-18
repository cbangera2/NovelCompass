"""Import saved Novel Updates /viewlist/ pages (one or many pages per list) into the DB.

    .venv/bin/python scripts/import_saved_lists.py DIR_OR_FILES... [--db data/recommender.db] [--dry-run]

The web app's profile page does the same through POST /api/import/lists.
"""
import argparse
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from src.scraper.list_import import import_list_pages  # noqa: E402


def collect(paths):
    files = []
    for p in map(Path, paths):
        files.extend(sorted(p.glob("*.html")) if p.is_dir() else [p])
    return files


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("paths", nargs="+")
    parser.add_argument("--db", default=str(ROOT / "data" / "recommender.db"))
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    pages = [(f.name, f.read_text(encoding="utf-8", errors="ignore")) for f in collect(args.paths)]
    conn = sqlite3.connect(args.db)
    result = import_list_pages(conn, pages, dry_run=args.dry_run)
    conn.close()
    for item in result["skipped"]:
        print(f"SKIP {item['name']}: {item['reason']}")
    for item in result["lists"]:
        note = f" MISSING pages {item['missing_pages']}" if item["missing_pages"] else ""
        print(f"{item['id']} {item['title']!r}: {item['items']} items from pages {item['pages']}{note}")


if __name__ == "__main__":
    main()
