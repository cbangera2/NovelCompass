import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import process from 'node:process';

const extensionRoot = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.dirname(extensionRoot);
const webRoot = path.join(repositoryRoot, 'web');
const outputRoot = path.join(extensionRoot, 'dist');
const watch = process.argv.includes('--watch');
const fullData = process.argv.includes('--full-data');

const { build } = await import(path.join(webRoot, 'node_modules/vite/dist/node/index.js'));

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });
await cp(path.join(extensionRoot, 'manifest.json'), path.join(outputRoot, 'manifest.json'));

const sharedConfig = {
  configFile: false,
  root: extensionRoot,
  publicDir: false,
  logLevel: 'info',
  define: {
    'process.env.NODE_ENV': JSON.stringify(watch ? 'development' : 'production'),
  },
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'react',
  },
  resolve: {
    alias: [
      {
        find: 'react/jsx-runtime',
        replacement: path.join(webRoot, 'node_modules/react/jsx-runtime.js'),
      },
      {
        find: /^react$/,
        replacement: path.join(webRoot, 'node_modules/react/index.js'),
      },
      {
        find: 'react-dom/client',
        replacement: path.join(webRoot, 'node_modules/react-dom/client.js'),
      },
      {
        find: /^react-dom$/,
        replacement: path.join(webRoot, 'node_modules/react-dom/index.js'),
      },
      {
        find: /^lucide-react$/,
        replacement: path.join(webRoot, 'node_modules/lucide-react/dist/esm/lucide-react.mjs'),
      },
    ],
    dedupe: ['react', 'react-dom'],
  },
  build: {
    target: 'chrome114',
    minify: !watch,
    sourcemap: watch,
    emptyOutDir: false,
    watch: watch ? {} : null,
  },
};

await Promise.all([
  build({
    ...sharedConfig,
    build: {
      ...sharedConfig.build,
      outDir: path.join(outputRoot, 'background'),
      lib: {
        entry: path.join(extensionRoot, 'src/background/service-worker.ts'),
        formats: ['es'],
        fileName: () => 'service-worker.js',
      },
    },
  }),
  build({
    ...sharedConfig,
    build: {
      ...sharedConfig.build,
      outDir: path.join(outputRoot, 'content'),
      lib: {
        entry: path.join(extensionRoot, 'src/content/bootstrap.ts'),
        name: 'NovelCompassContent',
        formats: ['iife'],
        fileName: () => 'bootstrap.js',
      },
    },
  }),
]);

const datasetSource = fullData
  ? path.join(webRoot, 'public/data')
  : path.join(repositoryRoot, 'tests/fixtures/extension-static-data');
await cp(datasetSource, path.join(outputRoot, 'data'), { recursive: true });
console.log(`Packaged ${fullData ? 'full local' : 'deterministic mini'} extension dataset.`);

if (watch) {
  process.on('SIGINT', () => process.exit(0));
  await new Promise(() => {});
}
