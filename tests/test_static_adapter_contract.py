import json
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_static_options_do_not_eagerly_fetch_catalog():
    script = r"""
const fs = require('node:fs');
const esbuildPackage = fs.readdirSync('./web/node_modules/.pnpm')
  .find((name) => name.startsWith('esbuild@'));
if (!esbuildPackage) throw new Error('pnpm esbuild package is unavailable');
const esbuild = require(`./web/node_modules/.pnpm/${esbuildPackage}/node_modules/esbuild`);
(async () => {
  const built = await esbuild.build({
    entryPoints: ['./web/src/data/static.ts'],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    write: false,
    define: { 'import.meta.env.BASE_URL': '"/"' }
  });
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`;
  const { StaticDataSource } = await import(moduleUrl);
  const requests = [];
  global.fetch = async (url) => {
    requests.push(String(url));
    if (String(url).endsWith('/manifest.json')) return {
      ok: true, json: async () => ({
        schema_version: 1, algorithm_version: 1, dataset_version: 'test',
        novel_count: 1, options_url: 'options.json'
      })
    };
    if (String(url).endsWith('/options.json')) return {
      ok: true, json: async () => ({ genres: ['Fantasy'], tags: ['Time Loop'], languages: ['Korean'] })
    };
    throw new Error(`Unexpected eager request: ${url}`);
  };
  const options = await new StaticDataSource('/data').getOptions();
  process.stdout.write(JSON.stringify({ requests, options }));
})().catch((error) => { console.error(error); process.exit(1); });
"""
    result = subprocess.run(
        ["node", "-e", script],
        cwd=ROOT,
        capture_output=True,
        check=True,
        text=True,
    )
    payload = json.loads(result.stdout)

    assert payload["requests"] == ["/data/manifest.json", "/data/options.json"]
    assert payload["options"]["genres"] == ["Fantasy"]


def test_static_search_bootstraps_and_browse_upgrades_to_full_catalog():
    script = r"""
const fs = require('node:fs');
const esbuildPackage = fs.readdirSync('./web/node_modules/.pnpm')
  .find((name) => name.startsWith('esbuild@'));
if (!esbuildPackage) throw new Error('pnpm esbuild package is unavailable');
const esbuild = require(`./web/node_modules/.pnpm/${esbuildPackage}/node_modules/esbuild`);
(async () => {
  const built = await esbuild.build({
    entryPoints: ['./web/src/data/static.ts'],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    write: false,
    define: { 'import.meta.env.BASE_URL': '"/"' }
  });
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`;
  const { StaticDataSource } = await import(moduleUrl);
  const requests = [];
  const fields = ['id', 'slug', 'title', 'author', 'cover', 'rating', 'votes', 'readers',
    'year', 'language_id', 'status_id', 'translated_chapters', 'genre_ids'];
  const bootstrap = { fields, rows: [[1, 'popular', 'Popular Seed', 'A', '', 4, 2, 20,
    2020, 1, 1, 10, [0]]], aliases: [], languages: ['', 'Chinese'],
    statuses: ['', 'Completed'], genres: ['Fantasy'], tags: [] };
  const full = { ...bootstrap, rows: [...bootstrap.rows,
    [2, 'obscure', 'Obscure Novel', 'B', '', 3, 1, 1, 2021, 1, 1, 5, [0]]] };
  global.fetch = async (url) => {
    requests.push(String(url));
    if (String(url).endsWith('/manifest.json')) return {
      ok: true, json: async () => ({
        schema_version: 1, algorithm_version: 1, dataset_version: 'test',
        novel_count: 2, bootstrap_novel_count: 1,
        bootstrap_catalog_url: 'bootstrap-catalog.json', catalog_url: 'catalog.json'
      })
    };
    if (String(url).endsWith('/bootstrap-catalog.json')) return { ok: true, json: async () => bootstrap };
    if (String(url).endsWith('/catalog.json')) return { ok: true, json: async () => full };
    throw new Error(`Unexpected request: ${url}`);
  };
  const source = new StaticDataSource('/data');
  const search = await source.searchNovels('Popular', 5);
  const afterSearch = [...requests];
  const browse = await source.browseNovels({ page: 1, page_size: 10 });
  process.stdout.write(JSON.stringify({ afterSearch, requests, search, browse }));
})().catch((error) => { console.error(error); process.exit(1); });
"""
    result = subprocess.run(
        ["node", "-e", script],
        cwd=ROOT,
        capture_output=True,
        check=True,
        text=True,
    )
    payload = json.loads(result.stdout)

    assert payload["afterSearch"] == [
        "/data/manifest.json",
        "/data/bootstrap-catalog.json",
    ]
    assert [item["id"] for item in payload["search"]] == [1]
    assert payload["requests"][-1] == "/data/catalog.json"
    assert payload["browse"]["total"] == 2


def test_extension_factory_uses_injected_fixture_and_resolves_nu_identity():
    script = r"""
const fs = require('node:fs');
const path = require('node:path');
const esbuildPackage = fs.readdirSync('./web/node_modules/.pnpm')
  .find((name) => name.startsWith('esbuild@'));
if (!esbuildPackage) throw new Error('pnpm esbuild package is unavailable');
const esbuild = require(`./web/node_modules/.pnpm/${esbuildPackage}/node_modules/esbuild`);
(async () => {
  const built = await esbuild.build({
    entryPoints: ['./web/src/data/extension.ts'],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    write: false,
    define: { 'import.meta.env.BASE_URL': '"/"' }
  });
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`;
  const {
    createExtensionStaticDataSource,
    identityFromNovelUpdatesUrl,
    resolveNovelUpdatesIdentity
  } = await import(moduleUrl);
  const fixtureRoot = path.resolve('tests/fixtures/extension-static-data');
  const requests = [];
  const fixtureFetch = async (url) => {
    requests.push(String(url));
    const relative = new URL(String(url)).pathname.replace(/^\/fixture\//, '');
    const file = path.join(fixtureRoot, relative);
    if (!fs.existsSync(file)) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => JSON.parse(fs.readFileSync(file, 'utf8')) };
  };
  const source = await createExtensionStaticDataSource({
    baseUrl: 'https://extension.invalid/fixture',
    fetch: fixtureFetch
  });
  const identity = identityFromNovelUpdatesUrl(
    'https://www.novelupdates.com/series/i-became-a-regressed-mercenary/'
  );
  const resolved = await resolveNovelUpdatesIdentity(source, identity);
  const titleResolved = await resolveNovelUpdatesIdentity(source, {
    slug: 'renamed-page',
    title: 'Clockwork Blade'
  });
  const unresolved = await resolveNovelUpdatesIdentity(source, {
    slug: 'not-in-the-snapshot',
    title: 'Not In The Snapshot'
  });
  const browse = await source.browseNovels({
    include_tags: 'Mercenaries',
    sort: 'rating',
    direction: 'desc'
  });
  process.stdout.write(JSON.stringify({
    requests,
    identity,
    resolved,
    titleResolved,
    unresolved,
    browseIds: browse.items.map((item) => item.id)
  }));
})().catch((error) => { console.error(error); process.exit(1); });
"""
    result = subprocess.run(
        ["node", "-e", script],
        cwd=ROOT,
        capture_output=True,
        check=True,
        text=True,
    )
    payload = json.loads(result.stdout)

    assert payload["identity"] == {"slug": "i-became-a-regressed-mercenary"}
    assert payload["resolved"]["status"] == "resolved"
    assert payload["resolved"]["matchedBy"] == "slug"
    assert payload["resolved"]["novel"]["id"] == 101
    assert payload["titleResolved"]["matchedBy"] == "title"
    assert payload["titleResolved"]["novel"]["id"] == 102
    assert payload["unresolved"]["status"] == "unresolved"
    assert payload["browseIds"] == [102, 101]
    assert payload["requests"][0].endswith("/manifest.json")
