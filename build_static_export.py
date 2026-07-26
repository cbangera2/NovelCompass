"""Build the versioned, normalized static projection of recommender.db."""

from __future__ import annotations

import argparse
import hashlib
import heapq
import json
import math
import os
import re
import tempfile
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

from src.db.schema import DEFAULT_DB_PATH, get_connection
from src.engine.candidate_gen import CandidateGenerator
from src.nlp.taxonomy import HIGH_PRIORITY_TAGS


SCHEMA_VERSION = 1
ALGORITHM_VERSION = 1
CHANNELS = ("tag", "direct_rec", "rec_list", "structural", "vector")
CATALOG_FIELDS = (
    "id", "slug", "title", "author", "cover", "rating", "votes", "readers",
    "year", "language_id", "status_id", "translated_chapters", "genre_ids",
)


def bucket_for_id(novel_id: int) -> str:
    """Return the deterministic two-character bucket used by JS as well."""
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
    raw_channels = generator.get_candidate_channels(seed_id, limit_per_channel=limit)
    ranks: dict[int, dict[str, int]] = {}
    for channel in CHANNELS:
        for rank, (candidate_id, _score) in enumerate(raw_channels.get(channel, []), 1):
            if candidate_id != seed_id:
                ranks.setdefault(candidate_id, {})[channel] = rank
    # Strong candidates occur in more channels; the best channel rank breaks ties.
    selected = sorted(
        ranks,
        key=lambda candidate_id: (
            -len(ranks[candidate_id]),
            min(ranks[candidate_id].values()),
            candidate_id,
        ),
    )[:limit]
    evidence = _candidate_evidence(
        conn, seed_id, selected, tag_indices, list_titles
    )
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
    """Batch-friendly candidate lookup used for the all-catalog fallback.

    Unlike CandidateGenerator, this builds the tag, graph, list, author, and
    genre indexes once. Compact pools intentionally omit synopsis vectors and
    rich evidence; the richer per-title shards remain the preferred tier.
    """

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
                        candidate_id for candidate_id in author_ids if candidate_id != novel_id
                    )
        for source, target in conn.execute(
            "SELECT source_novel_id, target_novel_id FROM related_series"
        ):
            if source in novel_ids and target in novel_ids:
                self.structural[source].add(target)
                self.structural[target].add(source)

        # Genre peers provide a bounded metadata fallback for sparsely linked
        # titles. Popularity is only a tie breaker; no metadata is duplicated.
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

    @staticmethod
    def _top(scores: dict[int, float] | list[tuple[int, float]], limit: int) -> list[tuple[int, float]]:
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
            candidate_id: shared / (
                seed_total + self.tag_totals.get(candidate_id, 0.0) - shared
            )
            for candidate_id, shared in intersections.items()
        }

        list_scores: dict[int, float] = defaultdict(float)
        for list_id in self.lists_by_novel.get(seed_id, []):
            for candidate_id in self.novels_by_list[list_id]:
                if candidate_id != seed_id:
                    list_scores[candidate_id] += 1.0

        structural_scores = {
            candidate_id: 2.0
            for candidate_id in self.structural.get(seed_id, set())
        }
        if len(structural_scores) < limit:
            shared_genres: dict[int, float] = defaultdict(float)
            for genre_id in self.genres_by_novel.get(seed_id, set()):
                for candidate_id in self.novels_by_genre[genre_id]:
                    if candidate_id != seed_id and candidate_id not in structural_scores:
                        shared_genres[candidate_id] += 1.0
            genre_peers = self._top({
                candidate_id: shared * 1_000_000
                + math.log1p(max(0, self.popularity.get(candidate_id, 0)))
                for candidate_id, shared in shared_genres.items()
            }, limit - len(structural_scores))
            structural_scores.update(
                (candidate_id, score / 1_000_000) for candidate_id, score in genre_peers
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
            for rank, (candidate_id, _score) in enumerate(raw_channels[channel], 1):
                ranks.setdefault(candidate_id, {})[channel] = rank
        selected = sorted(
            ranks,
            key=lambda candidate_id: (
                -len(ranks[candidate_id]),
                min(ranks[candidate_id].values()),
                candidate_id,
            ),
        )[:limit]
        return [
            [
                candidate_id,
                [ranks[candidate_id].get(channel) for channel in CHANNELS],
                sorted(
                    self.tag_indices[tag_id]
                    for tag_id in (
                        self.tags_by_novel.get(seed_id, set())
                        & self.tags_by_novel.get(candidate_id, set())
                    )
                ),
            ]
            for candidate_id in selected
        ]


def export_static_dataset(
    output: Path,
    max_novels: int | None = None,
    db_path: str = DEFAULT_DB_PATH,
    candidate_limit: int = 200,
    catalog_limit: int | None = None,
    reuse_recommendations: bool = False,
    compact_candidate_limit: int = 50,
) -> dict[str, Any]:
    conn = get_connection(db_path)
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
        tag_rows = conn.execute("SELECT id, name FROM tags ORDER BY id").fetchall()
        genres = [row["name"] for row in genre_rows]
        tags = [row["name"] for row in tag_rows]
        genre_indices = {row["id"]: index for index, row in enumerate(genre_rows)}
        tag_indices = {row["id"]: index for index, row in enumerate(tag_rows)}
        list_titles = {
            row["id"]: row["title"]
            for row in conn.execute("SELECT id, title FROM rec_lists")
        }
        genre_map: dict[int, list[int]] = {}
        tag_map: dict[int, list[int]] = {}
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
        list_counts = dict(conn.execute(
            "SELECT novel_id, COUNT(*) FROM rec_list_items GROUP BY novel_id"
        ))

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
            ext_url = row["external_url"] or (f"https://anilist.co/manga/{row['external_id']}" if row["source"] == "anilist" and row["external_id"] else f"https://www.novelupdates.com/?p={novel_id}")
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
            "languages": languages, "statuses": statuses,
            "genres": genres, "tags": tags,
        }
        _atomic_json(output / "catalog.json", catalog)
        if catalog_limit is not None:
            bootstrap_ids = {row["id"] for row in bootstrap_novels}
            bootstrap_rows = [row for row in rows if row[0] in bootstrap_ids]
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
            "genres": genres,
            "tags": tags,
            "languages": [value for value in languages if value],
            "statuses": [value for value in statuses if value],
        })

        ordered_seeds = conn.execute(
            """SELECT id FROM novels
               ORDER BY reading_list_count DESC, rating_votes DESC, id ASC"""
        ).fetchall()
        selected = {row["id"] for row in ordered_seeds[:max_novels]} if max_novels is not None else {
            row["id"] for row in ordered_seeds
        }
        selected &= exported_ids
        generator = CandidateGenerator(conn)
        rich_recommendable = 0
        for index, row in enumerate(bootstrap_novels, 1):
            novel_id = row["id"]
            _atomic_json(
                output / "details" / bucket_for_id(novel_id) / f"{novel_id}.json",
                details[novel_id],
            )
            pool_path = output / "recs" / bucket_for_id(novel_id) / f"{novel_id}.json"
            if reuse_recommendations and pool_path.is_file():
                pool = json.loads(pool_path.read_text())
                if pool.get("seed") != novel_id:
                    raise ValueError(f"invalid reusable recommendation pool for {novel_id}")
            elif novel_id in selected:
                pool = _export_pool(
                    conn, generator, novel_id, candidate_limit,
                    tag_indices, list_titles
                )
                pool["candidates"] = [
                    candidate for candidate in pool["candidates"]
                    if candidate["id"] in exported_ids
                ]
                if not pool["candidates"]:
                    pool["reason"] = "no_candidates_in_snapshot"
            else:
                pool = None
            if pool is not None:
                rich_recommendable += bool(pool["candidates"])
                _atomic_json(pool_path, pool)
            elif pool_path.exists():
                pool_path.unlink()
            if index % 100 == 0:
                print(f"Exported recommendation pools: {index}/{len(bootstrap_novels)}")

        compact_index = CompactCandidateIndex(conn, catalog_ids, tag_indices)
        compact_buckets: dict[str, dict[str, list[list[Any]]]] = defaultdict(dict)
        recommendable = 0
        for index, novel_id in enumerate(sorted(catalog_ids), 1):
            compact_pool = compact_index.pool(novel_id, compact_candidate_limit)
            compact_buckets[bucket_for_id(novel_id)][str(novel_id)] = compact_pool
            recommendable += bool(compact_pool)
            if index % 1000 == 0:
                print(f"Exported compact recommendation pools: {index}/{len(catalog_ids)}")
        for bucket in (f"{value:02x}" for value in range(256)):
            _atomic_json(output / "recommendation-index" / f"{bucket}.json", {
                "algorithm_version": ALGORITHM_VERSION,
                "channels": list(CHANNELS),
                "pools": compact_buckets.get(bucket, {}),
            })

        # Re-running a bounded export into the same directory must not leave
        # addressable detail/pool files from a different catalog scope.
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
        verify_export(
            output,
            expected_novels=len(novels),
            expected_bootstrap_novels=len(bootstrap_novels),
        )
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
        for bucket in (f"{value:02x}" for value in range(manifest.get("bucket_count", 256))):
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
    parser = argparse.ArgumentParser(description="Build normalized static recommendation artifacts")
    parser.add_argument("--output", type=Path, default=Path("web/public/data"))
    parser.add_argument("--db", default=DEFAULT_DB_PATH)
    parser.add_argument("--max-novels", type=int, help="Precompute only the N most popular seed pools")
    parser.add_argument("--candidate-limit", type=int, default=200)
    parser.add_argument(
        "--compact-candidate-limit",
        type=int,
        default=50,
        help="Candidates retained per title in the all-catalog compact fallback",
    )
    parser.add_argument(
        "--bootstrap-limit", "--catalog-limit", dest="catalog_limit", type=int,
        help=(
            "Put the N most-read titles in the fast bootstrap and bound detail/"
            "recommendation shards to them; catalog.json always contains every title"
        ),
    )
    parser.add_argument(
        "--reuse-recommendations", action="store_true",
        help="Reuse already generated, ID-validated pool files while refreshing metadata",
    )
    parser.add_argument("--verify-only", action="store_true")
    args = parser.parse_args()
    if args.verify_only:
        verify_export(args.output)
    else:
        manifest = export_static_dataset(
            args.output, args.max_novels, args.db, args.candidate_limit,
            args.catalog_limit,
            args.reuse_recommendations,
            args.compact_candidate_limit,
        )
        print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
