import { LocalUserProfile } from './types';

const DB_NAME = 'novel-recommender-local-profile';
const STORE = 'profiles';
const KEY = 'active';

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
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
  return (await transact('readonly', (store) => store.get(KEY))) || null;
}

export async function saveLocalProfile(profile: LocalUserProfile): Promise<void> {
  await transact('readwrite', (store) => store.put(profile, KEY));
}

export async function clearLocalProfile(): Promise<void> {
  await transact('readwrite', (store) => store.delete(KEY));
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
    curated_lists: [...lists.values()]
  };
}
