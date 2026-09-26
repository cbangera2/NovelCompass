"""Export precomputed embedding neighbors for the Cloudflare Worker.

The Worker cannot run the Python embedding model, so the vector channel is
served from a precomputed ``vector_neighbors`` table in D1. This script
computes top-K cosine-similarity neighbors per novel using the same embedder
as the live engine (``src.nlp.embedder.SynopsisEmbedder``) and writes them to
the SQLite DB the refresh pipeline later imports into D1.

Usage:
    .venv/bin/python scripts/export_vector_neighbors.py \
        --db data/recommender.db --limit 150
"""

from __future__ import annotations

import argparse
import sqlite3
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.db.schema import get_connection  # noqa: E402
from src.nlp.embedder import SynopsisEmbedder  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", required=True)
    parser.add_argument("--limit", type=int, default=150)
    args = parser.parse_args()

    conn = get_connection(args.db)
    cur = conn.cursor()
    cur.execute(
        "SELECT id, title, synopsis FROM novels "
        "WHERE synopsis IS NOT NULL AND synopsis != '' ORDER BY id"
    )
    rows = cur.fetchall()
    if not rows:
        print("no novels with synopses; nothing to export")
        return

    embedder = SynopsisEmbedder()
    texts = [embedder.construct_text(title, synopsis) for _, title, synopsis in rows]
    print(f"encoding {len(texts)} synopses...", flush=True)
    vectors = embedder.encode(texts)
    # L2-normalize so dot product == cosine similarity
    norms = np.linalg.norm(vectors, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    vectors = vectors / norms

    ids = [row[0] for row in rows]
    limit = min(args.limit, len(ids) - 1)

    cur.execute(
        "CREATE TABLE IF NOT EXISTS vector_neighbors ("
        "source_novel_id INTEGER NOT NULL, "
        "target_novel_id INTEGER NOT NULL, "
        "score REAL NOT NULL, "
        "rank INTEGER NOT NULL, "
        "PRIMARY KEY (source_novel_id, rank))"
    )
    cur.execute("DELETE FROM vector_neighbors")

    batch = []
    for i, src_id in enumerate(ids):
        sims = vectors @ vectors[i]
        sims[i] = -1.0  # exclude self
        if len(sims) > limit:
            top = np.argpartition(-sims, limit)[:limit]
            top = top[np.argsort(-sims[top])]
        else:
            top = np.argsort(-sims)
        for rank, j in enumerate(top, start=1):
            if sims[j] <= 0:
                break
            batch.append((src_id, ids[int(j)], float(sims[j]), rank))
        if len(batch) >= 5000:
            cur.executemany(
                "INSERT INTO vector_neighbors "
                "(source_novel_id, target_novel_id, score, rank) VALUES (?, ?, ?, ?)",
                batch,
            )
            batch = []
            print(f"  ... {i + 1}/{len(ids)}", flush=True)
    if batch:
        cur.executemany(
            "INSERT INTO vector_neighbors "
            "(source_novel_id, target_novel_id, score, rank) VALUES (?, ?, ?, ?)",
            batch,
        )
    conn.commit()
    count = cur.execute("SELECT COUNT(*) FROM vector_neighbors").fetchone()[0]
    print(f"wrote {count} neighbor rows for {len(ids)} novels")


if __name__ == "__main__":
    main()
