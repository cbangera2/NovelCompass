"""Taste helpers (TS) + recommend exclude_novel_ids (API)."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from src.api.main import app
from src.db.repository import Repository
from src.db.schema import init_db

ROOT = Path(__file__).resolve().parents[1]


def test_taste_seed_selection_and_merge_via_node():
    script = r"""
const fs = require('node:fs');
const ts = require('./web/node_modules/typescript');
const source = fs.readFileSync('./web/src/profile/taste.ts', 'utf8');
// Strip type-only imports that break isolated transpile
const patched = source
  .replace(/import type .*?;\n/g, '')
  .replace(/import \{ inferMediaKind \} from '\.\/profileStats';\n/, 
    "const inferMediaKind = (e) => e.media_kind || (String(e.slug||'').startsWith('anilist-anime') ? 'anime' : String(e.slug||'').startsWith('anilist-') ? 'manga' : 'novel');\n");
const compiled = ts.transpileModule(patched, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
}).outputText;
(async () => {
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`;
  const { selectPositiveSeeds, buildExcludeIds, mergeSeedRecommendations, computeTasteProfile } = await import(moduleUrl);
  const profile = {
    profile_id: 'p',
    parser_version: 1,
    dataset_version: 't',
    imported_at: '2026-01-01T00:00:00.000Z',
    source_fingerprints: [],
    curated_lists: [],
    feedback: [{ novel_id: 10, slug: 'x', title: 'X', signal: 'not_for_me', updated_at: 't' }],
    entries: [
      { slug: 'a', imported_title: 'High Rated', status: 'reading', rating: 5, novel_id: 1, source_file: 'nu.html' },
      { slug: 'b', imported_title: 'Completed', status: 'completed', novel_id: 2, source_file: 'nu.html' },
      { slug: 'c', imported_title: 'Dropped', status: 'dropped', rating: 2, novel_id: 3, source_file: 'nu.html' },
      { slug: 'd', imported_title: 'Unmatched', status: 'completed', source_file: 'gdpr.json' },
    ]
  };
  const seeds = selectPositiveSeeds(profile, { limit: 12 });
  if (seeds.length !== 2) throw new Error('expected 2 seeds got ' + seeds.length);
  if (seeds[0].novel_id !== 1) throw new Error('top seed should be 5-star');
  const exclude = buildExcludeIds(profile);
  if (!exclude.includes(1) || !exclude.includes(10)) throw new Error('exclude missing library or not_for_me');
  const merged = mergeSeedRecommendations([
    {
      seed: seeds[0],
      response: {
        seed_novel: { id: 1, title: 'High Rated', slug: 'a', novelupdates_url: '' },
        count: 2,
        recommendations: [
          { target_id: 99, title: 'Rec A', author: '', slug: 'ra', novelupdates_url: '', language: '', rating: 4, rating_votes: 1, reading_list_count: 10, status_trans: '', chapters_trans: 0, rrf_score: 0.05, match_score_percent: 80, channel_ranks: {}, shared_tags: [], evidence_bullets: ['from seed1'] },
          { target_id: 1, title: 'Self', author: '', slug: 'a', novelupdates_url: '', language: '', rating: 4, rating_votes: 1, reading_list_count: 10, status_trans: '', chapters_trans: 0, rrf_score: 0.1, match_score_percent: 90, channel_ranks: {}, shared_tags: [], evidence_bullets: [] },
        ]
      }
    },
    {
      seed: seeds[1],
      response: {
        seed_novel: { id: 2, title: 'Completed', slug: 'b', novelupdates_url: '' },
        count: 1,
        recommendations: [
          { target_id: 99, title: 'Rec A', author: '', slug: 'ra', novelupdates_url: '', language: '', rating: 4, rating_votes: 1, reading_list_count: 10, status_trans: '', chapters_trans: 0, rrf_score: 0.04, match_score_percent: 70, channel_ranks: {}, shared_tags: ['x'], evidence_bullets: ['from seed2'] },
        ]
      }
    }
  ], { excludeIds: exclude, limit: 10 });
  if (merged.length !== 1 || merged[0].target_id !== 99) throw new Error('merge failed');
  if (!String(merged[0].evidence_bullets[0] || '').includes('2 of your seeds')) throw new Error('multi-seed evidence missing');
  const taste = computeTasteProfile(profile, []);
  if (taste.evidence.unmatched !== 1) throw new Error('unmatched count');
  if (!taste.evidence.caveats.length) throw new Error('expected caveats');
  process.stdout.write(JSON.stringify({ ok: true, seeds: seeds.length, merged: merged.length }));
})().catch((e) => { console.error(e); process.exit(1); });
"""
    result = subprocess.run(
        ["node", "-e", script],
        cwd=ROOT,
        capture_output=True,
        check=True,
        text=True,
    )
    assert json.loads(result.stdout)["ok"] is True


def test_recommend_excludes_library_ids(tmp_path, monkeypatch):
    db_file = str(tmp_path / "taste.db")
    conn = init_db(db_file)
    repo = Repository(conn)
    # Minimal graph: seed 1 recommends 2 and 3 via direct_recs after novels exist
    for nid, title in [(1, "Seed"), (2, "Keep"), (3, "ExcludeMe")]:
        repo.upsert_novel({
            "id": nid,
            "title": title,
            "slug": f"slug-{nid}",
            "media_type": "novel",
            "source": "novelupdates",
            "reading_list_count": 100 - nid,
            "rating": 4.0,
            "rating_votes": 10,
        })
    with conn:
        conn.execute("INSERT INTO direct_recs (source_novel_id, target_novel_id, is_mutual, votes) VALUES (1, 2, 0, 5)")
        conn.execute("INSERT INTO direct_recs (source_novel_id, target_novel_id, is_mutual, votes) VALUES (1, 3, 0, 4)")
    conn.close()

    monkeypatch.setattr("src.api.main.get_db", lambda: init_db(db_file))
    client = TestClient(app)

    open_res = client.post("/api/recommend", json={"query": "1", "limit": 10})
    assert open_res.status_code == 200
    open_ids = {item["target_id"] for item in open_res.json()["recommendations"]}
    assert 3 in open_ids or 2 in open_ids  # at least one candidate

    closed = client.post(
        "/api/recommend",
        json={"query": "1", "limit": 10, "exclude_novel_ids": [3]},
    )
    assert closed.status_code == 200
    closed_ids = {item["target_id"] for item in closed.json()["recommendations"]}
    assert 3 not in closed_ids
