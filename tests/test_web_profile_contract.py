import json
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_profile_rematch_preserves_previously_resolved_ids():
    script = r"""
const fs = require('node:fs');
const ts = require('./web/node_modules/typescript');
const source = fs.readFileSync('./web/src/profile/resolve.ts', 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
}).outputText;
(async () => {
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`;
  const { applyResolvedNovelIds } = await import(moduleUrl);
  const entries = [
    { slug: 'kept', imported_title: 'Kept', status: 'reading', source_file: 'test', novel_id: 38 },
    { slug: 'updated', imported_title: 'Updated', status: 'reading', source_file: 'test', novel_id: 39 },
    { slug: 'new', imported_title: 'New', status: 'reading', source_file: 'test' }
  ];
  const result = applyResolvedNovelIds(entries, new Map([
    ['updated', { id: 40 }],
    ['new', { id: 41 }]
  ]));
  process.stdout.write(JSON.stringify(result.map((entry) => entry.novel_id)));
})().catch((error) => { console.error(error); process.exit(1); });
"""
    result = subprocess.run(
        ["node", "-e", script],
        cwd=ROOT,
        capture_output=True,
        check=True,
        text=True,
    )

    assert json.loads(result.stdout) == [38, 40, 41]
