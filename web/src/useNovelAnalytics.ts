import { useEffect, useState } from 'react';
import { createDataSource, type RecommendationDataSource } from './data';
import { idle } from './idle';
import {
  facetAnalysis,
  lengthAnalysis,
  trustAnalysis,
  type AnalyticsCorpus,
  type FacetAnalysis,
  type LengthAnalysis,
  type TrustAnalysis,
} from './novelStats';
import type { NovelDetail } from './types';

/**
 * Loads the catalog-wide corpus the analytics are computed from. The live API has no such endpoint, so
 * there the static snapshot is used when the deployment ships one; otherwise the analytics stay hidden.
 *
 * Pass `null` until the title itself has rendered: the corpus needs the facets file, and asking for it earlier
 * would move that parse in front of the hero instead of behind it.
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

export interface TitleAnalysis {
  trust: TrustAnalysis | null;
  facets: FacetAnalysis | null;
  length: LengthAnalysis | null;
}

/** The per-title numbers, computed in small idle-time slices so no single task blocks scrolling or input. */
export function useTitleAnalysis(
  corpus: AnalyticsCorpus | null,
  novelId: number,
  ratingDist: NovelDetail['rating_dist'],
): TitleAnalysis | null {
  const [analysis, setAnalysis] = useState<TitleAnalysis | null>(null);
  useEffect(() => {
    setAnalysis(null);
    if (!corpus) return;
    let cancelled = false;
    (async () => {
      await idle();
      const trust = trustAnalysis(corpus, novelId, ratingDist);
      await idle();
      const facets = facetAnalysis(corpus, novelId);
      if (cancelled) return;
      setAnalysis({ trust, facets, length: lengthAnalysis(corpus, novelId) });
    })();
    return () => { cancelled = true; };
  }, [corpus, novelId, ratingDist]);
  return analysis;
}
