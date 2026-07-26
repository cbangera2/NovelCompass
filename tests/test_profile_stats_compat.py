"""Compatibility checks for shared profile stats helpers (TS mirrored in intent)."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_old_novelupdates_backup_still_parses():
    """Legacy NU-only backups without optional AniList fields must remain valid."""
    script = r"""
const fs = require('node:fs');
const ts = require('./web/node_modules/typescript');
const source = fs.readFileSync('./web/src/profile/transfer.ts', 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
}).outputText;
(async () => {
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`;
  const { parseProfileBackup } = await import(moduleUrl);
  const backup = {
    profile_id: 'p1',
    parser_version: 1,
    dataset_version: 'test',
    imported_at: '2026-01-01T00:00:00.000Z',
    source_fingerprints: ['abc'],
    curated_lists: [],
    entries: [
      {
        slug: 'too-many-losing-heroines',
        imported_title: 'Too Many Losing Heroines!',
        status: 'reading',
        rating: 4.5,
        progress: '12',
        source_file: 'reading.html',
        novel_id: 46924
      }
    ]
  };
  const profile = parseProfileBackup(backup);
  if (profile.entries.length !== 1) throw new Error('expected 1 entry');
  if (profile.entries[0].slug !== 'too-many-losing-heroines') throw new Error('slug mismatch');
  if (profile.entries[0].media_kind != null) throw new Error('legacy entry should omit media_kind');
  process.stdout.write(JSON.stringify({ ok: true, count: profile.entries.length }));
})().catch((error) => { console.error(error); process.exit(1); });
"""
    result = subprocess.run(
        ["node", "-e", script],
        cwd=ROOT,
        capture_output=True,
        check=True,
        text=True,
    )
    assert json.loads(result.stdout)["ok"] is True


def test_profile_stats_infer_novel_for_nu_slugs():
    script = r"""
const fs = require('node:fs');
const ts = require('./web/node_modules/typescript');
const source = fs.readFileSync('./web/src/profile/profileStats.ts', 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
}).outputText;
(async () => {
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`;
  const { inferMediaKind, overviewKpis, scoreDistribution, filterEntriesByScope } = await import(moduleUrl);
  const nu = { slug: 'lord-of-the-mysteries', imported_title: 'Lord of the Mysteries', status: 'completed', rating: 5, source_file: 'a.html' };
  const anime = { slug: 'anilist-anime-171457', imported_title: 'Makeine', status: 'completed', rating: 4.5, media_kind: 'anime', source_file: 'gdpr.json' };
  if (inferMediaKind(nu) !== 'novel') throw new Error('NU slug should be novel');
  if (inferMediaKind(anime) !== 'anime') throw new Error('AniList anime slug should be anime');
  const kpis = overviewKpis([nu, anime]);
  if (kpis.total !== 2) throw new Error('kpi total');
  if (kpis.rated !== 2) throw new Error('kpi rated');
  const novels = filterEntriesByScope([nu, anime], 'novel');
  if (novels.length !== 1 || novels[0].slug !== nu.slug) throw new Error('scope filter novels');
  const scores = scoreDistribution([nu, anime]);
  const five = scores.find((row) => row.value === 5);
  if (!five || five.count !== 1) throw new Error('score bucket');
  process.stdout.write(JSON.stringify({ ok: true }));
})().catch((error) => { console.error(error); process.exit(1); });
"""
    result = subprocess.run(
        ["node", "-e", script],
        cwd=ROOT,
        capture_output=True,
        check=True,
        text=True,
    )
    assert json.loads(result.stdout)["ok"] is True
