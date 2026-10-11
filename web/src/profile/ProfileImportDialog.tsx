import { ChangeEvent, useRef, useState } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { FileJson, FileText, FileUp, X } from 'lucide-react';
import { createDataSource } from '../data';
import { enrichAniListTitles, parseAniListGdprFile } from './anilistGdpr';
import { parseListFile, parseProfileFile, PROFILE_PARSER_VERSION, withListSignal, withStatus } from './parser';
import { resolveEntries } from './resolve';
import { mergeProfiles, saveLocalProfile } from './store';
import { parseProfileBackup } from './transfer';
import type { ListMembership, ListSignal, LocalUserProfile, ParsedListFile, ParsedProfileFile, ProfileEntry, ReadingStatus } from './types';

const STATUS_LABELS: Record<ReadingStatus, string> = {
  reading: 'Reading',
  completed: 'Completed',
  plan_to_read: 'Plan to read',
  dropped: 'Dropped',
  paused: 'Paused',
};

const LIST_SIGNAL_LABELS: Record<ListSignal, string> = {
  favorites: 'Favorites (seeds + excluded)',
  mixed: 'Mixed (weak seeds)',
  to_read: 'To read (excluded only)',
};

type ImportMode = 'json' | 'html' | 'anilist';

export function ProfileImportDialog({
  profile,
  onImported,
}: {
  profile: LocalUserProfile | null;
  onImported?: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<ImportMode>('json');
  const [files, setFiles] = useState<ParsedProfileFile[]>([]);
  const [entries, setEntries] = useState<ProfileEntry[]>([]);
  const [listFiles, setListFiles] = useState<ParsedListFile[]>([]);
  const [datasetVersion, setDatasetVersion] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const jsonInput = useRef<HTMLInputElement>(null);
  const anilistInput = useRef<HTMLInputElement>(null);

  const finish = (text: string) => {
    setOpen(false);
    setMessage('');
    setFiles([]);
    setEntries([]);
    setListFiles([]);
    onImported?.(text);
  };

  const importBackup = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBusy(true);
    setMessage('');
    try {
      const next = parseProfileBackup(JSON.parse(await file.text()));
      if (profile && !window.confirm(`Replace your current local profile with ${file.name}?`)) return;
      await saveLocalProfile(next);
      finish(`Imported ${next.entries.length.toLocaleString()} saved titles from ${file.name}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'This profile backup could not be imported.');
    } finally {
      setBusy(false);
    }
  };

  const prepareParsed = async (parsed: ParsedProfileFile[], statusMessage: string) => {
    setBusy(true);
    setMessage(statusMessage);
    try {
      const source = await createDataSource();
      const manifest = await source.getManifest();
      const resolved = await resolveEntries(parsed, source);
      const unique = new Map<string, ProfileEntry>();
      resolved.forEach((entry) => unique.set(entry.slug, entry));
      setFiles(parsed);
      setEntries([...unique.values()]);
      setDatasetVersion(manifest.dataset_version);
      setMessage('');
    } catch (error) {
      setFiles([]);
      setEntries([]);
      setMessage(error instanceof Error ? error.message : 'Those files could not be imported.');
    } finally {
      setBusy(false);
    }
  };

  /** Split saved HTML into reading-list pages vs recommendation-list pages. */
  const parseHtmlFiles = async (selected: File[]): Promise<{ profile: ParsedProfileFile[]; lists: ParsedListFile[] }> => {
    const profile: ParsedProfileFile[] = [];
    const lists: ParsedListFile[] = [];
    const failures: string[] = [];
    for (const file of selected) {
      try {
        profile.push(await parseProfileFile(file));
        continue;
      } catch {
        // Not a reading-list page — try a recommendation-list page.
      }
      try {
        lists.push(await parseListFile(file));
      } catch {
        failures.push(file.name);
      }
    }
    if (!profile.length && !lists.length) {
      throw new Error(
        `None of these look like saved Novel Updates pages${failures.length ? ` (${failures.join(', ')})` : ''}. ` +
        'Save a reading-list category or a viewlist page after it fully loads.'
      );
    }
    return { profile, lists };
  };

  const resolveListMembers = async (parsed: ParsedListFile[]) => {
    const source = await createDataSource();
    const manifest = await source.getManifest();
    const resolved = await Promise.all(parsed.map(async (file) => {
      const matches = await source.resolveSlugs(
        file.members.map((member) => ({ slug: member.slug, title: member.imported_title }))
      );
      return {
        ...file,
        members: file.members.map((member) => ({
          ...member,
          novel_id: matches.get(member.slug)?.id,
        })),
      };
    }));
    setListFiles(resolved);
    setDatasetVersion(manifest.dataset_version);
  };

  const prepareHtml = async (event: ChangeEvent<HTMLInputElement>) => {
    const selected = [...(event.target.files || [])];
    event.target.value = '';
    if (!selected.length) return;
    setBusy(true);
    setMessage('Parsing saved pages and matching titles…');
    try {
      const { profile, lists } = await parseHtmlFiles(selected);
      if (profile.length) await prepareParsed(profile, 'Matching titles against the catalog…');
      else {
        setFiles([]);
        setEntries([]);
      }
      if (lists.length) {
        setMessage('Matching list titles against the catalog…');
        await resolveListMembers(lists);
      } else {
        setListFiles([]);
      }
      setMessage('');
    } catch (error) {
      setFiles([]);
      setEntries([]);
      setListFiles([]);
      setMessage(error instanceof Error ? error.message : 'Those saved pages could not be imported.');
      setBusy(false);
    }
  };

  const prepareAniList = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBusy(true);
    setMessage('Parsing AniList GDPR export and fetching titles…');
    try {
      const parsed = await parseAniListGdprFile(file);
      const withTitles = {
        ...parsed,
        entries: await enrichAniListTitles(parsed.entries),
      };
      await prepareParsed([withTitles], 'Matching AniList IDs against the catalog…');
    } catch (error) {
      setFiles([]);
      setEntries([]);
      setMessage(error instanceof Error ? error.message : 'That AniList export could not be imported.');
      setBusy(false);
    }
  };

  const changeStatus = async (index: number, status: ReadingStatus) => {
    const next = files.map((file, fileIndex) => (fileIndex === index ? withStatus(file, status) : file));
    setFiles(next);
    setBusy(true);
    try {
      const source = await createDataSource();
      const resolved = await resolveEntries(next, source);
      const unique = new Map<string, ProfileEntry>();
      resolved.forEach((entry) => unique.set(entry.slug, entry));
      setEntries([...unique.values()]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not update the import preview.');
    } finally {
      setBusy(false);
    }
  };

  const changeListSignal = (fingerprint: string, signal: ListSignal) => {
    setListFiles((current) =>
      current.map((file) => (file.fingerprint === fingerprint ? withListSignal(file, signal) : file))
    );
  };

  const commitImport = async (importMode: 'replace' | 'merge') => {
    if ((!files.length || !entries.length) && !listFiles.length) return;
    if (importMode === 'replace' && profile && !window.confirm('Replace your current local profile with this import?')) return;
    // Same list saved across several pages merges here (member slugs union).
    const grouped = new Map<number, ParsedListFile>();
    for (const file of listFiles) {
      const prev = grouped.get(file.list_id);
      if (!prev) {
        grouped.set(file.list_id, file);
        continue;
      }
      const seen = new Set(prev.members.map((m) => m.slug));
      const extra = file.members.filter((m) => !seen.has(m.slug));
      grouped.set(file.list_id, { ...prev, members: [...prev.members, ...extra] });
    }
    const membership: ListMembership[] = [...grouped.values()].map((file) => ({
      list_id: file.list_id,
      title: file.title,
      signal: file.selected_signal,
      members: file.members.map(({ slug, imported_title, novel_id }) => ({ slug, imported_title, novel_id })),
      source_file: file.filename,
    }));
    const incoming: LocalUserProfile = {
      profile_id: crypto.randomUUID(),
      parser_version: PROFILE_PARSER_VERSION,
      dataset_version: datasetVersion,
      username: files.find((file) => file.username)?.username,
      imported_at: new Date().toISOString(),
      source_fingerprints: [
        ...files.map((file) => file.fingerprint),
        ...listFiles.map((file) => file.fingerprint),
      ],
      entries,
      curated_lists: [
        ...new Map([
          ...files.flatMap((file) => file.curated_lists).map((list) => [list.id, list] as const),
          // Imported membership supersedes stale summaries for the same list.
          ...[...grouped.values()].map((file) => [file.list_id, {
            id: file.list_id,
            title: file.title,
            series_count: file.members.length,
            membership_available: true as const,
          }] as const),
        ]).values(),
      ],
      list_membership: membership,
      taste_overrides: profile?.taste_overrides,
      feedback: importMode === 'merge' ? profile?.feedback || [] : [],
    };
    const next = importMode === 'merge' ? mergeProfiles(profile, incoming) : incoming;
    await saveLocalProfile(next);
    const listCount = membership.reduce((sum, m) => sum + m.members.length, 0);
    finish(
      `Saved ${next.entries.length.toLocaleString()} normalized titles locally` +
      (listCount ? ` plus ${listCount.toLocaleString()} list titles (${membership.length} lists).` : '.')
    );
  };

  const matched = entries.filter((entry) => entry.novel_id != null).length;
  const listMatched = listFiles.reduce(
    (sum, file) => sum + file.members.filter((member) => member.novel_id != null).length, 0);
  const listTotal = listFiles.reduce((sum, file) => sum + file.members.length, 0);
  const showPreview = (files.length > 0 || listFiles.length > 0) && (mode === 'html' || mode === 'anilist');
  const isAniListMode = mode === 'anilist';

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger className="shell-import-trigger">
        <FileUp size={16} />
        <span>Import profile<small>JSON, NovelUpdates HTML, or AniList GDPR</small></span>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop className="profile-backdrop" />
        <Dialog.Popup className="profile-import-dialog">
          <Dialog.Close className="detail-close" aria-label="Close import dialog"><X size={20} /></Dialog.Close>
          <span className="eyebrow">Local import</span>
          <Dialog.Title>Bring in your library</Dialog.Title>
          <Dialog.Description>Choose the source you already have. Files are read in this browser and are never uploaded.</Dialog.Description>

          <div className="profile-import-tabs" role="tablist" aria-label="Import source">
            <button type="button" role="tab" aria-selected={mode === 'json'} onClick={() => setMode('json')}>
              <FileJson size={20} /><span><strong>Novel Compass JSON</strong><small>Restore an exported profile backup</small></span>
            </button>
            <button type="button" role="tab" aria-selected={mode === 'html'} onClick={() => setMode('html')}>
              <FileText size={20} /><span><strong>NovelUpdates HTML</strong><small>Import saved reading-list pages</small></span>
            </button>
            <button type="button" role="tab" aria-selected={mode === 'anilist'} onClick={() => setMode('anilist')}>
              <FileJson size={20} /><span><strong>AniList GDPR</strong><small>Import anilist_gdpr_data.json</small></span>
            </button>
          </div>

          {mode === 'json' ? (
            <section className="profile-import-pane" role="tabpanel">
              <h3>Restore a Novel Compass backup</h3>
              <p>This replaces the current local profile after the backup structure and every library entry are validated.</p>
              <button type="button" className="profile-import-primary" disabled={busy} onClick={() => jsonInput.current?.click()}>
                <FileUp size={16} /> Choose JSON backup
              </button>
              <input ref={jsonInput} type="file" accept=".json,application/json" onChange={importBackup} hidden />
            </section>
          ) : mode === 'html' ? (
            <section className="profile-import-pane" role="tabpanel">
              <h3>Import saved NovelUpdates pages</h3>
              <p>Open each Reading, Completed, or Plan to Read category, wait for its table, then save the page. You can also save your own recommendation-list pages (…/viewlist/ID/) — list membership is your strongest like-signal. Select one or several HTML files here.</p>
              <label className="profile-import-primary">
                <FileUp size={16} /> Choose saved HTML pages
                <input type="file" accept=".html,.htm,text/html" multiple onChange={prepareHtml} disabled={busy} hidden />
              </label>
              <p className="profile-import-note"><strong>Why no profile-link field?</strong> NovelUpdates pages cannot be fetched reliably from a static site because of browser cross-origin rules and bot protection. Saving the loaded page preserves a private, dependable import — and works for private lists too.</p>
              <p className="profile-import-note">Lists spanning multiple pages: save every page; files for the same list merge on import.</p>
            </section>
          ) : (
            <section className="profile-import-pane" role="tabpanel">
              <h3>Import AniList GDPR export</h3>
              <p>
                On AniList go to <strong>Settings → Account → Download Data</strong>, then choose the resulting
                {' '}<code>anilist_gdpr_data.json</code> here. List status, scores, and progress are preserved locally.
              </p>
              <button type="button" className="profile-import-primary" disabled={busy} onClick={() => anilistInput.current?.click()}>
                <FileUp size={16} /> Choose anilist_gdpr_data.json
              </button>
              <input ref={anilistInput} type="file" accept=".json,application/json" onChange={prepareAniList} hidden />
              <p className="profile-import-note">
                <strong>Matching note:</strong> AniList rows only include media IDs. Titles are fetched from AniList’s public API when online.
                Catalog matches only succeed for titles already ingested into Novel Compass (popular sync / manual AniList sync).
                Unmatched entries still save to your local profile for later.
              </p>
            </section>
          )}

          {showPreview && (
            <div className="profile-import-preview">
              {files.map((file, index) => (
                <div key={file.fingerprint}>
                  <span><strong>{file.filename}</strong><small>{file.entries.length} rows</small></span>
                  {!isAniListMode && (
                    <label>Status
                      <select value={file.selected_status} onChange={(event) => changeStatus(index, event.target.value as ReadingStatus)}>
                        {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </select>
                    </label>
                  )}
                </div>
              ))}
              {isAniListMode && files[0]?.warnings?.map((warning) => (
                <p key={warning} className="profile-import-note">{warning}</p>
              ))}
              {listFiles.map((file) => (
                <div key={file.fingerprint}>
                  <span><strong>{file.title}</strong><small>{file.filename} · {file.members.length} titles · {file.members.filter((m) => m.novel_id != null).length} matched</small></span>
                  <label>List signal
                    <select value={file.selected_signal} onChange={(event) => changeListSignal(file.fingerprint, event.target.value as ListSignal)}>
                      {Object.entries(LIST_SIGNAL_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                  </label>
                </div>
              ))}
              <p>
                {entries.length} unique titles · {matched} matched in catalog · {entries.length - matched} unmatched
                {isAniListMode ? ' (still saved with AniList IDs)' : ''}
                {listFiles.length > 0 && (
                  <> · {listTotal} list titles · {listMatched} matched</>
                )}
              </p>
              <div>
                {profile && <button type="button" onClick={() => commitImport('merge')} disabled={busy}>Merge with profile</button>}
                <button type="button" className="profile-import-primary" onClick={() => commitImport('replace')} disabled={busy}>Replace and save</button>
              </div>
            </div>
          )}
          {message && <p className="profile-import-message" role="status">{message}</p>}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
