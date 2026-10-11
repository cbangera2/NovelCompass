#!/usr/bin/env python3
"""Export serving tables from SQLite to a D1-compatible SQL seed file.

Usage:
    python3 scripts/export_d1_seed.py --db ../data/recommender.db --output seed.sql
    python3 scripts/export_d1_seed.py --db ../data/recommender.db --output seed-test.sql --limit 500

Import with (split large files into ~2 MB chunks first; `execute --file`
times out on very large single files):
    wrangler d1 execute novelcompass --local --file=seed.sql   # local dev
    wrangler d1 execute novelcompass --remote --file=chunk.sql # remote, per chunk

Only serving tables are exported (matching workers/migrations/0001_init.sql).
The scraper-only tables (crawl_queue, scrape_runs, ...) stay on the VM.
vector_neighbors is left empty unless populated by the refresh pipeline.
"""

from __future__ import annotations

import argparse
import sqlite3
from pathlib import Path

TABLES: dict[str, list[str]] = {
    "novels": [
        "id", "slug", "title", "associated_names", "author", "language",
        "synopsis", "rating", "rating_votes", "rating_votes_5",
        "rating_votes_4", "rating_votes_3", "rating_votes_2",
        "rating_votes_1", "reading_list_count", "chapters_orig",
        "chapters_trans", "status_trans", "year", "cover_url", "media_type",
        "source", "external_id", "external_url", "updated_at",
    ],
    "tags": ["id", "name", "category", "idf_weight"],
    "genres": ["id", "name"],
    "novel_tags": ["novel_id", "tag_id"],
    "novel_genres": ["novel_id", "genre_id"],
    "direct_recs": ["source_novel_id", "target_novel_id", "is_mutual", "votes"],
    "related_series": ["source_novel_id", "target_novel_id", "relation_type"],
    "rec_lists": [
        "id", "title", "description", "curator", "followers", "item_count",
        "created_at", "updated_at",
    ],
    "rec_list_items": ["list_id", "novel_id", "position", "tier", "comment"],
}


def sql_literal(value: object) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, float):
        return repr(value)
    if isinstance(value, int):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"


def main() -> None:
    parser = argparse.ArgumentParser(description="Export D1 seed SQL from SQLite")
    parser.add_argument("--db", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--limit", type=int, default=None,
                        help="Export only the first N novels (plus their linked rows)")
    parser.add_argument("--batch-size", type=int, default=100,
                        help="Rows per multi-row INSERT statement")
    parser.add_argument("--novels-batch-size", type=int, default=25,
                        help="Rows per novels INSERT (synopses are large; "
                             "D1 rejects statements over ~100 KB)")
    args = parser.parse_args()

    src = sqlite3.connect(args.db)
    novel_ids: set[int] | None = None
    if args.limit is not None:
        novel_ids = {
            row[0] for row in src.execute(
                "SELECT id FROM novels ORDER BY id LIMIT ?", (args.limit,)
            )
        }
        if not novel_ids:
            raise SystemExit("limit selected zero novels")

    statements = 0
    with args.output.open("w", encoding="utf-8") as out:
        for table, cols in TABLES.items():
            batch_size = args.novels_batch_size if table == "novels" else args.batch_size
            query = f"SELECT {', '.join(cols)} FROM {table}"
            if novel_ids is not None:
                if "novel_id" in cols:
                    query += f" WHERE novel_id IN ({','.join('?' * len(novel_ids))})"
                    params: tuple = tuple(sorted(novel_ids))
                elif table == "novels":
                    query += f" WHERE id IN ({','.join('?' * len(novel_ids))})"
                    params = tuple(sorted(novel_ids))
                elif table in ("direct_recs",):
                    query += (
                        f" WHERE source_novel_id IN ({','.join('?' * len(novel_ids))})"
                        f" AND target_novel_id IN ({','.join('?' * len(novel_ids))})"
                    )
                    params = tuple(sorted(novel_ids)) * 2
                else:
                    params = ()
            else:
                params = ()
            batch: list[str] = []
            for row in src.execute(query, params):
                batch.append(f"({', '.join(sql_literal(v) for v in row)})")
                if len(batch) >= batch_size:
                    out.write(
                        f"INSERT INTO {table} ({', '.join(cols)}) VALUES {', '.join(batch)};\n"
                    )
                    statements += 1
                    batch = []
            if batch:
                out.write(
                    f"INSERT INTO {table} ({', '.join(cols)}) VALUES {', '.join(batch)};\n"
                )
                statements += 1
    print(f"Wrote {args.output} ({statements} statements, "
          f"{args.output.stat().st_size / 1e6:.1f} MB)")
    src.close()


if __name__ == "__main__":
    main()
