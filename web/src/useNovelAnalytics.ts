import { useEffect, useState } from 'react';
import { createDataSource, type RecommendationDataSource } from './data';
import type { AnalyticsCorpus } from './novelStats';

/**
 * Loads the catalog-wide corpus the analytics are computed from. The live API has no such endpoint, so
 * there the static snapshot is used when the deployment ships one; otherwise the analytics stay hidden.
 */
export function useAnalyticsCorpus(source: RecommendationDataSource | null): AnalyticsCorpus | null {
  const [corpus, setCorpus] = useState<AnalyticsCorpus | null>(null);
  useEffect(() => {
    if (!source) return;
    let cancelled = false;
    const provider = source.getAnalyticsCorpus
      ? Promise.resolve(source)
      : createDataSource('static').catch(() => null);
    provider
      .then((found) => found?.getAnalyticsCorpus?.())
      .then((value) => { if (!cancelled && value) setCorpus(value); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [source]);
  return corpus;
}
