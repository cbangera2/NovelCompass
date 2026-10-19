import { ChangeEvent, useRef, useState } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { FileUp, X } from 'lucide-react';
import { createDataSource } from '../data';
import { enrichAniListTitles, parseAniListGdprFile } from './anilistGdpr';
import { IMPORT_FILE_ACCEPT, IMPORT_KIND_LABELS, sniffFile } from './detectImport';
import type { SniffedFile } from './detectImport';
import { parseMalFile } from './malXml';
import { parseProfileFile, PROFILE_PARSER_VERSION, withStatus } from './parser';
import { resolveEntries } from './resolve';
import { mergeProfiles, saveLocalProfile } from './store';
import { parseProfileBackup } from './transfer';
import type { LocalUserProfile, ParsedProfileFile, ProfileEntry, ReadingStatus } from './types';

const STATUS_LABELS: Record<ReadingStatus, string> = {
  reading: 'Reading',
  completed: 'Completed',
  plan_to_read: 'Plan to read',
  dropped: 'Dropped',
  paused: 'Paused',
};

export function ProfileImportDialog({
  profile,
  onImported,
}: {
  profile: LocalUserProfile | null;
  onImported?: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<ParsedProfileFile[]>([]);
  const [entries, setEntries] = useState<ProfileEntry[]>([]);
  const [datasetVersion, setDatasetVersion] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const finish = (text: string) => {
    setOpen(false);
    setMessage('');
    setFiles([]);
    setEntries([]);
    onImported?.(text);
  };

  const importBackup = async (file: File, text: string) => {
    const next = parseProfileBackup(JSON.parse(text));
    if (profile && !window.confirm(`Replace your current local profile with ${file.name}?`)) return;
    await saveLocalProfile(next);
    finish(`Imported ${next.entries.length.toLocaleString()} saved titles from ${file.name}.`);
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

  /** Sort whatever was chosen/dropped by content, then run each file through its own parser. */
  const importFiles = async (selected: File[]) => {
    if (!selected.length) return;
    setBusy(true);
    setMessage('Detecting file types…');
    try {
      const sniffed: SniffedFile[] = await Promise.all(selected.map(sniffFile));
      const unknown = sniffed.filter(({ kind }) => kind === 'unknown');
      const usable = sniffed.filter(({ kind }) => kind !== 'unknown');
      const notes = unknown.map(({ file }) => `Skipped ${file.name}: not a supported export.`);
      if (!usable.length) throw new Error(notes.join(' ') || 'Choose at least one file.');

      const backups = usable.filter(({ kind }) => kind === 'backup');
      if (backups.length) {
        if (usable.length > 1) throw new Error('A Novel Compass backup replaces your whole profile. Import it on its own.');
        await importBackup(backups[0].file, backups[0].text);
        setBusy(false);
        return;
      }

      setMessage(`Reading ${usable.map(({ kind }) => IMPORT_KIND_LABELS[kind]).join(', ')}…`);
      const parsed = await Promise.all(usable.map(async ({ file, kind, text }) => {
        if (kind === 'myanimelist') return parseMalFile(file, text);
        if (kind === 'anilist') {
          const file_ = await parseAniListGdprFile(file);
          return { ...file_, entries: await enrichAniListTitles(file_.entries) };
        }
        return parseProfileFile(file);
      }));
      await prepareParsed(parsed, 'Matching titles against the catalog…');
      if (notes.length) setMessage(notes.join(' '));
    } catch (error) {
      setFiles([]);
      setEntries([]);
      setMessage(error instanceof Error ? error.message : 'Those files could not be imported.');
      setBusy(false);
    }
  };

  const onPick = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = [...(event.target.files || [])];
    event.target.value = '';
    void importFiles(selected);
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

  const commitImport = async (importMode: 'replace' | 'merge') => {
    if (!files.length || !entries.length) return;
    if (importMode === 'replace' && profile && !window.confirm('Replace your current local profile with this import?')) return;
    const incoming: LocalUserProfile = {
      profile_id: crypto.randomUUID(),
      parser_version: PROFILE_PARSER_VERSION,
      dataset_version: datasetVersion,
      username: files.find((file) => file.username)?.username,
      imported_at: new Date().toISOString(),
      source_fingerprints: files.map((file) => file.fingerprint),
      entries,
      curated_lists: [...new Map(files.flatMap((file) => file.curated_lists).map((list) => [list.id, list])).values()],
      feedback: importMode === 'merge' ? profile?.feedback || [] : [],
    };
    const next = importMode === 'merge' ? mergeProfiles(profile, incoming) : incoming;
    await saveLocalProfile(next);
    finish(`Saved ${next.entries.length.toLocaleString()} normalized titles locally.`);
  };

  const matched = entries.filter((entry) => entry.novel_id != null).length;
  const showPreview = files.length > 0;

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger className="shell-import-trigger">
        <FileUp size={16} />
        <span>Import profile<small>MyAnimeList, AniList, NovelUpdates, or a backup</small></span>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop className="profile-backdrop" />
        <Dialog.Popup className="profile-import-dialog">
          <Dialog.Close className="detail-close" aria-label="Close import dialog"><X size={20} /></Dialog.Close>
          <span className="eyebrow">Local import</span>
          <Dialog.Title>Bring in your library</Dialog.Title>
          <Dialog.Description>Drop in your exports from MyAnimeList, AniList, or NovelUpdates. Files are read in this browser and are never uploaded.</Dialog.Description>

          <section className="profile-import-pane" role="group" aria-label="Choose files">
            <div
              className="profile-import-drop"
              data-dragging={dragging || undefined}
              onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                void importFiles([...event.dataTransfer.files]);
              }}
            >
              <button type="button" className="profile-import-primary" disabled={busy} onClick={() => fileInput.current?.click()}>
                <FileUp size={16} /> Choose files
              </button>
              <span>or drop them here — mix any of the files below; we sort them out.</span>
              <input ref={fileInput} type="file" accept={IMPORT_FILE_ACCEPT} multiple onChange={onPick} hidden />
            </div>
            <ul className="profile-import-sources">
              <li><strong>MyAnimeList</strong> <span>Open <a href="https://myanimelist.net/panel.php?go=export" target="_blank" rel="noreferrer">myanimelist.net/panel.php?go=export</a>, export your anime and/or manga list, and choose the downloaded <code>.xml.gz</code> as is. A saved list page also works, but MAL only loads 300 rows at a time.</span></li>
              <li><strong>AniList</strong> <span>Settings → Account → Download Data, then choose <code>anilist_gdpr_data.json</code>.</span></li>
              <li><strong>NovelUpdates</strong> <span>Open each Reading, Completed, or Plan to Read category, wait for the table to load, and save the page as HTML. Select as many as you like.</span></li>
              <li><strong>Novel Compass backup</strong> <span>A <code>.json</code> profile backup restores your whole profile (import it on its own).</span></li>
            </ul>
          </section>

          {showPreview && (
            <div className="profile-import-preview">
              {files.map((file, index) => (
                <div key={file.fingerprint}>
                  <span><strong>{file.filename}</strong><small>{file.source ? IMPORT_KIND_LABELS[file.source] : ''} · {file.entries.length} rows</small></span>
                  {file.source === 'novelupdates' && (
                    <label>Status
                      <select value={file.selected_status} onChange={(event) => changeStatus(index, event.target.value as ReadingStatus)}>
                        {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </select>
                    </label>
                  )}
                </div>
              ))}
              {files.flatMap((file) => file.source === 'novelupdates' ? [] : file.warnings).map((warning) => (
                <p key={warning} className="profile-import-note">{warning}</p>
              ))}
              <p>
                {entries.length} unique titles · {matched} matched in catalog · {entries.length - matched} unmatched
                {' '}(unmatched titles are still saved)
              </p>
              <div>
                {profile ? (
                  <>
                    <button type="button" onClick={() => commitImport('replace')} disabled={busy}>Replace profile</button>
                    <button type="button" className="profile-import-primary" onClick={() => commitImport('merge')} disabled={busy}>Merge into profile</button>
                  </>
                ) : (
                  <button type="button" className="profile-import-primary" onClick={() => commitImport('replace')} disabled={busy}>Save profile</button>
                )}
              </div>
            </div>
          )}
          {message && <p className="profile-import-message" role="status">{message}</p>}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
