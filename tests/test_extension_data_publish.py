import hashlib
import json
from pathlib import Path

import pytest

from scripts.build_extension_data import MAX_ARTIFACT_BYTES, build, verify


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, separators=(",", ":")), encoding="utf-8")


def fixture_source(root: Path) -> Path:
    source = root / "data"
    fields = [
        "id",
        "slug",
        "title",
        "author",
        "cover",
        "rating",
        "votes",
        "readers",
        "year",
        "language_id",
        "status_id",
        "translated_chapters",
        "genre_ids",
        "media_type",
        "source",
        "external_id",
        "external_url",
    ]
    write_json(
        source / "manifest.json",
        {
            "schema_version": 1,
            "algorithm_version": 1,
            "dataset_version": "test-v1",
            "generated_at": "2026-07-29T00:00:00Z",
            "novel_count": 2,
        },
    )
    write_json(
        source / "catalog.json",
        {
            "fields": fields,
            "rows": [
                [1, "alpha", "Alpha", "A", "", 4, 1, 1, 2020, 0, 0, 1, [0], "novel", "nu", "1", "https://example/1"],
                [2, "beta", "Beta", "B", "", 4, 1, 1, 2021, 0, 0, 1, [1], "novel", "nu", "2", "https://example/2"],
            ],
            "aliases": [[1, ["The First"]], [2, ["Alpha Two"]]],
        },
    )
    write_json(
        source / "bootstrap-catalog.json",
        {"fields": fields, "rows": [[1, "alpha", "Alpha"]], "aliases": []},
    )
    write_json(
        source / "facets.json",
        {
            "genres": ["action", "comedy"],
            "tags": ["hero"],
            "novels": {"1": {"g": [0], "t": [0]}, "2": {"g": [1], "t": []}},
        },
    )
    write_json(source / "options.json", {"genres": [], "tags": [], "languages": [], "statuses": []})
    write_json(source / "details" / "01.json", {"1": {"id": 1}})
    write_json(
        source / "recommendation-index" / "01.json",
        {"algorithm_version": 1, "channels": [], "pools": {"1": []}},
    )
    return source


def test_builds_versioned_broker_artifacts_and_verifies_digests(tmp_path: Path) -> None:
    source = fixture_source(tmp_path)
    output = tmp_path / "public" / "extension-data"
    extension_root = build(source, output, "https://example.test/app/extension-data")

    pointer = json.loads((extension_root / "latest.json").read_text())
    release = extension_root / pointer["dataset_version"]
    manifest_bytes = (release / "manifest.json").read_bytes()
    manifest = json.loads(manifest_bytes)

    assert pointer["manifest_sha256"] == hashlib.sha256(manifest_bytes).hexdigest()
    assert manifest["schema_version"] == 1
    assert manifest["minimum_data_client_version"] == 1
    assert "search/al.json" in manifest["artifacts"]
    assert "search/th.json" in manifest["artifacts"]
    assert "recommendations/01.json" in manifest["artifacts"]
    assert "details/01.json" in manifest["artifacts"]
    assert "identity/01.json" in manifest["artifacts"]
    assert "manifest.json" in manifest["artifacts"]
    data_manifest = json.loads((release / "dataset.json").read_text())
    assert data_manifest["recommendation_index_url"] == "recommendations/{bucket}.json"
    assert data_manifest["extension_search_index_url"] == "search/index.json"
    assert max(path.stat().st_size for path in release.rglob("*.json")) <= MAX_ARTIFACT_BYTES
    verify(extension_root)
    assert build(source, output, "https://example.test/app/extension-data") == extension_root


def test_verifier_rejects_a_tampered_artifact(tmp_path: Path) -> None:
    source = fixture_source(tmp_path)
    extension_root = build(source, tmp_path / "out", "https://example.test/extension-data")
    artifact = extension_root / "test-v1" / "details" / "01.json"
    artifact.write_text('{"tampered":true}', encoding="utf-8")

    with pytest.raises(ValueError, match="size does not match manifest|digest does not match manifest"):
        verify(extension_root)


def test_requires_https_origin(tmp_path: Path) -> None:
    source = fixture_source(tmp_path)
    with pytest.raises(ValueError, match="absolute HTTPS"):
        build(source, tmp_path / "out", "http://example.test/extension-data")
