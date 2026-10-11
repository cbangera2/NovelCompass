import { access, cp, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extensionRoot = path.join(repositoryRoot, 'extension');
const distRoot = path.join(extensionRoot, 'dist');
const packagePath = path.join(distRoot, 'novel-compass-extension.zip');
const reportPath = path.join(distRoot, 'package-report.json');
const modeArgument = process.argv.find((argument) => argument.startsWith('--mode='));
const mode = modeArgument?.slice('--mode='.length) ?? 'core';
const validModes = new Set(['core', 'fixture', 'offline-full']);
const expectedMatches = ['https://www.novelupdates.com/*'];
const expectedResourceMatches = ['https://www.novelupdates.com/*'];

assert(validModes.has(mode), `unknown package mode: ${mode}`);
await access(path.join(distRoot, 'background/service-worker.js'));
await access(path.join(distRoot, 'content/bootstrap.js'));
await access(path.join(distRoot, 'content/style.css'));
await access(path.join(distRoot, 'content/native-theme.css'));
if (mode === 'core') {
  assert(
    !(await exists(path.join(distRoot, 'data'))),
    'core package must not contain a data directory',
  );
} else {
  await access(path.join(distRoot, 'data/manifest.json'));
  await access(path.join(distRoot, 'data/catalog.json'));
}

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
    JSON.stringify(['content/style.css', 'content/native-theme.css', 'data/*', 'data/**/*']),
  'unexpected web-accessible resources',
);

await rm(reportPath, { force: true });
const executableFiles = (await walk(distRoot)).filter((file) => /\.(?:js|mjs|html)$/u.test(file));
const packagedFiles = await walk(distRoot);
for (const file of packagedFiles) {
  const relativePath = relative(file);
  const segments = relativePath.split(path.sep);
  const name = segments.at(-1) ?? '';
  assert(!segments.includes('.git'), `forbidden nested Git metadata: ${relativePath}`);
  assert(name !== '.DS_Store', `forbidden macOS metadata: ${relativePath}`);
  assert(!name.endsWith('.map'), `source map must not be packaged: ${relativePath}`);
  assert(!name.endsWith('.log'), `log file must not be packaged: ${relativePath}`);
}
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
  const report = await createSizeReport(packagedFiles, mode);
  enforceBudgets(report);
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  run('zip', ['-X', '-q', '-r', temporaryZip, '.'], distRoot);
  run('unzip', ['-t', '-q', temporaryZip]);
  const entries = run('unzip', ['-Z1', temporaryZip]).stdout.split(/\r?\n/u).filter(Boolean);
  assert(entries.includes('manifest.json'), 'ZIP must contain manifest.json at its root');
  assert(entries.includes('background/service-worker.js'), 'ZIP must contain the service worker');
  assert(entries.includes('content/bootstrap.js'), 'ZIP must contain the content script');
  assert(entries.includes('content/style.css'), 'ZIP must contain Shadow DOM product styles');
  assert(entries.includes('content/native-theme.css'), 'ZIP must contain native theme styles');
  assert(entries.includes('package-report.json'), 'ZIP must contain its size report');
  if (mode === 'core') {
    assert(!entries.some((entry) => entry.startsWith('data/')), 'core ZIP must not contain data');
  } else {
    assert(entries.includes('data/manifest.json'), 'ZIP must contain the static-data manifest');
    assert(entries.includes('data/catalog.json'), 'ZIP must contain the static catalog');
  }
  for (const entry of entries) {
    assert(
      !path.isAbsolute(entry) && !entry.split('/').includes('..'),
      `unsafe ZIP entry: ${entry}`,
    );
  }
  await cp(temporaryZip, packagePath);
  run('unzip', ['-t', '-q', packagePath]);
  const zipBytes = (await stat(packagePath)).size;
  if (mode === 'core') {
    assert(zipBytes <= 1_048_576, `core ZIP exceeds 1 MiB hard limit: ${formatBytes(zipBytes)}`);
  }
  console.log(renderSizeReport(report, zipBytes));
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

console.log(`Validated ${mode} Manifest V3 package and wrote ${relative(packagePath)}.`);

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

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function createSizeReport(files, packageMode) {
  const categories = {
    background: 0,
    contentJavaScript: 0,
    contentCss: 0,
    popup: 0,
    data: 0,
    other: 0,
  };

  for (const file of files) {
    const relativePath = path.relative(distRoot, file);
    const bytes = (await stat(file)).size;
    if (relativePath.startsWith('background/')) {
      categories.background += bytes;
    } else if (relativePath === 'content/bootstrap.js') {
      categories.contentJavaScript += bytes;
    } else if (relativePath.startsWith('content/') && relativePath.endsWith('.css')) {
      categories.contentCss += bytes;
    } else if (relativePath.startsWith('popup/')) {
      categories.popup += bytes;
    } else if (relativePath.startsWith('data/')) {
      categories.data += bytes;
    } else {
      categories.other += bytes;
    }
  }

  return {
    mode: packageMode,
    unpackedBytes: Object.values(categories).reduce((sum, bytes) => sum + bytes, 0),
    categories,
    budgets:
      packageMode === 'core'
        ? {
            unpackedHardBytes: 2_097_152,
            contentJavaScriptHardBytes: 614_400,
            contentCssHardBytes: 128_000,
            zipHardBytes: 1_048_576,
          }
        : null,
  };
}

function enforceBudgets(report) {
  if (!report.budgets) {
    return;
  }
  assert(
    report.unpackedBytes <= report.budgets.unpackedHardBytes,
    `core unpacked size exceeds 2 MiB hard limit: ${formatBytes(report.unpackedBytes)}`,
  );
  assert(
    report.categories.contentJavaScript <= report.budgets.contentJavaScriptHardBytes,
    `content JavaScript exceeds 600 KiB hard limit: ${formatBytes(report.categories.contentJavaScript)}`,
  );
  assert(
    report.categories.contentCss <= report.budgets.contentCssHardBytes,
    `content CSS exceeds 125 KiB hard limit: ${formatBytes(report.categories.contentCss)}`,
  );
}

function renderSizeReport(report, zipBytes) {
  const rows = Object.entries(report.categories)
    .map(([category, bytes]) => `  ${category.padEnd(21)} ${formatBytes(bytes)}`)
    .join('\n');
  return [
    `Extension package size report (${report.mode})`,
    rows,
    `  ${'unpacked total'.padEnd(21)} ${formatBytes(report.unpackedBytes)}`,
    `  ${'ZIP'.padEnd(21)} ${formatBytes(zipBytes)}`,
  ].join('\n');
}

function formatBytes(bytes) {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}
