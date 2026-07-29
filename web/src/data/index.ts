import { ApiDataSource } from './api';
import { StaticDataSource } from './static';
import { RecommendationDataSource } from './source';

export type DataMode = 'api' | 'static' | 'auto';
const sourcePromises = new Map<DataMode, Promise<RecommendationDataSource>>();
const DATA_MODE_KEY = 'novel-compass:data-mode:v1';

export function forcedDataMode(): Exclude<DataMode, 'auto'> | null {
  if (typeof window !== 'undefined' && window.location.hostname.endsWith('.github.io')) return 'static';
  const configured = import.meta.env.VITE_DATA_MODE;
  return configured === 'api' || configured === 'static' ? configured : null;
}

export function loadDataModePreference(): DataMode {
  try {
    const saved = JSON.parse(localStorage.getItem(DATA_MODE_KEY) || '{}');
    return saved?.version === 1 && ['api', 'static', 'auto'].includes(saved.mode) ? saved.mode : 'auto';
  } catch { return 'auto'; }
}

export function saveDataModePreference(mode: DataMode): void {
  if (forcedDataMode()) return;
  localStorage.setItem(DATA_MODE_KEY, JSON.stringify({ version: 1, mode }));
  window.dispatchEvent(new Event('novel-data-mode'));
}

export function configuredDataMode(): DataMode {
  return forcedDataMode() || loadDataModePreference();
}

async function initializeDataSource(
  mode: DataMode = configuredDataMode()
): Promise<RecommendationDataSource> {
  if (mode === 'api') return new ApiDataSource();
  if (mode === 'static') {
    const source = new StaticDataSource();
    await source.getManifest();
    return source;
  }

  const api = new ApiDataSource();
  try {
    await api.getManifest();
    return api;
  } catch {
    const source = new StaticDataSource();
    await source.getManifest();
    return source;
  }
}

export function createDataSource(
  mode: DataMode = configuredDataMode()
): Promise<RecommendationDataSource> {
  const cached = sourcePromises.get(mode);
  if (cached) return cached;
  const pending = initializeDataSource(mode);
  sourcePromises.set(mode, pending);
  pending.catch(() => {
    if (sourcePromises.get(mode) === pending) sourcePromises.delete(mode);
  });
  return pending;
}

export type { RecommendationDataSource } from './source';
export { bucketForNovel, externalMediaUrl, sourceDisplayName } from './source';
export type { StaticDataSourceOptions } from './static';
export {
  createExtensionStaticDataSource,
  identityFromNovelUpdatesUrl,
  resolveNovelUpdatesIdentity
} from './extension';
export type { CatalogResolution, NovelUpdatesSeriesIdentity } from './extension';
