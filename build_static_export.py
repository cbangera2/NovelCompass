"""Build the versioned, normalized static projection of recommender.db."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

from src.db.schema import DEFAULT_DB_PATH, get_connection
from src.engine.candidate_gen import CandidateGenerator


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


def export_static_dataset(
    output: Path,
    max_novels: int | None = None,
    db_path: str = DEFAULT_DB_PATH,
    candidate_limit: int = 200,
    catalog_limit: int | None = None,
    reuse_recommendations: bool = False,
) -> dict[str, Any]:
    conn = get_connection(db_path)
    try:
        source_novel_count = conn.execute("SELECT COUNT(*) FROM novels").fetchone()[0]
        if catalog_limit is not None:
            novels = conn.execute(
                """SELECT id, slug, title, author, cover_url, rating, rating_votes,
                          reading_list_count, year, language, status_trans,
                          chapters_trans, chapters_orig, synopsis, associated_names
                   FROM novels
                   ORDER BY reading_list_count DESC, rating_votes DESC, id ASC
                   LIMIT ?""",
                (catalog_limit,),
            ).fetchall()
            novels = sorted(novels, key=lambda row: row["id"])
        else:
            novels = conn.execute(
            """SELECT id, slug, title, author, cover_url, rating, rating_votes,
                      reading_list_count, year, language, status_trans,
                      chapters_trans, chapters_orig, synopsis, associated_names
               FROM novels ORDER BY id"""
            ).fetchall()
        exported_ids = {row["id"] for row in novels}
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
            detail = {
                "id": novel_id,
                "synopsis": row["synopsis"] or "",
                "associated_names": names,
                "genre_ids": genre_map.get(novel_id, []),
                "tag_ids": tag_map.get(novel_id, []),
                "original_chapters": row["chapters_orig"] or 0,
                "direct_recommendation_count": direct_counts.get(novel_id, 0),
                "related_series_count": related_counts.get(novel_id, 0),
                "recommendation_list_count": list_counts.get(novel_id, 0),
                "novelupdates_url": f"https://www.novelupdates.com/?p={novel_id}",
            }
            _atomic_json(output / "details" / bucket_for_id(novel_id) / f"{novel_id}.json", detail)

        _atomic_json(output / "catalog.json", {
            "fields": list(CATALOG_FIELDS), "rows": rows, "aliases": aliases,
            "languages": languages, "statuses": statuses,
            "genres": genres, "tags": tags,
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
        generator = CandidateGenerator(conn)
        recommendable = 0
        for index, row in enumerate(novels, 1):
            novel_id = row["id"]
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
                pool = {"seed": novel_id, "algorithm_version": ALGORITHM_VERSION,
                        "channels": list(CHANNELS), "candidates": [], "reason": "not_precomputed"}
            recommendable += bool(pool["candidates"])
            _atomic_json(pool_path, pool)
            if index % 100 == 0:
                print(f"Exported recommendation pools: {index}/{len(novels)}")

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
            "snapshot_scope": (
                f"top_{len(novels)}_by_reading_list_count"
                if catalog_limit is not None else "complete_catalog"
            ),
            "recommendable_seed_count": recommendable,
            "catalog_url": "catalog.json",
            "facets_url": "facets.json",
            "options_url": "options.json",
            "bucket_count": 256,
        }
        _atomic_json(output / "manifest.json", manifest)
        verify_export(output, expected_novels=len(novels))
        return manifest
    finally:
        conn.close()


def verify_export(output: Path, expected_novels: int | None = None) -> None:
    manifest = json.loads((output / "manifest.json").read_text())
    catalog = json.loads((output / manifest["catalog_url"]).read_text())
    if catalog["fields"] != list(CATALOG_FIELDS):
        raise ValueError("catalog fields do not match the static schema")
    if expected_novels is not None and len(catalog["rows"]) != expected_novels:
        raise ValueError("catalog novel count is incomplete")
    if manifest["novel_count"] != len(catalog["rows"]):
        raise ValueError("manifest and catalog novel counts differ")
    options = json.loads((output / manifest.get("options_url", "options.json")).read_text())
    if options.get("genres") != catalog.get("genres") or options.get("tags") != catalog.get("tags"):
        raise ValueError("options and catalog facet dictionaries differ")
    for row in catalog["rows"]:
        novel_id = row[0]
        for group in ("details", "recs"):
            path = output / group / bucket_for_id(novel_id) / f"{novel_id}.json"
            if not path.is_file():
                raise ValueError(f"missing {group} artifact for novel {novel_id}")
            if json.loads(path.read_text())["id" if group == "details" else "seed"] != novel_id:
                raise ValueError(f"invalid {group} artifact for novel {novel_id}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Build normalized static recommendation artifacts")
    parser.add_argument("--output", type=Path, default=Path("web/public/data"))
    parser.add_argument("--db", default=DEFAULT_DB_PATH)
    parser.add_argument("--max-novels", type=int, help="Precompute only the N most popular seed pools")
    parser.add_argument("--candidate-limit", type=int, default=200)
    parser.add_argument(
        "--catalog-limit", type=int,
        help="Export only the N most-read catalog titles (explicitly recorded in the manifest)",
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
        )
        print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
