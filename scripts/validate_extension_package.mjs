import { access, cp, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extensionRoot = path.join(repositoryRoot, 'extension');
const distRoot = path.join(extensionRoot, 'dist');
const packagePath = path.join(distRoot, 'novel-compass-extension.zip');
const expectedMatches = ['https://www.novelupdates.com/*'];
const expectedResourceMatches = ['https://www.novelupdates.com/*'];

await access(path.join(distRoot, 'background/service-worker.js'));
await access(path.join(distRoot, 'content/bootstrap.js'));
await access(path.join(distRoot, 'content/style.css'));
await access(path.join(distRoot, 'data/manifest.json'));
await access(path.join(distRoot, 'data/catalog.json'));

const manifest = JSON.parse(await readFile(path.join(distRoot, 'manifest.json'), 'utf8'));
const contentScript = await readFile(path.join(distRoot, 'content/bootstrap.js'), 'utf8');
assert(manifest.manifest_version === 3, 'manifest_version must be 3');
assert(
  manifest.background?.service_worker === 'background/service-worker.js',
  'unexpected service worker entry',
);
assert(manifest.background?.type === 'module', 'service worker must be a module');
assert(
  JSON.stringify(manifest.content_scripts?.[0]?.matches) === JSON.stringify(expectedMatches),
  'content-script matches must stay restricted to the Novel Updates origin',
);
assert(
  JSON.stringify(manifest.permissions) === JSON.stringify(['storage']),
  'extension permissions must contain only storage',
);
assert(
  !manifest.host_permissions || manifest.host_permissions.length === 0,
  'unexpected broad host permissions',
);
assert(!JSON.stringify(manifest).includes('<all_urls>'), 'manifest must not request <all_urls>');
assert(
  !contentScript.includes('process.env.'),
  'content script must not retain Node process.env references',
);
assert(
  !contentScript.includes('React.createElement'),
  'content script must not rely on an undeclared classic JSX React global',
);
assert(
  JSON.stringify(manifest.web_accessible_resources?.[0]?.matches) ===
    JSON.stringify(expectedResourceMatches),
  'web-accessible resources must stay restricted to the Novel Updates origin',
);
assert(
  JSON.stringify(manifest.web_accessible_resources?.[0]?.resources) ===
    JSON.stringify(['content/style.css', 'data/*', 'data/**/*']),
  'unexpected web-accessible resources',
);

const executableFiles = (await walk(distRoot)).filter((file) => /\.(?:js|mjs|html)$/u.test(file));
const remoteCodePatterns = [
  /\bimportScripts\s*\(\s*['"]https?:\/\//u,
  /\bimport\s*\(\s*['"]https?:\/\//u,
  /<script[^>]+\bsrc\s*=\s*['"]https?:\/\//iu,
  /\.src\s*=\s*['"]https?:\/\/[^'"]+\.js(?:[?'"])/iu,
];
for (const file of executableFiles) {
  const source = await readFile(file, 'utf8');
  for (const pattern of remoteCodePatterns) {
    assert(!pattern.test(source), `remote executable code pattern found in ${relative(file)}`);
  }
}

const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'novel-compass-extension-'));
const temporaryZip = path.join(temporaryRoot, 'novel-compass-extension.zip');
try {
  await rm(packagePath, { force: true });
  run('zip', ['-X', '-q', '-r', temporaryZip, '.'], distRoot);
  run('unzip', ['-t', '-q', temporaryZip]);
  const entries = run('unzip', ['-Z1', temporaryZip]).stdout.split(/\r?\n/u).filter(Boolean);
  assert(entries.includes('manifest.json'), 'ZIP must contain manifest.json at its root');
  assert(entries.includes('background/service-worker.js'), 'ZIP must contain the service worker');
  assert(entries.includes('content/bootstrap.js'), 'ZIP must contain the content script');
  assert(entries.includes('content/style.css'), 'ZIP must contain Shadow DOM product styles');
  assert(entries.includes('data/manifest.json'), 'ZIP must contain the static-data manifest');
  assert(entries.includes('data/catalog.json'), 'ZIP must contain the deterministic catalog');
  for (const entry of entries) {
    assert(
      !path.isAbsolute(entry) && !entry.split('/').includes('..'),
      `unsafe ZIP entry: ${entry}`,
    );
  }
  await cp(temporaryZip, packagePath);
  run('unzip', ['-t', '-q', packagePath]);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

console.log(`Validated Manifest V3 package and wrote ${relative(packagePath)}.`);

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === path.basename(packagePath)) {
      continue;
    }
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(fullPath)));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

function run(command, arguments_, cwd) {
  const result = spawnSync(command, arguments_, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    throw new Error(`${command} failed: ${result.stderr || result.stdout || 'unknown error'}`);
  }
  return result;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function relative(file) {
  return path.relative(repositoryRoot, file);
}
