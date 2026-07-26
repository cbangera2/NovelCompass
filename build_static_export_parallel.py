"""Parallel build of the versioned, normalized static projection of recommender.db.

Parallelism strategy:
- CompactCandidateIndex is built ONCE PER WORKER from SQLite using the ProcessPoolExecutor
  initializer= hook, so the huge index object is NEVER pickled between processes.
  Workers only receive tiny lists of novel IDs.
- 256 bucket JSON writes run concurrently via ThreadPoolExecutor (I/O-bound).
- All output is byte-for-byte identical to the serial version (same verify_export).
"""


from __future__ import annotations

import argparse
import hashlib
import heapq
import json
import math
import os
import re
import tempfile
import time
from collections import defaultdict
from concurrent.futures import ProcessPoolExecutor, ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

from src.db.schema import DEFAULT_DB_PATH, get_connection
from src.engine.candidate_gen import CandidateGenerator
from src.nlp.taxonomy import HIGH_PRIORITY_TAGS


class ProgressLogger:
    """Timestamped progress logger with %, rate, and ETA."""

    def __init__(self, label: str, total: int, min_interval_s: float = 2.0) -> None:
        self.label = label
        self.total = total
        self.done = 0
        self.min_interval_s = min_interval_s
        self.t_start = time.perf_counter()
        self.t_last = self.t_start
        import threading
        self._lock = threading.Lock()
        self._print(f"Starting  ({total:,} items)")

    def _print(self, msg: str) -> None:
        ts = datetime.now().strftime("%H:%M:%S")
        print(f"[{ts}] {self.label}: {msg}", flush=True)

    def update(self, n: int = 1) -> None:
        with self._lock:
            self.done += n
            now = time.perf_counter()
            if now - self.t_last >= self.min_interval_s or self.done >= self.total:
                self.t_last = now
                elapsed = now - self.t_start
                pct = 100.0 * self.done / self.total if self.total else 100.0
                rate = self.done / elapsed if elapsed > 0 else 0
                eta_s = (self.total - self.done) / rate if rate > 0 else 0
                eta_str = f"{eta_s/60:.1f}m" if eta_s >= 60 else f"{eta_s:.0f}s"
                self._print(
                    f"{self.done:,}/{self.total:,}  {pct:.1f}%  "
                    f"{rate:.1f}/s  ETA {eta_str}"
                )

    def done_msg(self, extra: str = "") -> None:
        elapsed = time.perf_counter() - self.t_start
        rate = self.total / elapsed if elapsed > 0 else 0
        self._print(
            f"✓ Done in {elapsed:.1f}s  ({rate:.1f}/s average){(' — ' + extra) if extra else ''}"
        )


SCHEMA_VERSION = 1
ALGORITHM_VERSION = 1
CHANNELS = ("tag", "direct_rec", "rec_list", "structural", "vector")
CATALOG_FIELDS = (
    "id", "slug", "title", "author", "cover", "rating", "votes", "readers",
    "year", "language_id", "status_id", "translated_chapters", "genre_ids",
)


def bucket_for_id(novel_id: int) -> str:
    return f"{novel_id % 256:02x}"


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


def _decode_names(raw: str | None) -> list[str]:
    if not raw:
        return []
    try:
        value = json.loads(raw)
    except (TypeError, json.JSONDecodeError):
        value = [part.strip() for part in raw.splitlines()]
    return [str(item).strip() for item in value if str(item).strip()]


def _indexed_values(values: Iterable[str | None]) -> tuple[list[str], dict[str, int]]:
    ordered = ["", *sorted({value for value in values if value})]
    return ordered, {value: index for index, value in enumerate(ordered)}


def _dataset_version(conn: Any) -> str:
    row = conn.execute(
        "SELECT COUNT(*), COALESCE(MAX(updated_at), '') FROM novels"
    ).fetchone()
    material = f"{SCHEMA_VERSION}:{ALGORITHM_VERSION}:{row[0]}:{row[1]}"
    digest = hashlib.sha256(material.encode()).hexdigest()[:12]
    return f"{datetime.now(timezone.utc).date().isoformat()}-{digest}"


def _candidate_evidence(
    conn: Any,
    seed_id: int,
    candidate_ids: list[int],
    tag_indices: dict[int, int],
    list_titles: dict[int, str | None],
) -> dict[int, dict[str, Any]]:
    evidence = {candidate_id: {"shared_tag_ids": [], "direct_votes": 0, "list_count": 0, "list_ids": [], "lists": []}
                for candidate_id in candidate_ids}
    if not candidate_ids:
        return evidence
    marks = ",".join("?" for _ in candidate_ids)
    for candidate_id, tag_id in conn.execute(
        f"""SELECT nt2.novel_id, nt1.tag_id
            FROM novel_tags nt1 JOIN novel_tags nt2 ON nt1.tag_id = nt2.tag_id
            WHERE nt1.novel_id = ? AND nt2.novel_id IN ({marks})""",
        (seed_id, *candidate_ids),
    ):
        evidence[candidate_id]["shared_tag_ids"].append(tag_indices[tag_id])
    for source, target, votes in conn.execute(
        f"""SELECT source_novel_id, target_novel_id, votes FROM direct_recs
            WHERE (source_novel_id = ? AND target_novel_id IN ({marks}))
               OR (target_novel_id = ? AND source_novel_id IN ({marks}))""",
        (seed_id, *candidate_ids, seed_id, *candidate_ids),
    ):
        candidate_id = target if source == seed_id else source
        evidence[candidate_id]["direct_votes"] = max(evidence[candidate_id]["direct_votes"], votes or 1)
    for candidate_id, list_id in conn.execute(
        f"""SELECT other.novel_id, seed.list_id
            FROM rec_list_items seed JOIN rec_list_items other ON seed.list_id = other.list_id
            WHERE seed.novel_id = ? AND other.novel_id IN ({marks})""",
        (seed_id, *candidate_ids),
    ):
        evidence[candidate_id]["list_ids"].append(list_id)
    for item in evidence.values():
        item["shared_tag_ids"].sort()
        item["list_ids"] = sorted(set(item["list_ids"]))
        item["list_count"] = len(item["list_ids"])
        if item["list_ids"]:
            item["lists"] = [
                {
                    "id": list_id,
                    "title": (
                        None
                        if not list_titles.get(list_id) or re.fullmatch(
                            rf"Novel Updates List\s+{list_id}",
                            list_titles[list_id],
                            re.I,
                        )
                        else list_titles[list_id]
                    ),
                }
                for list_id in item["list_ids"]
            ]
    return evidence


def _export_pool(
    conn: Any,
    generator: CandidateGenerator,
    seed_id: int,
    limit: int,
    tag_indices: dict[int, int],
    list_titles: dict[int, str | None],
) -> dict[str, Any]:
    raw_channels = generator.get_candidate_channels(seed_id, limit_per_channel=limit, conn=conn)
    ranks: dict[int, dict[str, int]] = {}
    for channel in CHANNELS:
        for rank, (candidate_id, _score) in enumerate(raw_channels.get(channel, []), 1):
            if candidate_id != seed_id:
                ranks.setdefault(candidate_id, {})[channel] = rank
    selected = sorted(
        ranks,
        key=lambda candidate_id: (
            -len(ranks[candidate_id]),
            min(ranks[candidate_id].values()),
            candidate_id,
        ),
    )[:limit]
    evidence = _candidate_evidence(conn, seed_id, selected, tag_indices, list_titles)
    candidates = []
    for candidate_id in selected:
        item = evidence[candidate_id]
        candidates.append({
            "id": candidate_id,
            "r": [ranks[candidate_id].get(channel) for channel in CHANNELS],
            **item,
        })
    result: dict[str, Any] = {
        "seed": seed_id,
        "algorithm_version": ALGORITHM_VERSION,
        "channels": list(CHANNELS),
        "candidates": candidates,
    }
    if not candidates:
        result["reason"] = "insufficient_evidence"
    return result


class CompactCandidateIndex:
    """Identical logic to serial version. Plain dicts/lists throughout."""

    def __init__(self, conn: Any, novel_ids: set[int], tag_indices: dict[int, int]):
        self.novel_ids = novel_ids
        self.tag_indices = tag_indices
        self.tags_by_novel: dict[int, set[int]] = defaultdict(set)
        self.novels_by_tag: dict[int, list[int]] = defaultdict(list)
        tag_frequency: dict[int, int] = {}
        for novel_id, tag_id in conn.execute(
            "SELECT novel_id, tag_id FROM novel_tags ORDER BY novel_id, tag_id"
        ):
            if novel_id in novel_ids:
                self.tags_by_novel[novel_id].add(tag_id)
                self.novels_by_tag[tag_id].append(novel_id)
                tag_frequency[tag_id] = tag_frequency.get(tag_id, 0) + 1
        total = max(1, len(novel_ids))
        priority = {name.lower() for name in HIGH_PRIORITY_TAGS}
        tag_names = dict(conn.execute("SELECT id, name FROM tags"))
        self.tag_weights = {
            tag_id: (math.log((total + 1.0) / (frequency + 1.0)) + 1.0)
            * (1.5 if (tag_names.get(tag_id) or "").lower() in priority else 1.0)
            for tag_id, frequency in tag_frequency.items()
        }
        self.tag_totals = {
            novel_id: sum(self.tag_weights.get(tag_id, 1.0) for tag_id in tag_ids)
            for novel_id, tag_ids in self.tags_by_novel.items()
        }
        self.direct: dict[int, list[tuple[int, float]]] = defaultdict(list)
        for source, target, votes, mutual in conn.execute(
            "SELECT source_novel_id, target_novel_id, votes, is_mutual FROM direct_recs"
        ):
            if source in novel_ids and target in novel_ids:
                score = (1.5 if mutual else 1.0) * (1.0 + 0.2 * (votes or 0))
                self.direct[source].append((target, score))
                self.direct[target].append((source, score))
        self.lists_by_novel: dict[int, list[int]] = defaultdict(list)
        self.novels_by_list: dict[int, list[int]] = defaultdict(list)
        for list_id, novel_id in conn.execute(
            "SELECT list_id, novel_id FROM rec_list_items ORDER BY list_id, position"
        ):
            if novel_id in novel_ids:
                self.lists_by_novel[novel_id].append(list_id)
                self.novels_by_list[list_id].append(novel_id)
        self.structural: dict[int, set[int]] = defaultdict(set)
        authors: dict[str, list[int]] = defaultdict(list)
        for novel_id, author in conn.execute("SELECT id, author FROM novels"):
            if novel_id in novel_ids and author:
                authors[author].append(novel_id)
        for author_ids in authors.values():
            if len(author_ids) > 1:
                for novel_id in author_ids:
                    self.structural[novel_id].update(
                        cid for cid in author_ids if cid != novel_id
                    )
        for source, target in conn.execute(
            "SELECT source_novel_id, target_novel_id FROM related_series"
        ):
            if source in novel_ids and target in novel_ids:
                self.structural[source].add(target)
                self.structural[target].add(source)
        self.genres_by_novel: dict[int, set[int]] = defaultdict(set)
        self.novels_by_genre: dict[int, list[int]] = defaultdict(list)
        for novel_id, genre_id in conn.execute(
            "SELECT novel_id, genre_id FROM novel_genres ORDER BY novel_id, genre_id"
        ):
            if novel_id in novel_ids:
                self.genres_by_novel[novel_id].add(genre_id)
                self.novels_by_genre[genre_id].append(novel_id)
        self.popularity = dict(conn.execute(
            "SELECT id, COALESCE(reading_list_count, 0) FROM novels"
        ))
        for genre_id, novel_list in list(self.novels_by_genre.items()):
            novel_list.sort(key=lambda cid: self.popularity.get(cid, 0), reverse=True)
            self.novels_by_genre[genre_id] = novel_list[:300]

    @staticmethod
    def _top(scores, limit: int) -> list[tuple[int, float]]:
        items = scores.items() if isinstance(scores, dict) else scores
        return heapq.nlargest(limit, items, key=lambda item: (item[1], -item[0]))

    def channels(self, seed_id: int, limit: int) -> dict[str, list[tuple[int, float]]]:
        intersections: dict[int, float] = defaultdict(float)
        for tag_id in self.tags_by_novel.get(seed_id, set()):
            weight = self.tag_weights.get(tag_id, 1.0)
            for candidate_id in self.novels_by_tag[tag_id]:
                if candidate_id != seed_id:
                    intersections[candidate_id] += weight
        seed_total = self.tag_totals.get(seed_id, 0.0)
        tag_scores = {
            cid: shared / (seed_total + self.tag_totals.get(cid, 0.0) - shared)
            for cid, shared in intersections.items()
        }
        list_scores: dict[int, float] = defaultdict(float)
        for list_id in self.lists_by_novel.get(seed_id, []):
            for cid in self.novels_by_list[list_id]:
                if cid != seed_id:
                    list_scores[cid] += 1.0
        structural_scores = {cid: 2.0 for cid in self.structural.get(seed_id, set())}
        if len(structural_scores) < limit:
            shared_genres: dict[int, float] = defaultdict(float)
            for genre_id in self.genres_by_novel.get(seed_id, set()):
                for cid in self.novels_by_genre[genre_id]:
                    if cid != seed_id and cid not in structural_scores:
                        shared_genres[cid] += 1.0
            genre_peers = self._top({
                cid: shared * 1_000_000 + math.log1p(max(0, self.popularity.get(cid, 0)))
                for cid, shared in shared_genres.items()
            }, limit - len(structural_scores))
            structural_scores.update(
                (cid, score / 1_000_000) for cid, score in genre_peers
            )
        return {
            "tag": self._top(tag_scores, limit),
            "direct_rec": self._top(self.direct.get(seed_id, []), limit),
            "rec_list": self._top(list_scores, limit),
            "structural": self._top(structural_scores, limit),
            "vector": [],
        }

    def pool(self, seed_id: int, limit: int) -> list[list[Any]]:
        raw_channels = self.channels(seed_id, limit)
        ranks: dict[int, dict[str, int]] = {}
        for channel in CHANNELS:
            for rank, (cid, _) in enumerate(raw_channels[channel], 1):
                ranks.setdefault(cid, {})[channel] = rank
        selected = sorted(
            ranks,
            key=lambda cid: (-len(ranks[cid]), min(ranks[cid].values()), cid),
        )[:limit]
        return [
            [
                cid,
                [ranks[cid].get(ch) for ch in CHANNELS],
                sorted(
                    self.tag_indices[tid]
                    for tid in (
                        self.tags_by_novel.get(seed_id, set())
                        & self.tags_by_novel.get(cid, set())
                    )
                ),
            ]
            for cid in selected
        ]


# ---------------------------------------------------------------------------
# Worker process state — built ONCE per process in the initializer.
# No pickling of the huge index between processes.
# ---------------------------------------------------------------------------

_worker_index: CompactCandidateIndex | None = None


def _worker_init(db_path: str, novel_ids_list: list[int], tag_indices: dict[int, int]) -> None:
    """Runs once per worker process. Builds CompactCandidateIndex from SQLite locally."""
    global _worker_index
    conn = get_connection(db_path)
    _worker_index = CompactCandidateIndex(conn, set(novel_ids_list), tag_indices)
    conn.close()


def _compact_pool_worker(args: tuple[list[int], int]) -> list[tuple[int, list[list[Any]]]]:
    """Called per chunk. Uses the process-local _worker_index — no pickling of big objects."""
    novel_ids, limit = args
    return [(nid, _worker_index.pool(nid, limit)) for nid in novel_ids]


def _write_bucket(args: tuple[Path, str, dict]) -> None:
    """Write a single recommendation-index bucket file (I/O-bound, runs in thread pool)."""
    output, bucket, pools = args
    _atomic_json(output / "recommendation-index" / f"{bucket}.json", {
        "algorithm_version": ALGORITHM_VERSION,
        "channels": list(CHANNELS),
        "pools": pools,
    })


# ---------------------------------------------------------------------------
# Main export
# ---------------------------------------------------------------------------

def export_static_dataset(
    output: Path,
    max_novels: int | None = None,
    db_path: str = DEFAULT_DB_PATH,
    candidate_limit: int = 200,
    catalog_limit: int | None = None,
    reuse_recommendations: bool = False,
    compact_candidate_limit: int = 50,
    workers: int | None = None,
) -> dict[str, Any]:
    # Leave 1 core free for the OS / disk I/O; use all others for compute
    n_workers = workers or max(1, (os.cpu_count() or 4) - 1)
    conn = get_connection(db_path)
    t0 = time.perf_counter()
    ts0 = datetime.now().strftime("%H:%M:%S")
    print(f"[{ts0}] export: Starting — {n_workers} workers / {os.cpu_count()} cores", flush=True)

    try:
        source_novel_count = conn.execute("SELECT COUNT(*) FROM novels").fetchone()[0]
        novels = conn.execute(
            """SELECT id, slug, title, author, cover_url, rating, rating_votes,
                      reading_list_count, year, language, status_trans,
                      chapters_trans, chapters_orig, synopsis, associated_names,
                      rating_votes_5, rating_votes_4, rating_votes_3, rating_votes_2, rating_votes_1,
                      COALESCE(media_type, 'novel') as media_type,
                      COALESCE(source, 'novelupdates') as source,
                      external_id, external_url
               FROM novels ORDER BY id"""
        ).fetchall()

        if catalog_limit is not None:
            bootstrap_novels = sorted(
                sorted(
                    novels,
                    key=lambda row: (
                        -(row["reading_list_count"] or 0),
                        -(row["rating_votes"] or 0),
                        row["id"],
                    ),
                )[:catalog_limit],
                key=lambda row: row["id"],
            )
        else:
            bootstrap_novels = novels

        exported_ids = {row["id"] for row in bootstrap_novels}
        catalog_ids = {row["id"] for row in novels}
        languages, language_ids = _indexed_values(row["language"] for row in novels)
        statuses, status_ids = _indexed_values(row["status_trans"] for row in novels)
        genre_rows = conn.execute("SELECT id, name FROM genres ORDER BY id").fetchall()
        tag_rows   = conn.execute("SELECT id, name FROM tags ORDER BY id").fetchall()
        genres = [row["name"] for row in genre_rows]
        tags   = [row["name"] for row in tag_rows]
        genre_indices = {row["id"]: index for index, row in enumerate(genre_rows)}
        tag_indices   = {row["id"]: index for index, row in enumerate(tag_rows)}
        list_titles = {row["id"]: row["title"] for row in conn.execute("SELECT id, title FROM rec_lists")}
        genre_map: dict[int, list[int]] = {}
        tag_map:   dict[int, list[int]] = {}
        for novel_id, genre_id in conn.execute("SELECT novel_id, genre_id FROM novel_genres ORDER BY novel_id, genre_id"):
            genre_map.setdefault(novel_id, []).append(genre_indices[genre_id])
        for novel_id, tag_id in conn.execute("SELECT novel_id, tag_id FROM novel_tags ORDER BY novel_id, tag_id"):
            tag_map.setdefault(novel_id, []).append(tag_indices[tag_id])
        direct_counts = dict(conn.execute(
            """SELECT novel_id, COUNT(*) FROM (
                   SELECT source_novel_id AS novel_id FROM direct_recs
                   UNION ALL SELECT target_novel_id FROM direct_recs
               ) GROUP BY novel_id"""
        ))
        related_counts = dict(conn.execute(
            """SELECT novel_id, COUNT(*) FROM (
                   SELECT source_novel_id AS novel_id FROM related_series
                   UNION ALL SELECT target_novel_id FROM related_series
               ) GROUP BY novel_id"""
        ))
        list_counts = dict(conn.execute("SELECT novel_id, COUNT(*) FROM rec_list_items GROUP BY novel_id"))

        rows, aliases = [], []
        details: dict[int, dict[str, Any]] = {}
        for row in novels:
            novel_id = row["id"]
            rows.append([
                novel_id, row["slug"] or "", row["title"], row["author"] or "",
                row["cover_url"] or "", row["rating"] or 0, row["rating_votes"] or 0,
                row["reading_list_count"] or 0, row["year"],
                language_ids.get(row["language"], 0), status_ids.get(row["status_trans"], 0),
                row["chapters_trans"] or 0, genre_map.get(novel_id, []),
            ])
            names = _decode_names(row["associated_names"])
            if names:
                aliases.append([novel_id, names])
            ext_url = (
                row["external_url"]
                or (f"https://anilist.co/manga/{row['external_id']}" if row["source"] == "anilist" and row["external_id"] else f"https://www.novelupdates.com/?p={novel_id}")
            )
            details[novel_id] = {
                "id": novel_id,
                "synopsis": row["synopsis"] or "",
                "associated_names": names,
                "genre_ids": genre_map.get(novel_id, []),
                "tag_ids": tag_map.get(novel_id, []),
                "original_chapters": row["chapters_orig"] or 0,
                "rating_votes_5": row["rating_votes_5"] or 0,
                "rating_votes_4": row["rating_votes_4"] or 0,
                "rating_votes_3": row["rating_votes_3"] or 0,
                "rating_votes_2": row["rating_votes_2"] or 0,
                "rating_votes_1": row["rating_votes_1"] or 0,
                "media_type": row["media_type"] or ("manga" if novel_id >= 2000000 else "novel"),
                "source": row["source"] or ("anilist" if novel_id >= 2000000 else "novelupdates"),
                "external_id": row["external_id"] or str(novel_id),
                "external_url": ext_url,
                "direct_recommendation_count": direct_counts.get(novel_id, 0),
                "related_series_count": related_counts.get(novel_id, 0),
                "recommendation_list_count": list_counts.get(novel_id, 0),
                "novelupdates_url": ext_url,
            }

        catalog = {
            "fields": list(CATALOG_FIELDS), "rows": rows, "aliases": aliases,
            "languages": languages, "statuses": statuses, "genres": genres, "tags": tags,
        }
        _atomic_json(output / "catalog.json", catalog)
        if catalog_limit is not None:
            bootstrap_ids = {row["id"] for row in bootstrap_novels}
            bootstrap_rows    = [row for row in rows if row[0] in bootstrap_ids]
            bootstrap_aliases = [entry for entry in aliases if entry[0] in bootstrap_ids]
            _atomic_json(output / "bootstrap-catalog.json", {
                **catalog, "rows": bootstrap_rows, "aliases": bootstrap_aliases,
            })
        _atomic_json(output / "facets.json", {
            "genres": genres, "tags": tags,
            "novels": {str(row["id"]): {"g": genre_map.get(row["id"], []), "t": tag_map.get(row["id"], [])}
                       for row in novels},
        })
        _atomic_json(output / "options.json", {
            "genres": genres, "tags": tags,
            "languages": [v for v in languages if v],
            "statuses":  [v for v in statuses if v],
        })

        t_meta = time.perf_counter()
        ts = datetime.now().strftime("%H:%M:%S")
        print(f"[{ts}] metadata: ✓ Done in {t_meta - t0:.1f}s", flush=True)

        # --- PARALLEL details phase ---
        ts = datetime.now().strftime("%H:%M:%S")
        print(f"[{ts}] details: Writing {len(bootstrap_novels):,} detail files...", flush=True)
        detail_items = [
            (output / "details" / bucket_for_id(row["id"]) / f"{row['id']}.json", details[row["id"]])
            for row in bootstrap_novels
        ]
        with ThreadPoolExecutor(max_workers=min(32, n_workers * 4)) as io_exec:
            list(io_exec.map(lambda item: _atomic_json(item[0], item[1]), detail_items))

        # --- PARALLEL rich pool phase ---
        ordered_seeds = conn.execute(
            "SELECT id FROM novels ORDER BY reading_list_count DESC, rating_votes DESC, id ASC"
        ).fetchall()
        selected = {row["id"] for row in ordered_seeds[:max_novels]} if max_novels is not None else {
            row["id"] for row in ordered_seeds
        }
        selected &= exported_ids

        generator = CandidateGenerator(conn)
        ts = datetime.now().strftime("%H:%M:%S")
        print(f"[{ts}] rich-pools: Pre-building vector matrix and caching tag maps for {len(exported_ids):,} titles...", flush=True)
        _ = generator._get_vector_data()
        _ = generator._get_novel_tags_map()
        _ = generator._get_idf_dict()

        selected_novels = [row["id"] for row in bootstrap_novels if row["id"] in selected]
        rich_log = ProgressLogger("rich-pools", len(selected_novels), min_interval_s=1.0)

        import threading
        thread_local = threading.local()

        def _process_rich_pool(novel_id: int) -> bool:
            if not hasattr(thread_local, "conn"):
                thread_local.conn = get_connection(db_path)
            tconn = thread_local.conn

            pool_path = output / "recs" / bucket_for_id(novel_id) / f"{novel_id}.json"
            if reuse_recommendations and pool_path.is_file():
                pool = json.loads(pool_path.read_text())
                if pool.get("seed") != novel_id:
                    raise ValueError(f"invalid reusable recommendation pool for {novel_id}")
            else:
                pool = _export_pool(tconn, generator, novel_id, candidate_limit, tag_indices, list_titles)
                pool["candidates"] = [c for c in pool["candidates"] if c["id"] in exported_ids]
                if not pool["candidates"]:
                    pool["reason"] = "no_candidates_in_snapshot"
            if pool is not None:
                _atomic_json(pool_path, pool)
                return bool(pool.get("candidates"))
            elif pool_path.exists():
                pool_path.unlink()
            return False

        rich_recommendable = 0
        with ThreadPoolExecutor(max_workers=min(16, n_workers * 2)) as rich_exec:
            futures = [rich_exec.submit(_process_rich_pool, nid) for nid in selected_novels]
            for future in as_completed(futures):
                rich_recommendable += future.result()
                rich_log.update(1)
        rich_log.done_msg()

        t_rich = time.perf_counter()

        # --- PARALLEL compact pool phase ---
        # Each worker spawns fresh, runs _worker_init() which builds its own
        # CompactCandidateIndex from SQLite — zero pickling of the big object.
        # Workers only receive tiny lists of novel IDs.
        all_novel_ids = sorted(catalog_ids)
        chunk_size = max(50, math.ceil(len(all_novel_ids) / (n_workers * 16)))
        chunks = [all_novel_ids[i:i + chunk_size] for i in range(0, len(all_novel_ids), chunk_size)]

        ts = datetime.now().strftime("%H:%M:%S")
        print(
            f"[{ts}] compact-pools: Dispatching {len(chunks)} chunks across {n_workers} workers "
            f"({len(all_novel_ids):,} novels, ~{chunk_size:,} each) — "
            f"each worker builds its own index from SQLite",
            flush=True,
        )

        compact_results: dict[int, list[list[Any]]] = {}
        compact_log = ProgressLogger("compact-pools", len(all_novel_ids))
        with ProcessPoolExecutor(
            max_workers=n_workers,
            initializer=_worker_init,
            initargs=(db_path, all_novel_ids, tag_indices),
        ) as executor:
            futures = {
                executor.submit(_compact_pool_worker, (chunk, compact_candidate_limit)): len(chunk)
                for chunk in chunks
            }
            for future in as_completed(futures):
                pairs = future.result()
                for novel_id, pool in pairs:
                    compact_results[novel_id] = pool
                compact_log.update(futures[future])
        compact_log.done_msg()

        t_pools = time.perf_counter()

        # Assemble bucket maps
        compact_buckets: dict[str, dict[str, list[list[Any]]]] = defaultdict(dict)
        recommendable = 0
        for novel_id, pool in compact_results.items():
            compact_buckets[bucket_for_id(novel_id)][str(novel_id)] = pool
            recommendable += bool(pool)

        # Pre-create recommendation-index directory once
        (output / "recommendation-index").mkdir(parents=True, exist_ok=True)

        # --- PARALLEL bucket write phase (I/O-bound → ThreadPoolExecutor) ---
        bucket_log = ProgressLogger("bucket-writes", 256)
        write_args = [
            (output, f"{v:02x}", compact_buckets.get(f"{v:02x}", {}))
            for v in range(256)
        ]

        def _write_and_log(arg: tuple) -> None:
            _write_bucket(arg)
            bucket_log.update()

        with ThreadPoolExecutor(max_workers=min(32, n_workers * 4)) as io_exec:
            list(io_exec.map(_write_and_log, write_args))
        bucket_log.done_msg()

        t_write = time.perf_counter()

        # Cleanup orphaned files from a narrower catalog scope
        for group in ("details", "recs"):
            for path in (output / group).glob("*/*.json"):
                if path.stem.isdigit() and int(path.stem) not in exported_ids:
                    path.unlink()

        generated_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        manifest = {
            "schema_version": SCHEMA_VERSION,
            "algorithm_version": ALGORITHM_VERSION,
            "dataset_version": _dataset_version(conn),
            "generated_at": generated_at,
            "novel_count": len(novels),
            "source_novel_count": source_novel_count,
            "bootstrap_novel_count": len(bootstrap_novels),
            "detail_novel_count": len(bootstrap_novels),
            "recommendation_seed_count": len(selected),
            "rich_recommendation_seed_count": len(selected),
            "snapshot_scope": (
                f"complete_catalog_with_top_{len(bootstrap_novels)}_bootstrap"
                if catalog_limit is not None else "complete_catalog"
            ),
            "recommendable_seed_count": recommendable,
            "rich_recommendable_seed_count": rich_recommendable,
            "recommendation_index_url": "recommendation-index/{bucket}.json",
            "recommendation_index_seed_count": len(catalog_ids),
            "recommendation_index_candidate_limit": compact_candidate_limit,
            "catalog_url": "catalog.json",
            "bootstrap_catalog_url": (
                "bootstrap-catalog.json" if catalog_limit is not None else "catalog.json"
            ),
            "facets_url": "facets.json",
            "options_url": "options.json",
            "bucket_count": 256,
        }
        _atomic_json(output / "manifest.json", manifest)

        t_total = time.perf_counter()
        ts = datetime.now().strftime("%H:%M:%S")
        print(
            f"[{ts}] export: ✓ Total {t_total - t0:.1f}s  "
            f"| meta {t_meta-t0:.1f}s"
            f"  rich-pools {t_rich-t_meta:.1f}s"
            f"  compact-pools {t_pools-t_rich:.1f}s"
            f"  bucket-writes {t_write-t_pools:.1f}s",
            flush=True,
        )

        verify_export(output, expected_novels=len(novels), expected_bootstrap_novels=len(bootstrap_novels))
        return manifest
    finally:
        conn.close()


def verify_export(
    output: Path,
    expected_novels: int | None = None,
    expected_bootstrap_novels: int | None = None,
) -> None:
    manifest = json.loads((output / "manifest.json").read_text())
    catalog = json.loads((output / manifest["catalog_url"]).read_text())
    if catalog["fields"] != list(CATALOG_FIELDS):
        raise ValueError("catalog fields do not match the static schema")
    if expected_novels is not None and len(catalog["rows"]) != expected_novels:
        raise ValueError("catalog novel count is incomplete")
    if manifest["novel_count"] != len(catalog["rows"]):
        raise ValueError("manifest and catalog novel counts differ")
    bootstrap = json.loads(
        (output / manifest.get("bootstrap_catalog_url", manifest["catalog_url"])).read_text()
    )
    if bootstrap["fields"] != list(CATALOG_FIELDS):
        raise ValueError("bootstrap catalog fields do not match the static schema")
    if expected_bootstrap_novels is not None and len(bootstrap["rows"]) != expected_bootstrap_novels:
        raise ValueError("bootstrap catalog novel count is incomplete")
    if manifest.get("bootstrap_novel_count", len(bootstrap["rows"])) != len(bootstrap["rows"]):
        raise ValueError("manifest and bootstrap catalog novel counts differ")
    options = json.loads((output / manifest.get("options_url", "options.json")).read_text())
    if options.get("genres") != catalog.get("genres") or options.get("tags") != catalog.get("tags"):
        raise ValueError("options and catalog facet dictionaries differ")
    for row in bootstrap["rows"]:
        novel_id = row[0]
        path = output / "details" / bucket_for_id(novel_id) / f"{novel_id}.json"
        if not path.is_file():
            raise ValueError(f"missing details artifact for novel {novel_id}")
        if json.loads(path.read_text())["id"] != novel_id:
            raise ValueError(f"invalid details artifact for novel {novel_id}")
    index_template = manifest.get("recommendation_index_url")
    if index_template:
        indexed_seeds = 0
        for bucket in (f"{v:02x}" for v in range(manifest.get("bucket_count", 256))):
            path = output / index_template.replace("{bucket}", bucket)
            if not path.is_file():
                raise ValueError(f"missing compact recommendation bucket {bucket}")
            shard = json.loads(path.read_text())
            if shard.get("channels") != list(CHANNELS):
                raise ValueError(f"invalid compact recommendation channels in bucket {bucket}")
            for raw_id, candidates in shard.get("pools", {}).items():
                if bucket_for_id(int(raw_id)) != bucket or not isinstance(candidates, list):
                    raise ValueError(f"invalid compact recommendation pool for {raw_id}")
                indexed_seeds += 1
        if indexed_seeds != manifest.get("recommendation_index_seed_count"):
            raise ValueError("compact recommendation index seed count differs")


def main() -> None:
    parser = argparse.ArgumentParser(description="Build normalized static recommendation artifacts (parallel)")
    parser.add_argument("--output", type=Path, default=Path("web/public/data"))
    parser.add_argument("--db", default=DEFAULT_DB_PATH)
    parser.add_argument("--max-novels", type=int)
    parser.add_argument("--candidate-limit", type=int, default=200)
    parser.add_argument("--compact-candidate-limit", type=int, default=50)
    parser.add_argument("--bootstrap-limit", "--catalog-limit", dest="catalog_limit", type=int)
    parser.add_argument("--reuse-recommendations", action="store_true")
    parser.add_argument("--workers", type=int, default=None,
                        help="Parallel worker processes (default: cpu_count-1)")
    parser.add_argument("--verify-only", action="store_true")
    args = parser.parse_args()
    if args.verify_only:
        verify_export(args.output)
    else:
        manifest = export_static_dataset(
            args.output, args.max_novels, args.db, args.candidate_limit,
            args.catalog_limit, args.reuse_recommendations,
            args.compact_candidate_limit, args.workers,
        )
        print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
