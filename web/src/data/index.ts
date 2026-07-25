import { ApiDataSource } from './api';
import { StaticDataSource } from './static';
import { RecommendationDataSource } from './source';

export type DataMode = 'api' | 'static' | 'auto';

export async function createDataSource(
  mode: DataMode = (import.meta.env.VITE_DATA_MODE as DataMode) || 'auto'
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

export type { RecommendationDataSource } from './source';
export { bucketForNovel } from './source';
