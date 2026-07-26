import json
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_media_filter_url_parsing():
    script = r"""
const fs = require('node:fs');
const path = require('node:path');
const ts = require('./web/node_modules/typescript');

function loadModule(filePath) {
  const source = fs.readFileSync(filePath, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const m = { exports: {} };
  const customRequire = (specifier) => {
    if (specifier === 'react') return require(path.resolve('./web/node_modules/react'));
    return require(specifier);
  };
  const evalFunc = new Function('module', 'exports', 'require', compiled);
  evalFunc(m, m.exports, customRequire);
  return m.exports;
}

const mediaFilterState = loadModule('./web/src/mediaFilterState.ts');

const testCases = [
  mediaFilterState.parseMediaTypesFromUrl('types=manga,anime'),
  mediaFilterState.parseMediaTypesFromUrl('media=novel'),
  mediaFilterState.parseMediaTypesFromUrl('types=all'),
  mediaFilterState.parseMediaTypesFromUrl('q=hunter&r=4'),
  mediaFilterState.parseMediaTypesFromUrl('types=invalid,manga')
];

process.stdout.write(JSON.stringify(testCases));
"""
    result = subprocess.run(
        ["node", "-e", script],
        cwd=ROOT,
        capture_output=True,
        check=True,
        text=True,
    )

    expected = [
        ["manga", "anime"],
        ["novel"],
        ["novel", "manga", "anime"],
        None,
        ["manga"],
    ]
    assert json.loads(result.stdout) == expected


def test_route_state_url_roundtrip():
    script = r"""
const fs = require('node:fs');
const path = require('node:path');
const ts = require('./web/node_modules/typescript');

function loadModule(filePath) {
  const source = fs.readFileSync(filePath, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const m = { exports: {} };
  const customRequire = (specifier) => {
    if (specifier === 'react') return require(path.resolve('./web/node_modules/react'));
    return require(specifier);
  };
  const evalFunc = new Function('module', 'exports', 'require', compiled);
  evalFunc(m, m.exports, customRequire);
  return m.exports;
}

const routeState = loadModule('./web/src/routeState.ts');

const params = new URLSearchParams('view=discover&types=anime%2Cmanga&r=4&hg=1');
const parsed = routeState.parseDiscoverRoute(params, routeState.DISCOVER_DEFAULTS);
const reserialized = routeState.discoverSearchParams(parsed);

process.stdout.write(JSON.stringify({
  parsedTypes: parsed.types,
  parsedMinRating: parsed.minRating,
  parsedHiddenGem: parsed.hiddenGemMode,
  reserializedTypes: reserialized.get('types'),
  reserializedRating: reserialized.get('r')
}));
"""
    result = subprocess.run(
        ["node", "-e", script],
        cwd=ROOT,
        capture_output=True,
        check=True,
        text=True,
    )

    data = json.loads(result.stdout)
    assert data["parsedTypes"] == "anime,manga"
    assert data["parsedMinRating"] == 4
    assert data["parsedHiddenGem"] is True
    assert data["reserializedTypes"] == "anime,manga"
    assert data["reserializedRating"] == "4"
