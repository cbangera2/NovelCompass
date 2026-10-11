"""Build normalized static graph.json from recommender.db for Novel Compass visual relationship graph.

Includes 100% of all catalog titles (all 30,000+ novels, manga, anime) connected via
structural relationships, direct recommendations, and shared tag/genre similarity.
Exports primary_genre tags for genre/trope color coding.
"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import tempfile
from collections import defaultdict, deque
from pathlib import Path
from typing import Any

DEFAULT_DB_PATH = "data/recommender.db"
DEFAULT_OUTPUT_PATH = "web/public/data/graph.json"

GENRE_FAMILY_MAP = {
    "fantasy": "fantasy",
    "supernatural": "fantasy",
    "magic": "fantasy",
    "isekai": "fantasy",

    "action": "action",
    "adventure": "action",
    "martial arts": "action",
    "shounen": "action",
    "mecha": "scifi",
    "sci-fi": "scifi",
    "scifi": "scifi",

    "romance": "romance",
    "josei": "romance",
    "shoujo": "romance",
    "yaoi": "romance",
    "yuri": "romance",
    "smut": "romance",
    "harem": "romance",

    "slice of life": "slice_of_life",
    "comedy": "slice_of_life",
    "school life": "slice_of_life",

    "psychological": "psychological",
    "mystery": "psychological",
    "horror": "psychological",
    "tragedy": "psychological",
    "drama": "psychological",
}


def _atomic_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(value, handle, ensure_ascii=False, separators=(",", ":"))
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    except BaseException:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass
        raise


def build_graph_export(db_path: str, output_path: Path, min_rec_votes: int = 1) -> dict[str, Any]:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row

    # Fetch ALL novels in database
    novels_rows = conn.execute(
        """SELECT id, slug, title, author, cover_url, rating, rating_votes,
                  reading_list_count, year,
                  COALESCE(media_type, 'novel') as media_type,
                  COALESCE(source, 'novelupdates') as source,
                  external_id, external_url
           FROM novels"""
    ).fetchall()

    novels_by_id = {row["id"]: row for row in novels_rows}
    all_novel_ids = set(novels_by_id.keys())

    # Build primary genre mapping per novel
    primary_genre_map: dict[int, str] = {}
    for row in conn.execute(
        "SELECT ng.novel_id, LOWER(g.name) as name FROM novel_genres ng JOIN genres g ON g.id = ng.genre_id"
    ):
        nid = row["novel_id"]
        if nid not in primary_genre_map and nid in novels_by_id:
            gname = row["name"]
            fam = GENRE_FAMILY_MAP.get(gname)
            if fam:
                primary_genre_map[nid] = fam

    # Fetch related series edges (structural/adaptation relationships)
    related_rows = conn.execute(
        """SELECT source_novel_id, target_novel_id, relation_type
           FROM related_series"""
    ).fetchall()

    # Fetch direct recs edges (user recommendation connections)
    rec_rows = conn.execute(
        """SELECT source_novel_id, target_novel_id, votes, is_mutual
           FROM direct_recs
           WHERE votes >= ? OR is_mutual = 1""",
        (min_rec_votes,),
    ).fetchall()

    edges_map: dict[tuple[int, int], dict[str, Any]] = {}
    graph_adj: dict[int, set[int]] = defaultdict(set)
    structural_adj: dict[int, set[int]] = defaultdict(set)

    for row in related_rows:
        src = row["source_novel_id"]
        tgt = row["target_novel_id"]
        if src in novels_by_id and tgt in novels_by_id and src != tgt:
            rel_type = row["relation_type"] or "related"
            key = (min(src, tgt), max(src, tgt))
            edges_map[key] = {
                "source": src,
                "target": tgt,
                "type": rel_type,
                "weight": 2.0 if rel_type in ("adaptation", "prequel", "sequel") else 1.5,
                "votes": 0,
            }
            graph_adj[src].add(tgt)
            graph_adj[tgt].add(src)
            structural_adj[src].add(tgt)
            structural_adj[tgt].add(src)

    for row in rec_rows:
        src = row["source_novel_id"]
        tgt = row["target_novel_id"]
        votes = row["votes"] or 1
        if src in novels_by_id and tgt in novels_by_id and src != tgt:
            key = (min(src, tgt), max(src, tgt))
            if key not in edges_map:
                edges_map[key] = {
                    "source": src,
                    "target": tgt,
                    "type": "direct_rec",
                    "weight": 1.0 + (0.1 * min(votes, 10)),
                    "votes": votes,
                }
                graph_adj[src].add(tgt)
                graph_adj[tgt].add(src)

    # Build tag index for all novels to connect standalone titles via shared tropes
    tags_by_novel: dict[int, set[int]] = defaultdict(set)
    novels_by_tag: dict[int, list[int]] = defaultdict(list)
    tag_counts: dict[int, int] = defaultdict(int)

    for nid, tid in conn.execute("SELECT novel_id, tag_id FROM novel_tags"):
        if nid in novels_by_id:
            tags_by_novel[nid].add(tid)
            novels_by_tag[tid].append(nid)
            tag_counts[tid] += 1

    informative_tags = {tid for tid, cnt in tag_counts.items() if 3 <= cnt <= 1200}

    # For any novel that has < 2 connections, connect it to its top tag-similar peers
    unconnected = [nid for nid in all_novel_ids if len(graph_adj[nid]) < 2]
    tag_edges_added = 0

    for nid in unconnected:
        my_tags = tags_by_novel[nid] & informative_tags
        if not my_tags:
            continue

        candidate_scores: dict[int, int] = defaultdict(int)
        for tid in my_tags:
            for peer_id in novels_by_tag[tid]:
                if peer_id != nid:
                    candidate_scores[peer_id] += 1

        top_peers = sorted(
            candidate_scores.items(),
            key=lambda p: (
                -p[1],
                -(novels_by_id[p[0]]["reading_list_count"] or 0),
                p[0],
            ),
        )[:3]

        for peer_id, shared_cnt in top_peers:
            if shared_cnt >= 2:
                key = (min(nid, peer_id), max(nid, peer_id))
                if key not in edges_map:
                    edges_map[key] = {
                        "source": nid,
                        "target": peer_id,
                        "type": "shared_tag",
                        "weight": round(0.5 + (0.1 * min(shared_cnt, 10)), 2),
                        "votes": shared_cnt,
                    }
                    graph_adj[nid].add(peer_id)
                    graph_adj[peer_id].add(nid)
                    tag_edges_added += 1

    # Compute connected components for franchise structural graph
    visited: set[int] = set()
    cluster_id_counter = 0
    node_cluster: dict[int, int] = {}
    clusters_meta: list[dict[str, Any]] = []

    sorted_novel_ids = sorted(
        structural_adj.keys(),
        key=lambda nid: (
            -(novels_by_id[nid]["reading_list_count"] or 0),
            -(novels_by_id[nid]["rating_votes"] or 0),
            nid,
        ),
    )

    for seed_id in sorted_novel_ids:
        if seed_id in visited:
            continue
        cluster_id_counter += 1
        cid = cluster_id_counter
        cluster_nodes: list[int] = []
        queue = deque([seed_id])
        visited.add(seed_id)

        while queue:
            curr = queue.popleft()
            cluster_nodes.append(curr)
            node_cluster[curr] = cid
            for nxt in structural_adj.get(curr, set()):
                if nxt not in visited:
                    visited.add(nxt)
                    queue.append(nxt)

        if len(cluster_nodes) > 1:
            seed_row = novels_by_id[seed_id]
            type_counts: dict[str, int] = defaultdict(int)
            for nid in cluster_nodes:
                type_counts[novels_by_id[nid]["media_type"] or "novel"] += 1

            clusters_meta.append(
                {
                    "id": cid,
                    "name": seed_row["title"],
                    "seed_id": seed_id,
                    "size": len(cluster_nodes),
                    "types": dict(type_counts),
                }
            )

    clusters_meta.sort(key=lambda c: (-c["size"], c["name"]))

    # Include ALL novels in the dataset
    nodes: list[dict[str, Any]] = []
    for nid in sorted(all_novel_ids, key=lambda i: (-(novels_by_id[i]["reading_list_count"] or 0), i)):
        row = novels_by_id[nid]
        mt = row["media_type"] or ("anime" if nid >= 3_000_000 else "manga" if nid >= 2_000_000 else "novel")
        src = row["source"] or ("anilist" if nid >= 2_000_000 else "novelupdates")
        pgenre = primary_genre_map.get(nid, "other")
        nodes.append(
            {
                "id": nid,
                "title": row["title"],
                "slug": row["slug"] or "",
                "author": row["author"] or "",
                "cover": row["cover_url"] or "",
                "rating": row["rating"] or 0.0,
                "votes": row["rating_votes"] or 0,
                "readers": row["reading_list_count"] or 0,
                "year": row["year"],
                "media_type": mt,
                "source": src,
                "degree": len(graph_adj[nid]),
                "cluster_id": node_cluster.get(nid, 0),
                "genre": pgenre,
            }
        )

    nodes.sort(key=lambda n: (-(n["readers"] or 0), -n["degree"], n["id"]))
    edges = list(edges_map.values())

    payload = {
        "node_count": len(nodes),
        "edge_count": len(edges),
        "cluster_count": len(clusters_meta),
        "clusters": clusters_meta[:100],
        "nodes": nodes,
        "edges": edges,
    }

    _atomic_json(output_path, payload)
    print(f"Successfully exported graph with primary genre tags: {len(nodes)} nodes, {len(edges)} edges to {output_path}")
    conn.close()
    return payload


def main() -> None:
    parser = argparse.ArgumentParser(description="Export relationship graph data")
    parser.add_argument("--db", default=DEFAULT_DB_PATH, help="Path to sqlite database")
    parser.add_argument("--output", type=Path, default=Path(DEFAULT_OUTPUT_PATH), help="Output graph.json path")
    parser.add_argument("--min-rec-votes", type=int, default=1, help="Min votes for recommendation edges")
    args = parser.parse_args()

    build_graph_export(args.db, args.output, args.min_rec_votes)


if __name__ == "__main__":
    main()
