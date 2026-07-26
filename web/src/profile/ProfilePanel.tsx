import { ChangeEvent, useEffect, useMemo, useState } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { Download, FileUp, Trash2, User, X } from 'lucide-react';
import { DatasetManifest } from '../types';
import { RecommendationDataSource } from '../data';
import { parseProfileFile, PROFILE_PARSER_VERSION, withStatus } from './parser';
import { applyResolvedNovelIds, resolveEntries } from './resolve';
import { clearLocalProfile, mergeProfiles, saveLocalProfile } from './store';
import { ImportPreview, LocalUserProfile, ParsedProfileFile, ProfileEntry, ReadingStatus } from './types';

const STATUS_LABELS: Record<ReadingStatus, string> = {
  reading: 'Reading',
  completed: 'Completed',
  plan_to_read: 'Plan to read',
  dropped: 'Dropped',
  paused: 'Paused',
};

export function ProfilePanel({
  source,
  dataset,
  profile,
  onProfileChange,
  onUseSeed,
  showPageLink = true
}: {
  source: RecommendationDataSource | null;
  dataset: DatasetManifest | null;
  profile: LocalUserProfile | null;
  onProfileChange: (profile: LocalUserProfile | null) => void;
  onUseSeed: (entry: ProfileEntry) => void;
  showPageLink?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<ParsedProfileFile[]>([]);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!profile || !source || !dataset || profile.dataset_version === dataset.dataset_version) return;
    source.resolveSlugs(profile.entries.map((entry) => ({ slug: entry.slug, title: entry.imported_title })))
      .then(async (resolved) => {
        const refreshed = {
          ...profile,
          dataset_version: dataset.dataset_version,
          entries: applyResolvedNovelIds(profile.entries, resolved)
        };
        await saveLocalProfile(refreshed);
        onProfileChange(refreshed);
      })
      .catch(() => setMessage('Your saved profile could not be re-matched against the new dataset yet.'));
  }, [dataset, onProfileChange, profile, source]);

  const statusCounts = useMemo(() => {
    const counts: Record<ReadingStatus, number> = {
      reading: 0, completed: 0, plan_to_read: 0, dropped: 0, paused: 0,
    };
    profile?.entries.forEach((entry) => { counts[entry.status] += 1; });
    return counts;
  }, [profile]);

  const rebuildPreview = async (nextFiles: ParsedProfileFile[]) => {
    if (!source) return;
    setBusy(true);
    setMessage('Matching exact Novel Updates slugs against this dataset…');
    try {
      const entries = await resolveEntries(nextFiles, source);
      const bySlug = new Map<string, ProfileEntry>();
      const conflicts = new Set<string>();
      const duplicates = new Set<string>();
      for (const entry of entries) {
        const previous = bySlug.get(entry.slug);
        if (previous) {
          duplicates.add(entry.slug);
          if (previous.status !== entry.status) conflicts.add(entry.slug);
        }
        bySlug.set(entry.slug, entry);
      }
      const lists = new Map(nextFiles.flatMap((file) => file.curated_lists).map((list) => [list.id, list]));
      const unique = [...bySlug.values()];
      setPreview({
        files: nextFiles,
        entries: unique,
        curated_lists: [...lists.values()],
        matched: unique.filter((entry) => entry.novel_id != null).length,
        unmatched: unique.filter((entry) => entry.novel_id == null).length,
        duplicate_slugs: [...duplicates],
        conflicts: [...conflicts],
        warnings: nextFiles.flatMap((file) => file.warnings),
        missing_statuses: (Object.keys(STATUS_LABELS) as ReadingStatus[])
          .filter((status) => !nextFiles.some((file) => file.selected_status === status))
      });
      setMessage(null);
    } catch (error: any) {
      setMessage(error.message || 'Could not prepare the import preview.');
    } finally {
      setBusy(false);
    }
  };

  const importFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const selected = [...(event.target.files || [])];
    event.target.value = '';
    if (!selected.length) return;
    setBusy(true);
    setMessage(null);
    try {
      const parsed = await Promise.all(selected.map(parseProfileFile));
      setFiles(parsed);
      await rebuildPreview(parsed);
    } catch (error: any) {
      setFiles([]);
      setPreview(null);
      setMessage(error.message || 'Could not parse those files.');
    } finally {
      setBusy(false);
    }
  };

  const changeStatus = async (index: number, status: ReadingStatus) => {
    const next = files.map((file, fileIndex) => fileIndex === index ? withStatus(file, status) : file);
    setFiles(next);
    await rebuildPreview(next);
  };

  const commit = async (mode: 'replace' | 'merge') => {
    if (!preview || !dataset) return;
    const incoming: LocalUserProfile = {
      profile_id: crypto.randomUUID(),
      parser_version: PROFILE_PARSER_VERSION,
      dataset_version: dataset.dataset_version,
      username: preview.files.find((file) => file.username)?.username,
      imported_at: new Date().toISOString(),
      source_fingerprints: preview.files.map((file) => file.fingerprint),
      entries: preview.entries,
      curated_lists: preview.curated_lists,
      feedback: mode === 'merge' ? profile?.feedback || [] : []
    };
    const next = mode === 'merge' ? mergeProfiles(profile, incoming) : incoming;
    await saveLocalProfile(next);
    onProfileChange(next);
    setFiles([]);
    setPreview(null);
    setMessage(`Saved ${next.entries.length.toLocaleString()} normalized entries locally.`);
  };

  const clear = async () => {
    if (!window.confirm('Delete the complete local profile from this browser?')) return;
    await clearLocalProfile();
    onProfileChange(null);
    setMessage('Local profile deleted.');
  };

  const download = (value: unknown, filename: string) => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger className="profile-launch">
        <User size={16} aria-hidden="true" />
        {profile ? `${profile.username || 'Local profile'} · ${profile.entries.length.toLocaleString()} titles` : 'Import my library'}
      </Dialog.Trigger>
      {showPageLink && <a className="profile-page-link" href={`${import.meta.env.BASE_URL}?view=profile`}>Open profile page</a>}
      <Dialog.Portal>
        <Dialog.Backdrop className="profile-backdrop" />
          <Dialog.Popup className="profile-panel">
            <Dialog.Close className="detail-close" aria-label="Close profile"><X size={20} /></Dialog.Close>
            <div className="profile-heading">
              <span className="eyebrow">Private and local</span>
              <Dialog.Title id="profile-title">Your Novel Updates library</Dialog.Title>
              <Dialog.Description>Import saved Reading, Plan to read, and Completed profile pages. HTML is parsed in memory and never stored.</Dialog.Description>
            </div>

            {profile && (
              <div className="profile-summary">
                <div><strong>{profile.entries.length.toLocaleString()}</strong><span>Total titles</span></div>
                <div><strong>{statusCounts.reading}</strong><span>Reading</span></div>
                <div><strong>{statusCounts.completed}</strong><span>Completed</span></div>
                <div><strong>{statusCounts.plan_to_read}</strong><span>Planned</span></div>
              </div>
            )}

            <div className="profile-actions">
              <label className="profile-import-button">
                <FileUp size={16} /> Choose saved HTML pages
                <input type="file" accept=".html,.htm,text/html" multiple onChange={importFiles} disabled={!source || busy} />
              </label>
              {profile && <button type="button" onClick={() => download(profile, 'novel-profile.json')}><Download size={15} /> Export JSON</button>}
              {profile && <button type="button" className="danger-action" onClick={clear}><Trash2 size={15} /> Clear profile</button>}
            </div>
            <p className="profile-help">Open each category on Novel Updates, wait for its table to appear, then save that page. A single file is valid but represents only one category.</p>
            {message && <div className="profile-message">{message}</div>}

            {files.length > 0 && (
              <div className="profile-files">
                {files.map((file, index) => (
                  <div key={file.fingerprint}>
                    <span><strong>{file.filename}</strong><small>{file.entries.length} rows · detected {STATUS_LABELS[file.detected_status]}</small></span>
                    <label>Status
                      <select value={file.selected_status} onChange={(event) => changeStatus(index, event.target.value as ReadingStatus)}>
                        {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </select>
                    </label>
                  </div>
                ))}
              </div>
            )}

            {preview && (
              <div className="profile-preview">
                <h3>Import preview</h3>
                <div className="preview-stats">
                  <span><strong>{preview.entries.length}</strong> unique</span>
                  <span className="matched"><strong>{preview.matched}</strong> matched</span>
                  <span className={preview.unmatched ? 'warning' : ''}><strong>{preview.unmatched}</strong> unmatched</span>
                  <span><strong>{preview.duplicate_slugs.length}</strong> duplicates</span>
                  <span className={preview.conflicts.length ? 'warning' : ''}><strong>{preview.conflicts.length}</strong> category conflicts</span>
                  <span><strong>{preview.curated_lists.length}</strong> list summaries</span>
                </div>
                {preview.missing_statuses.length > 0 && (
                  <p className="profile-warning">
                    Not imported: {preview.missing_statuses.map((status) => STATUS_LABELS[status]).join(', ')}. This is a partial history.
                  </p>
                )}
                {profile && preview.files.some((file) => profile.source_fingerprints?.includes(file.fingerprint)) && (
                  <p className="profile-warning">At least one of these exact files was imported before. Merge will update its entries without duplicating them.</p>
                )}
                {preview.conflicts.length > 0 && <p className="profile-warning">For conflicting slugs, the category from the last selected file will be saved.</p>}
                {preview.unmatched > 0 && <details><summary>Unmatched titles</summary><ul>{preview.entries.filter((entry) => !entry.novel_id).slice(0, 100).map((entry) => <li key={entry.slug}>{entry.imported_title} <small>/{entry.slug}</small></li>)}</ul></details>}
                {preview.curated_lists.length > 0 && <details><summary>Created list summaries</summary><ul>{preview.curated_lists.map((list) => <li key={list.id}>{list.title}{list.is_private ? ' · Private' : ''} <small>Membership not included</small></li>)}</ul></details>}
                <div className="profile-confirm">
                  <button type="button" onClick={() => download(preview, 'novel-profile-preview.json')}><Download size={15} /> Download preview</button>
                  {profile && <button type="button" onClick={() => commit('merge')} disabled={busy}>Merge with profile</button>}
                  <button type="button" className="primary" onClick={() => commit('replace')} disabled={busy}>Replace and save</button>
                </div>
              </div>
            )}

            {profile && profile.entries.length > 0 && (
              <div className="profile-library">
                <h3>Find similar from your library</h3>
                <div>{profile.entries.filter((entry) => entry.novel_id).slice(0, 60).map((entry) => (
                  <button type="button" key={entry.slug} onClick={() => { onUseSeed(entry); setOpen(false); }}>
                    <span>{entry.imported_title}</span><small>{STATUS_LABELS[entry.status]}{entry.rating ? ` · ${entry.rating}★` : ''}</small>
                  </button>
                ))}</div>
                {profile.entries.filter((entry) => entry.novel_id).length > 60 && <p>Showing the first 60 matched titles.</p>}
              </div>
            )}
          </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
