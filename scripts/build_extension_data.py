#!/usr/bin/env python3
"""Build and verify immutable, broker-safe Novel Compass extension data."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import tempfile
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

MAX_ARTIFACT_BYTES = 2 * 1024 * 1024
MAX_MANIFEST_BYTES = 512 * 1024
MAX_POINTER_BYTES = 64 * 1024
SCHEMA_VERSION = 1
DATA_CLIENT_VERSION = 1
PREFIX_LENGTH = 2


def json_bytes(value: Any) -> bytes:
    return (json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True) + "\n").encode(
        "utf-8"
    )


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def normalized_prefix(value: str) -> str:
    folded = value.casefold()
    normalized = re.sub(r"[^a-z0-9]+", "", folded)
    if normalized:
        return normalized[:PREFIX_LENGTH].ljust(PREFIX_LENGTH, "_")
    # Keep non-Latin titles searchable without unsafe Unicode path names.
    return "u" + hashlib.sha256(folded.encode("utf-8")).hexdigest()[:2]


def safe_version(value: str) -> str:
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}", value):
        raise ValueError(f"unsafe dataset_version: {value!r}")
    return value


def load_json(path: Path) -> Any:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def record_count(value: Any) -> int:
    if isinstance(value, list):
        return len(value)
    if isinstance(value, dict):
        if isinstance(value.get("rows"), list):
            return len(value["rows"])
        if isinstance(value.get("pools"), dict):
            return len(value["pools"])
        return len(value)
    return 0


class ReleaseWriter:
    def __init__(self, release_root: Path, release_url: str) -> None:
        self.release_root = release_root
        self.release_url = release_url.rstrip("/")
        self.artifacts: dict[str, dict[str, Any]] = {}

    def add_bytes(
        self, logical_path: str, value: bytes, count: int, storage_path: str | None = None
    ) -> None:
        if not logical_path.endswith(".json") or logical_path.startswith("/") or ".." in Path(logical_path).parts:
            raise ValueError(f"unsafe artifact path: {logical_path}")
        if len(value) > MAX_ARTIFACT_BYTES:
            raise ValueError(f"{logical_path} is {len(value)} bytes; limit is {MAX_ARTIFACT_BYTES}")
        physical_path = storage_path or logical_path
        target = self.release_root / physical_path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(value)
        self.artifacts[logical_path] = {
            # Artifact URLs are relative to the immutable manifest. Besides
            # making releases origin-portable, this keeps the manifest below
            # the broker's 512 KiB limit for thousands of small shards.
            "url": physical_path,
            "sha256": sha256_bytes(value),
            "compressed_bytes": len(value),
            "uncompressed_bytes": len(value),
            "record_count": count,
        }

    def add_json(
        self,
        logical_path: str,
        value: Any,
        count: int | None = None,
        storage_path: str | None = None,
    ) -> None:
        self.add_bytes(
            logical_path,
            json_bytes(value),
            record_count(value) if count is None else count,
            storage_path,
        )

    def copy_json(self, source: Path, logical_path: str) -> None:
        value = load_json(source)
        self.add_bytes(logical_path, source.read_bytes(), record_count(value))


def add_search_bucket(
    writer: ReleaseWriter,
    prefix: str,
    fields: list[str],
    rows: list[list[Any]],
) -> list[str]:
    """Write one prefix as one or more independently broker-safe artifacts."""
    encoded_rows = [(json_bytes(row).rstrip(b"\n"), row) for row in rows]
    overhead = len(json_bytes({"fields": fields, "rows": []}))
    chunks: list[list[list[Any]]] = []
    current: list[list[Any]] = []
    current_bytes = overhead
    for encoded, row in encoded_rows:
        addition = len(encoded) + (1 if current else 0)
        if current and current_bytes + addition > MAX_ARTIFACT_BYTES:
            chunks.append(current)
            current = []
            current_bytes = overhead
        current.append(row)
        current_bytes += len(encoded) + (1 if len(current) > 1 else 0)
    if current:
        chunks.append(current)
    paths = []
    for index, chunk in enumerate(chunks):
        suffix = "" if len(chunks) == 1 else f"-{index:02x}"
        logical_path = f"search/{prefix}{suffix}.json"
        writer.add_json(logical_path, {"fields": fields, "rows": chunk}, len(chunk))
        paths.append(logical_path)
    return paths


def build(source: Path, output: Path, base_url: str) -> Path:
    parsed = urlparse(base_url)
    if parsed.scheme != "https" or not parsed.netloc:
        raise ValueError("--base-url must be an absolute HTTPS URL")
    source_manifest = load_json(source / "manifest.json")
    version = safe_version(str(source_manifest["dataset_version"]))
    extension_root = output / "v1"
    release_url = f"{base_url.rstrip('/')}/v1/{version}"

    output.parent.mkdir(parents=True, exist_ok=True)
    staging_parent = Path(tempfile.mkdtemp(prefix=".extension-data-", dir=output.parent))
    staging_release = staging_parent / version
    writer = ReleaseWriter(staging_release, release_url)
    try:
        catalog = load_json(source / "catalog.json")
        fields = catalog["fields"]
        title_index = fields.index("title")
        id_index = fields.index("id")
        aliases_by_id = {str(row[0]): row[1] for row in catalog.get("aliases", [])}
        search_buckets: dict[str, list[list[Any]]] = defaultdict(list)
        for row in catalog["rows"]:
            aliases = aliases_by_id.get(str(row[id_index]), [])
            compact_row = list(row) + [aliases]
            prefixes = {normalized_prefix(str(row[title_index]))}
            prefixes.update(normalized_prefix(str(alias)) for alias in aliases)
            for prefix in prefixes:
                search_buckets[prefix].append(compact_row)
        search_index: dict[str, list[str]] = defaultdict(list)
        search_artifacts: dict[str, list[str]] = {}
        for prefix, rows in sorted(search_buckets.items()):
            search_artifacts[prefix] = add_search_bucket(
                writer, prefix, fields + ["aliases"], rows
            )
            search_index[prefix[0]].append(prefix)
        writer.add_json(
            "search/index.json",
            {
                "bucket_function": "normalized-title-or-alias-prefix",
                "bucket_function_version": 1,
                "prefix_length": PREFIX_LENGTH,
                "non_latin_bucket_function": "u-plus-sha256-first-byte",
                "prefixes_by_first_character": dict(sorted(search_index.items())),
                "artifacts_by_prefix": search_artifacts,
            },
            len(search_buckets),
        )

        facets = load_json(source / "facets.json")
        writer.add_json(
            "facets/options.json",
            {"genres": facets["genres"], "tags": facets["tags"]},
            len(facets["genres"]) + len(facets["tags"]),
        )
        facet_buckets: dict[str, dict[str, Any]] = defaultdict(dict)
        for novel_id, value in facets["novels"].items():
            bucket = f"{int(novel_id) & 0xff:02x}"
            facet_buckets[bucket][novel_id] = value
        for bucket, novels in sorted(facet_buckets.items()):
            writer.add_json(f"facets/novels/{bucket}.json", novels)

        writer.copy_json(source / "options.json", "options.json")
        if (source / "bootstrap-catalog.json").exists():
            writer.copy_json(source / "bootstrap-catalog.json", "bootstrap-catalog.json")
        for source_path in sorted((source / "details").glob("*.json")):
            writer.copy_json(source_path, f"details/{source_path.name}")
        for source_path in sorted((source / "recommendation-index").glob("*.json")):
            writer.copy_json(source_path, f"recommendations/{source_path.name}")

        identity_buckets: dict[str, list[list[Any]]] = defaultdict(list)
        for row in catalog["rows"]:
            identity_buckets[f"{int(row[id_index]) & 0xff:02x}"].append(
                list(row) + [aliases_by_id.get(str(row[id_index]), [])]
            )
        for bucket, rows in sorted(identity_buckets.items()):
            writer.add_json(
                f"identity/{bucket}.json",
                {"fields": fields + ["aliases"], "rows": rows},
                len(rows),
            )

        generated_at = str(source_manifest.get("generated_at") or datetime.now(timezone.utc).isoformat())
        compatibility_manifest = {
            **source_manifest,
            "bootstrap_catalog_url": "bootstrap-catalog.json",
            "catalog_url": "bootstrap-catalog.json",
            "options_url": "options.json",
            "recommendation_index_url": "recommendations/{bucket}.json",
            "extension_search_index_url": "search/index.json",
            "extension_identity_url": "identity/{bucket}.json",
            "extension_facet_options_url": "facets/options.json",
            "extension_facet_novels_url": "facets/novels/{bucket}.json",
        }
        writer.add_json(
            "manifest.json", compatibility_manifest, storage_path="dataset.json"
        )
        manifest = {
            "schema_version": SCHEMA_VERSION,
            "minimum_data_client_version": DATA_CLIENT_VERSION,
            "dataset_version": version,
            "algorithm_version": source_manifest.get("algorithm_version"),
            "generated_at": generated_at,
            "source_novel_count": source_manifest.get("novel_count"),
            "bucket_functions": {
                "search": {
                    "name": "normalized-title-or-alias-prefix",
                    "version": 1,
                    "prefix_length": PREFIX_LENGTH,
                    "non_latin": "u-plus-sha256-first-byte",
                },
                "details": {"name": "stable-id-low-byte", "version": 1},
                "recommendations": {"name": "stable-id-low-byte", "version": 1},
                "facets": {"name": "stable-id-low-byte", "version": 1},
            },
            "artifacts": dict(sorted(writer.artifacts.items())),
        }
        manifest_value = json_bytes(manifest)
        if len(manifest_value) > MAX_MANIFEST_BYTES:
            raise ValueError(f"manifest is {len(manifest_value)} bytes; limit is {MAX_MANIFEST_BYTES}")
        (staging_release / "manifest.json").write_bytes(manifest_value)

        pointer = {
            "dataset_version": version,
            "manifest_url": f"{release_url}/manifest.json",
            "manifest_sha256": sha256_bytes(manifest_value),
        }
        pointer_value = json_bytes(pointer)
        if len(pointer_value) > MAX_POINTER_BYTES:
            raise ValueError("latest.json exceeds broker pointer limit")

        extension_root.mkdir(parents=True, exist_ok=True)
        final_release = extension_root / version
        if final_release.exists():
            existing_manifest = final_release / "manifest.json"
            if not existing_manifest.exists() or existing_manifest.read_bytes() != manifest_value:
                raise ValueError(
                    f"immutable release {version} already exists with different content"
                )
            shutil.rmtree(staging_release)
        else:
            os.replace(staging_release, final_release)
        for descriptor in manifest["artifacts"].values():
            artifact = final_release / descriptor["url"]
            value = artifact.read_bytes()
            if (
                len(value) != descriptor["uncompressed_bytes"]
                or sha256_bytes(value) != descriptor["sha256"]
            ):
                raise ValueError(f"immutable artifact failed pre-publish validation: {artifact}")
        pointer_tmp = extension_root / ".latest.json.tmp"
        pointer_tmp.write_bytes(pointer_value)
        os.replace(pointer_tmp, extension_root / "latest.json")
        verify(extension_root)
        return extension_root
    finally:
        shutil.rmtree(staging_parent, ignore_errors=True)


def verify(extension_root: Path) -> None:
    pointer_path = extension_root / "latest.json"
    if pointer_path.stat().st_size > MAX_POINTER_BYTES:
        raise ValueError("latest.json exceeds broker pointer limit")
    pointer = load_json(pointer_path)
    version = safe_version(str(pointer["dataset_version"]))
    manifest_path = extension_root / version / "manifest.json"
    manifest_bytes = manifest_path.read_bytes()
    if len(manifest_bytes) > MAX_MANIFEST_BYTES:
        raise ValueError("manifest exceeds broker manifest limit")
    if sha256_bytes(manifest_bytes) != pointer["manifest_sha256"]:
        raise ValueError("manifest digest does not match latest.json")
    manifest = json.loads(manifest_bytes)
    if manifest.get("schema_version") != SCHEMA_VERSION or manifest.get("dataset_version") != version:
        raise ValueError("manifest schema or dataset version is invalid")
    if manifest.get("minimum_data_client_version") != DATA_CLIENT_VERSION:
        raise ValueError("manifest data client version is invalid")
    for logical_path, descriptor in manifest.get("artifacts", {}).items():
        artifact_url = urlparse(descriptor["url"])
        if artifact_url.scheme:
            relative_url_path = artifact_url.path.split(f"/{version}/", 1)
            if len(relative_url_path) != 2:
                raise ValueError(f"{logical_path} URL is outside its release")
            artifact = extension_root / version / relative_url_path[1]
        else:
            artifact = extension_root / version / artifact_url.path
        value = artifact.read_bytes()
        if len(value) > MAX_ARTIFACT_BYTES:
            raise ValueError(f"{logical_path} exceeds broker artifact limit")
        if len(value) != descriptor["uncompressed_bytes"] or len(value) != descriptor["compressed_bytes"]:
            raise ValueError(f"{logical_path} size does not match manifest")
        if sha256_bytes(value) != descriptor["sha256"]:
            raise ValueError(f"{logical_path} digest does not match manifest")
        json.loads(value)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, default=Path("web/public/data"))
    parser.add_argument("--output", type=Path, default=Path("web/public/extension-data"))
    parser.add_argument(
        "--base-url",
        default="https://cbangera2.github.io/NovelCompass/extension-data",
    )
    parser.add_argument("--verify-only", action="store_true")
    args = parser.parse_args()
    if args.verify_only:
        verify(args.output / "v1")
        print(f"Verified extension data at {args.output / 'v1'}")
    else:
        root = build(args.source, args.output, args.base_url)
        print(f"Built and verified extension data at {root}")


if __name__ == "__main__":
    main()
