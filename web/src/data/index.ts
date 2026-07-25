import { ApiDataSource } from './api';
import { StaticDataSource } from './static';
import { RecommendationDataSource } from './source';

export type DataMode = 'api' | 'static' | 'auto';
const sourcePromises = new Map<DataMode, Promise<RecommendationDataSource>>();

export function configuredDataMode(): DataMode {
  const configured = import.meta.env.VITE_DATA_MODE;
  return configured === 'api' || configured === 'static' || configured === 'auto'
    ? configured
    : 'auto';
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
export { bucketForNovel } from './source';
