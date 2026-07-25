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
