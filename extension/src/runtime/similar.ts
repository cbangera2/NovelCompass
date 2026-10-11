import type { LiveSeriesMetadata, NovelUpdatesPageIdentity } from '../adapters/contracts';
import type { SimilarNovel } from '../ui/components/SimilarNovels';
import {
  createExtensionStaticDataSource,
  resolveNovelUpdatesIdentity,
} from '../../../web/src/data';
import type { Recommendation } from '../../../web/src/types';

export type SimilarLoadResult =
  { status: 'ready'; data: SimilarNovel[] } | { status: 'unavailable'; message: string };

export async function loadSeriesSimilarNovels(
  datasetBaseUrl: string,
  identity: NovelUpdatesPageIdentity,
  metadata: Pick<LiveSeriesMetadata, 'title'>,
  fetcher?: typeof fetch,
): Promise<SimilarLoadResult> {
  try {
    const source = await createExtensionStaticDataSource({
      baseUrl: datasetBaseUrl,
      fetch: fetcher,
    });
    const resolution = await resolveNovelUpdatesIdentity(source, {
      id: identity.novelUpdatesId,
      slug: identity.slug,
      title: metadata.title,
    });
    if (resolution.status === 'unresolved') {
      return {
        status: 'unavailable',
        message: 'This Novel Updates title is not in the packaged Novel Compass snapshot.',
      };
    }
    const response = await source.getRecommendations({
      query: String(resolution.novel.id),
      limit: 12,
      media_type: 'novel',
    });
    return {
      status: 'ready',
      data: response.recommendations.flatMap(mapRecommendationToSimilar),
    };
  } catch (reason) {
    return {
      status: 'unavailable',
      message:
        reason instanceof Error
          ? `Novel Compass recommendations are unavailable: ${reason.message}`
          : 'Novel Compass recommendations are unavailable for this title.',
    };
  }
}

export function mapRecommendationToSimilar(recommendation: Recommendation): SimilarNovel[] {
  const url = trustedNovelUpdatesSeriesUrl(
    recommendation.novelupdates_url || recommendation.external_url,
    recommendation.target_id,
  );
  if (!url || recommendation.source === 'anilist' || recommendation.target_id >= 2_000_000) {
    return [];
  }
  return [
    {
      id: String(recommendation.target_id),
      title: recommendation.title,
      url,
      score: Math.max(0, Math.min(1, recommendation.match_score_percent / 100)),
      ...(recommendation.evidence_bullets[0]
        ? { reason: plainText(recommendation.evidence_bullets[0]) }
        : {}),
      ...(recommendation.shared_tags.length
        ? { genres: recommendation.shared_tags.slice(0, 4).map(plainText).filter(Boolean) }
        : {}),
    },
  ];
}

function trustedNovelUpdatesSeriesUrl(value: string | undefined, id: number): string | undefined {
  try {
    const url = new URL(value || `https://www.novelupdates.com/?p=${id}`);
    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'www.novelupdates.com' ||
      (!url.pathname.startsWith('/series/') && !url.searchParams.has('p'))
    ) {
      return undefined;
    }
    return url.href;
  } catch {
    return undefined;
  }
}

function plainText(value: string): string {
  return value
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
