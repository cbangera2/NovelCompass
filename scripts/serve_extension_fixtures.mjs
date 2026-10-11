import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtureRoot = path.join(extensionRoot(), 'tests/fixtures');
const requestedPort = Number(process.env.EXTENSION_FIXTURE_PORT ?? 4174);

const routes = new Map([
  ['/series/fixture-mercenary/', path.join(fixtureRoot, 'series-logged-out.html')],
  ['/series/fixture-paginated-releases/', path.join(fixtureRoot, 'releases-pagination.html')],
  ['/series/fixture-no-releases/', path.join(fixtureRoot, 'series-no-releases.html')],
  ['/series-finder/', path.join(fixtureRoot, 'series-finder.html')],
  ['/__challenge__/', path.join(fixtureRoot, 'challenge.html')],
  ['/__unsupported__/', path.join(fixtureRoot, 'unsupported-markup.html')],
]);

const server = createServer(async (request, response) => {
  const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
  if (requestUrl.pathname === '/__health__') {
    response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('ok');
    return;
  }

  const fixture = routes.get(requestUrl.pathname);
  if (!fixture) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Unknown deterministic extension fixture.');
    return;
  }

  try {
    const html = await readFile(fixture);
    response.writeHead(200, {
      'cache-control': 'no-store',
      'content-type': 'text/html; charset=utf-8',
    });
    response.end(html);
  } catch (error) {
    response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    response.end(error instanceof Error ? error.message : 'Fixture read failed.');
  }
});

server.listen(requestedPort, '127.0.0.1', () => {
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : requestedPort;
  console.log(`Extension fixtures: http://127.0.0.1:${port}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}

function extensionRoot() {
  return path.join(repositoryRoot, 'extension');
}
