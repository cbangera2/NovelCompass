import {
  DATA_BROKER_PROTOCOL_VERSION,
  type DataBrokerResponse,
  normalizeArtifactPath,
} from './protocol';

export function createBrokeredDatasetFetch(): typeof fetch {
  return async (input, init) => {
    if (init?.method && init.method.toUpperCase() !== 'GET') {
      return new Response('Novel Compass data is read-only.', { status: 405 });
    }
    const path = normalizeArtifactPath(new URL(String(input)).pathname.split('/data/').pop() || '');
    if (!path) return new Response('Invalid Novel Compass data path.', { status: 400 });

    const response = (await chrome.runtime.sendMessage({
      type: 'novel-compass:data:fetch',
      protocolVersion: DATA_BROKER_PROTOCOL_VERSION,
      path,
    })) as DataBrokerResponse | undefined;

    if (!response || !response.ok || !('body' in response)) {
      const message =
        response && !response.ok ? response.message : 'The Novel Compass data service is unavailable.';
      return new Response(JSON.stringify({ error: message }), {
        status: response && !response.ok && response.code === 'update-required' ? 426 : 503,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify(response.body), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'x-novel-compass-dataset-version': response.datasetVersion,
        'x-novel-compass-cache': response.cache,
      },
    });
  };
}
