import { LocalUserProfile } from './types';

const DB_NAME = 'novel-recommender-local-profile';
const STORE = 'profiles';
const KEY = 'active';
export const LOCAL_PROFILE_CHANGED_EVENT = 'novel-recommender:local-profile-changed';
let pendingProfileLoad: Promise<LocalUserProfile | null> | undefined;

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function transact<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const request = action(transaction.objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => db.close();
  });
}

export async function loadLocalProfile(): Promise<LocalUserProfile | null> {
  if (!pendingProfileLoad) {
    pendingProfileLoad = transact('readonly', (store) => store.get(KEY))
      .then((profile) => profile || null)
      .finally(() => { pendingProfileLoad = undefined; });
  }
  return pendingProfileLoad;
}

export async function saveLocalProfile(profile: LocalUserProfile): Promise<void> {
  await transact('readwrite', (store) => store.put(profile, KEY));
  window.dispatchEvent(new CustomEvent(LOCAL_PROFILE_CHANGED_EVENT, { detail: profile }));
}

export async function clearLocalProfile(): Promise<void> {
  await transact('readwrite', (store) => store.delete(KEY));
  window.dispatchEvent(new CustomEvent(LOCAL_PROFILE_CHANGED_EVENT, { detail: null }));
}

export function subscribeLocalProfile(listener: (profile: LocalUserProfile | null) => void): () => void {
  const handle = (event: Event) => listener((event as CustomEvent<LocalUserProfile | null>).detail);
  window.addEventListener(LOCAL_PROFILE_CHANGED_EVENT, handle);
  return () => window.removeEventListener(LOCAL_PROFILE_CHANGED_EVENT, handle);
}

export function mergeProfiles(current: LocalUserProfile | null, incoming: LocalUserProfile): LocalUserProfile {
  if (!current) return incoming;
  const entries = new Map(current.entries.map((entry) => [entry.slug, entry]));
  for (const entry of incoming.entries) entries.set(entry.slug, entry);
  const lists = new Map(current.curated_lists.map((list) => [list.id, list]));
  for (const list of incoming.curated_lists) lists.set(list.id, list);
  return {
    ...incoming,
    profile_id: current.profile_id,
    source_fingerprints: [...new Set([...(current.source_fingerprints || []), ...incoming.source_fingerprints])],
    entries: [...entries.values()],
    curated_lists: [...lists.values()],
    feedback: [...new Map([...(current.feedback || []), ...(incoming.feedback || [])].map((item) => [item.novel_id, item])).values()]
  };
}
