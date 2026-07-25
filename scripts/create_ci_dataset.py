"""Create a tiny deterministic database for static-export contract checks."""

from __future__ import annotations

import argparse
from pathlib import Path

from src.db.schema import init_db


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.unlink(missing_ok=True)

    conn = init_db(str(args.output))
    with conn:
        conn.executemany(
            """INSERT INTO novels
               (id, slug, title, associated_names, author, language, synopsis,
                rating, rating_votes, reading_list_count, chapters_orig,
                chapters_trans, status_trans, year, cover_url, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            [
                (1, "fixture-one", "Fixture One", '["First Fixture"]', "A", "Chinese",
                 "A deterministic fixture synopsis.", 4.2, 10, 20, 100, 90,
                 "Completed", 2020, "one.jpg", "2026-01-01T00:00:00Z"),
                (257, "fixture-two", "Fixture Two", None, "B", "Japanese",
                 "A connected deterministic fixture.", 4.0, 5, 8, 50, 40,
                 "Ongoing", 2021, "two.jpg", "2026-01-01T00:00:00Z"),
            ],
        )
        conn.execute("INSERT INTO genres(id, name) VALUES (1, 'Fantasy')")
        conn.execute("INSERT INTO tags(id, name) VALUES (1, 'Academy')")
        conn.executemany("INSERT INTO novel_genres VALUES (?, 1)", [(1,), (257,)])
        conn.executemany("INSERT INTO novel_tags VALUES (?, 1)", [(1,), (257,)])
        conn.execute("INSERT INTO direct_recs VALUES (1, 257, 1, 3)")
        conn.execute(
            """INSERT INTO rec_lists(id, title, item_count)
               VALUES (10, 'CI fixture list', 2)"""
        )
        conn.executemany(
            "INSERT INTO rec_list_items(list_id, novel_id, position) VALUES (10, ?, ?)",
            [(1, 1), (257, 2)],
        )
    conn.close()


if __name__ == "__main__":
    main()
