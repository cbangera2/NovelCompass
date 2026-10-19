import { useEffect, useRef, useState } from 'react';
import { Check, Search, Sparkles, X } from 'lucide-react';
import { createDataSource } from './data';
import { hasUsableCover } from './novelLinks';
import { PROFILE_PARSER_VERSION } from './profile/parser';
import { mergeProfiles, saveLocalProfile } from './profile/store';
import type { LocalUserProfile, ProfileEntry } from './profile/types';
import type { NovelSearchResult } from './types';
import './onboarding.css';

const MIN_PICKS = 3;
const MAX_PICKS = 8;
const SKIP_KEY = 'novel-compass-onboarding-skipped';

const readSkipped = () => {
  try { return localStorage.getItem(SKIP_KEY) === '1'; } catch { return false; }
};

/**
 * First-run card for For You: tap a few titles you loved and they become completed 5★ entries in the
 * local profile, which seeds the library rows without an import. Reopenable from the empty/low-data state.
 */
export function ForYouOnboarding({ profile, lowData }: { profile: LocalUserProfile | null; lowData: boolean }): JSX.Element | null {
  const [open, setOpen] = useState(() => !profile?.entries.length && !readSkipped());
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<NovelSearchResult[]>([]);
  const [picked, setPicked] = useState<NovelSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const requestId = useRef(0);

  useEffect(() => {
    const text = query.trim();
    if (text.length < 2) { setResults([]); setSearching(false); return; }
    const id = ++requestId.current;
    const controller = new AbortController();
    setSearching(true);
    const timer = window.setTimeout(() => {
      createDataSource()
        .then((source) => source.searchNovels(text, 8, controller.signal))
        .then((found) => { if (id === requestId.current) setResults(found); })
        .catch(() => { if (id === requestId.current) setResults([]); })
        .finally(() => { if (id === requestId.current) setSearching(false); });
    }, 200);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query]);

  const isPicked = (id: number) => picked.some((novel) => novel.id === id);
  const toggle = (novel: NovelSearchResult) => {
    setPicked((current) => {
      if (current.some((item) => item.id === novel.id)) return current.filter((item) => item.id !== novel.id);
      return current.length >= MAX_PICKS ? current : [...current, novel];
    });
  };

  const skip = () => {
    try { localStorage.setItem(SKIP_KEY, '1'); } catch { /* storage unavailable: skip for this visit only */ }
    setOpen(false);
  };

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const manifest = await (await createDataSource()).getManifest();
      const entries: ProfileEntry[] = picked.map((novel) => ({
        novel_id: novel.id,
        slug: novel.slug,
        imported_title: novel.title,
        status: 'completed',
        rating: 5,
        source_file: 'onboarding',
      }));
      const incoming: LocalUserProfile = {
        profile_id: crypto.randomUUID(),
        parser_version: PROFILE_PARSER_VERSION,
        dataset_version: manifest.dataset_version,
        imported_at: new Date().toISOString(),
        source_fingerprints: ['onboarding'],
        entries,
        curated_lists: [],
        feedback: [],
      };
      await saveLocalProfile(mergeProfiles(profile, incoming));
      setOpen(false);
      setPicked([]);
      setQuery('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save your picks.');
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    if (profile?.entries.length && !lowData) return null;
    return (
      <div className="fy-onboarding-prompt">
        <span>{profile?.entries.length ? 'Not enough to build rows from yet?' : 'New here?'}</span>
        <button type="button" onClick={() => setOpen(true)}><Sparkles size={14} /> Pick titles you loved</button>
        {!profile?.entries.length && <>or <a href="?view=profile">import your library</a></>}
      </div>
    );
  }

  const remaining = Math.max(0, MIN_PICKS - picked.length);
  return (
    <section className="fy-onboarding" aria-labelledby="fy-onboarding-title">
      <header>
        <div>
          <p className="eyebrow"><Sparkles size={14} /> Get started</p>
          <h2 id="fy-onboarding-title">Pick a few titles you loved</h2>
          <p>Search and tap {MIN_PICKS} to {MAX_PICKS} favorites. They stay in this browser and seed your For You rows, no import needed.</p>
        </div>
        <button type="button" className="fy-onboarding-skip" onClick={skip}>Skip for now</button>
      </header>
      <label className="fy-onboarding-search">
        <Search size={16} aria-hidden="true" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search a title you loved…"
          aria-label="Search for a title you loved"
        />
      </label>
      {query.trim().length >= 2 && (
        <ul className="fy-onboarding-results" aria-label="Search results" aria-busy={searching}>
          {results.map((novel) => {
            const on = isPicked(novel.id);
            return (
              <li key={novel.id}>
                <button type="button" aria-pressed={on} disabled={!on && picked.length >= MAX_PICKS} onClick={() => toggle(novel)}>
                  {hasUsableCover(novel.cover_url) ? <img src={novel.cover_url} alt="" loading="lazy" width={36} height={54} /> : <span className="fy-onboarding-nocover" aria-hidden="true">{novel.title.slice(0, 1)}</span>}
                  <span><strong>{novel.title}</strong><small>{novel.author || novel.media_type || ''}</small></span>
                  {on && <Check size={16} aria-hidden="true" />}
                </button>
              </li>
            );
          })}
          {!searching && results.length === 0 && <li className="fy-onboarding-none">No matches. Try another spelling.</li>}
        </ul>
      )}
      <div className="fy-onboarding-picked" aria-live="polite">
        {picked.map((novel) => (
          <button type="button" key={novel.id} onClick={() => toggle(novel)} aria-label={`Remove ${novel.title}`}>
            {novel.title} <X size={13} aria-hidden="true" />
          </button>
        ))}
        {picked.length === 0 && <small>No titles picked yet.</small>}
      </div>
      <footer>
        <button type="button" className="fy-onboarding-save" disabled={picked.length < MIN_PICKS || saving} onClick={save}>
          {saving ? 'Saving…' : remaining > 0 ? `Pick ${remaining} more` : `Build my For You (${picked.length})`}
        </button>
        {!profile?.entries.length && <span>Already track your reading elsewhere? <a href="?view=profile">Import your library</a></span>}
        {error && <span className="fy-error">{error}</span>}
      </footer>
    </section>
  );
}
