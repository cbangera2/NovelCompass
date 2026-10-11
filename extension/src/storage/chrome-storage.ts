import type { ExtensionStorageArea } from './types';

/** Adapter only; repository tests use an in-memory implementation. */
export function chromeLocalStorageArea(): ExtensionStorageArea {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    throw new Error('Chrome extension local storage is unavailable.');
  }
  return {
    get: (keys) => chrome.storage.local.get(keys),
    set: (items) => chrome.storage.local.set(items),
    remove: (keys) => chrome.storage.local.remove(keys),
  };
}
