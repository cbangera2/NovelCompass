import pytest

import src.engine.artifacts as artifacts


@pytest.fixture(autouse=True)
def isolated_engine_cache(tmp_path, monkeypatch):
    """Keep engine artifacts built from test databases out of the real data/cache/engine."""
    monkeypatch.setattr(artifacts, "CACHE_DIR", tmp_path / "engine-cache")
