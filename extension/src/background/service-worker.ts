import { ExtensionDataBroker } from '../data/broker';
import { isDataBrokerRequest, type DataBrokerResponse } from '../data/protocol';

const EXTENSION_INSTALLED_REASON = 'install';
const DATA_ORIGIN = 'https://cbangera2.github.io';
const broker = new ExtensionDataBroker({
  fetch: globalThis.fetch.bind(globalThis),
  caches,
  storage: chrome.storage.local,
  packagedUrl: (path) => chrome.runtime.getURL(`data/${path}`),
  latestUrl: `${DATA_ORIGIN}/NovelCompass/extension-data/v1/latest.json`,
  trustedOrigins: new Set([DATA_ORIGIN]),
});

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === EXTENSION_INSTALLED_REASON) {
    console.info('Novel Compass extension installed.');
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!isDataBrokerRequest(message)) return false;
  let operation: Promise<DataBrokerResponse>;
  if (message.type === 'novel-compass:data:fetch') operation = broker.fetchArtifact(message.path);
  else if (message.type === 'novel-compass:data:status') {
    operation = broker.getStatus().then((status) => ({ ok: true, status }));
  } else if (message.type === 'novel-compass:data:prepare') {
    operation = broker.prepare();
  } else operation = broker.remove();
  operation.then(sendResponse).catch((reason) =>
    sendResponse({
      ok: false,
      code: 'unavailable',
      message: reason instanceof Error ? reason.message : 'Novel Compass data broker failed.',
      retryable: true,
    } satisfies DataBrokerResponse),
  );
  return true;
});
