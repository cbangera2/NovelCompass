const EXTENSION_INSTALLED_REASON = 'install';

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === EXTENSION_INSTALLED_REASON) {
    console.info('Novel Compass extension installed.');
  }
});
