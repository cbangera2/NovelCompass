#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

python_bin="${NOVEL_SNAPSHOT_PYTHON:-$repo_root/.venv/bin/python}"
if [[ ! -x "$python_bin" ]]; then
  python_bin=python3
fi

"$python_bin" build_static_export.py \
  --db data/recommender.db \
  --output web/public/data \
  --catalog-limit "${NOVEL_SNAPSHOT_CATALOG_LIMIT:-500}" \
  --max-novels "${NOVEL_SNAPSHOT_RECOMMENDABLE_LIMIT:-500}" \
  --candidate-limit "${NOVEL_SNAPSHOT_CANDIDATE_LIMIT:-100}"
