import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { withFeedback, withReadingStatus, indexProfile, type FeedbackSignal, type NovelRef } from './cardActions';
import { LOCAL_PROFILE_CHANGED_EVENT, loadLocalProfile, saveLocalProfile } from './store';
import type { LocalUserProfile, ReadingStatus } from './types';

/**
 * One in-memory copy of the local profile shared by every card on the page, so a hundred tiles
 * cost one IndexedDB read. It follows the store's change event, so imports and edits made
 * elsewhere in the app show up here too.
 */
let snapshot: LocalUserProfile | null = null;
let loadStarted = false;
const listeners = new Set<() => void>();

function publish(profile: LocalUserProfile | null) {
  snapshot = profile;
  listeners.forEach((listener) => listener());
}

if (typeof window !== 'undefined') {
  window.addEventListener(LOCAL_PROFILE_CHANGED_EVENT, (event) => {
    loadStarted = true;
    publish((event as CustomEvent<LocalUserProfile | null>).detail ?? null);
  });
}

/** Reads the stored profile into the shared copy. Resolves once it is current. */
export function loadSharedProfile(): Promise<LocalUserProfile | null> {
  loadStarted = true;
  return loadLocalProfile()
    .catch(() => null)
    .then((profile) => {
      publish(profile);
      return profile;
    });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!loadStarted) void loadSharedProfile();
  return () => { listeners.delete(listener); };
}

/** Writes go one at a time, each starting from what is stored, so rapid clicks never overwrite each other. */
let writeQueue: Promise<unknown> = Promise.resolve();
function mutate(update: (profile: LocalUserProfile | null) => LocalUserProfile): Promise<LocalUserProfile> {
  const run = writeQueue.then(async () => {
    const next = update(await loadLocalProfile());
    await saveLocalProfile(next);
    return next;
  });
  writeQueue = run.catch(() => undefined);
  return run;
}

/** The local profile plus the two edits a title card can make to it. */
export function useLocalProfile(datasetVersion?: string) {
  const profile = useSyncExternalStore(subscribe, () => snapshot, () => null);
  const index = useMemo(() => indexProfile(profile), [profile]);
  const setReadingStatus = useCallback(
    (novel: NovelRef, status: ReadingStatus | '') => mutate((current) => withReadingStatus(current, novel, status, { datasetVersion })),
    [datasetVersion],
  );
  const setFeedback = useCallback(
    (novel: NovelRef, signal: FeedbackSignal) => mutate((current) => withFeedback(current, novel, signal, { datasetVersion })),
    [datasetVersion],
  );
  return { profile, entries: index.entries, feedback: index.feedback, setReadingStatus, setFeedback };
}
