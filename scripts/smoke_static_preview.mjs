const origin = process.env.STATIC_PREVIEW_ORIGIN || 'http://127.0.0.1:4173';
const base = `/${(process.env.STATIC_PREVIEW_BASE || '').replace(/^\/|\/$/g, '')}`;
const path = (value) => `${origin}${base === '/' ? '' : base}/${value.replace(/^\//, '')}`;

async function json(relative) {
  const response = await fetch(path(relative));
  if (!response.ok) throw new Error(`${response.status} ${path(relative)}`);
  return response.json();
}

const manifest = await json('data/manifest.json');
const catalog = await json(`data/${manifest.catalog_url || 'catalog.json'}`);
await json(`data/${manifest.options_url || 'options.json'}`);
await json(`data/${manifest.facets_url || 'facets.json'}`);

const idIndex = catalog.fields.indexOf('id');
const novelId = Number(catalog.rows[0][idIndex]);
const bucket = (novelId % 256).toString(16).padStart(2, '0');
await json(`data/details/${bucket}/${novelId}.json`);
try {
  await json(`data/recs/${bucket}/${novelId}.json`);
} catch {
  const shard = await json(`data/${(manifest.recommendation_index_url || 'recommendation-index/{bucket}.json').replace('{bucket}', bucket)}`);
  if (!shard.pools?.[String(novelId)]) throw new Error(`Missing recommendation pool for ${novelId}`);
}

console.log(JSON.stringify({
  base: base === '/' ? '/' : `${base}/`,
  dataset_version: manifest.dataset_version,
  novels: manifest.novel_count,
  smoke_novel_id: novelId
}));
