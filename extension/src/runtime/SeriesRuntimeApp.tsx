import { useEffect, useState } from 'react';

import type {
  LiveReleasePage,
  LiveReviewPage,
  LiveSeriesMetadata,
  NovelUpdatesPageIdentity,
} from '../adapters/contracts';
import { ExtensionSeriesApp, type SeriesSectionState } from '../ui/ExtensionSeriesApp';
import type { SimilarNovel } from '../ui/components/SimilarNovels';
import { loadSeriesSimilarNovels } from './similar';

export interface SeriesRuntimeAppProps {
  datasetBaseUrl: string;
  identity: NovelUpdatesPageIdentity;
  metadata: LiveSeriesMetadata;
  releases: LiveReleasePage;
  reviews: LiveReviewPage;
  onInvokeAction: (actionId: string) => void;
  onNavigate: (url: string) => void;
}

export function SeriesRuntimeApp(props: SeriesRuntimeAppProps): JSX.Element {
  const [similar, setSimilar] = useState<SeriesSectionState<SimilarNovel[]>>({
    status: 'loading',
  });

  useEffect(() => {
    let cancelled = false;
    setSimilar({ status: 'loading' });
    loadSeriesSimilarNovels(props.datasetBaseUrl, props.identity, props.metadata).then(
      (result) => !cancelled && setSimilar(result),
    );
    return () => {
      cancelled = true;
    };
  }, [props.datasetBaseUrl, props.identity, props.metadata]);

  return (
    <ExtensionSeriesApp
      metadata={props.metadata}
      releases={props.releases}
      reviews={{ status: 'ready', data: props.reviews }}
      similar={similar}
      onInvokeAction={props.onInvokeAction}
      onNavigate={props.onNavigate}
    />
  );
}
