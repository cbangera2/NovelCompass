import { ChangeEvent, useCallback, useEffect, useRef, useState } from 'react';
import { FileUp } from 'lucide-react';
import { DSButton } from '../design-system';

export interface ImportedListStatus {
  id: number;
  items: number;
}

export interface ListImportResult {
  lists: Array<{ id: number; title: string; items: number; missing_pages: number[] }>;
  skipped: Array<{ name: string; reason: string }>;
}

export const LISTS_IMPORTED_EVENT = 'novel-lists-imported';

/** Saved Novel Updates list pages carry their canonical /viewlist/<id>/ URL in og:url. */
export function isListPageHtml(html: string): boolean {
  return /property=["']og:url["'][^>]*content=["']https?:\/\/www\.novelupdates\.com\/viewlist\/\d+/i.test(html);
}

/** Send saved list pages to the local API, which stores their members as taste signals. */
export async function uploadListPages(files: Array<{ name: string; html: string }>): Promise<ListImportResult> {
  const response = await fetch('/api/import/lists', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ files }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(
      typeof body?.detail === 'string' ? body.detail : `Server returned ${response.status} (is the live API running?)`,
    );
  }
  const result: ListImportResult = await response.json();
  window.dispatchEvent(new Event(LISTS_IMPORTED_EVENT));
  return result;
}

export function describeListImport(result: ListImportResult): string {
  const parts = result.lists.map((list) => {
    const missing = list.missing_pages.length ? ` (missing page${list.missing_pages.length > 1 ? 's' : ''} ${list.missing_pages.join(', ')})` : '';
    return `${list.title}: ${list.items} titles${missing}`;
  });
  const skipped = result.skipped.map((file) => `skipped ${file.name} (${file.reason})`);
  return [...parts, ...skipped].join('; ');
}

/** Imported member counts per list ID, from the live API (empty when it isn't running). */
export function useImportedLists(): { counts: Map<number, number>; refresh: () => void; available: boolean } {
  const [counts, setCounts] = useState<Map<number, number>>(new Map());
  const [available, setAvailable] = useState(true);
  const refresh = useCallback(() => {
    fetch('/api/for-you/lists?min_items=1')
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then((data: { lists: ImportedListStatus[] }) => {
        setCounts(new Map(data.lists.map((list) => [list.id, list.items])));
        setAvailable(true);
      })
      .catch(() => setAvailable(false));
  }, []);
  useEffect(refresh, [refresh]);
  useEffect(() => {
    window.addEventListener(LISTS_IMPORTED_EVENT, refresh);
    return () => window.removeEventListener(LISTS_IMPORTED_EVENT, refresh);
  }, [refresh]);
  return { counts, refresh, available };
}

export function ListPagesImport({ onImported, disabled }: { onImported: () => void; disabled?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ListImportResult | null>(null);
  const [error, setError] = useState('');

  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const chosen = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (!chosen.length) return;
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const files = await Promise.all(chosen.map(async (file) => ({ name: file.name, html: await file.text() })));
      setResult(await uploadListPages(files));
      onImported();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="profile-list-import">
      <input ref={input} type="file" accept=".html,.htm,text/html" multiple hidden onChange={upload} />
      <DSButton variant="outline" disabled={busy || disabled} onClick={() => input.current?.click()}>
        <FileUp size={15} /> {busy ? 'Importing…' : 'Add list pages'}
      </DSButton>
      <span>
        On Novel Updates open one of your lists, save the page (File → Save Page As) and choose every saved page of it.
        Long lists have several pages; select them all at once.
      </span>
      {error && <p className="profile-list-import-error">{error}</p>}
      {result && (
        <ul className="profile-list-import-result">
          {result.lists.map((list) => (
            <li key={list.id}>
              <strong>{list.title}</strong>: {list.items} titles
              {list.missing_pages.length > 0 && ` — missing page${list.missing_pages.length > 1 ? 's' : ''} ${list.missing_pages.join(', ')}`}
            </li>
          ))}
          {result.skipped.map((file) => (
            <li key={file.name} className="skipped">Skipped {file.name}: {file.reason}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
