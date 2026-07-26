import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Database, FileUp, Globe2, Pause, Play, Radar, RefreshCw } from 'lucide-react';
import { Badge, Card, CardHeader, DSButton, Separator } from './design-system';
import './scraper-dashboard.css';

const API = (import.meta.env.VITE_API_URL || 'http://localhost:8000').replace(/\/$/, '');

type Status = {
  database: string;
  artifact: Record<string, string>;
  running: boolean;
  queue: {
    counts: Record<string, number>;
    pending_by_type: Record<string, number>;
    pending_by_phase: Record<string, number>;
    pending_novels: { new_or_unresolved: number; refresh: number };
  };
  latest_run: null | Record<string, string | number | null>;
  last_worker_result: null | {
    status?: string;
    reason?: string;
    errors?: number;
  };
  recent_errors: Array<Record<string, string | number | null>>;
  browser_session: {
    setup_running: boolean;
    ready: boolean;
    prepared: boolean;
    error: string | null;
    profile: string;
  };
  safety: {
    batch_limit_max: number;
    request_delay_seconds: string;
    stops_on_http: number[];
    pause_behavior: string;
  };
};

async function post(path: string, body?: object) {
  const response = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.detail || 'Request failed');
  return payload;
}

export default function ScraperDashboard() {
  const [status, setStatus] = useState<Status | null>(null);
  const [maxItems, setMaxItems] = useState(10);
  const [transport, setTransport] = useState<'urllib' | 'browser'>('urllib');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [sourceUrl, setSourceUrl] = useState('');
  const [importResult, setImportResult] = useState<Record<string, number> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`${API}/api/scraper/status`);
      if (!response.ok) throw new Error('Scraper API is unavailable');
      setStatus(await response.json());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not load status');
    }
  }, []);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 2500);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const act = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setMessage('');
    try {
      await action();
      setMessage(success);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  };

  const counts = status?.queue.counts || {};
  const latest = status?.latest_run;
  const uploadImport = async () => {
    if (!importFile) throw new Error('Choose a HAR or saved HTML file.');
    const isHtml = /\.html?$/i.test(importFile.name);
    if (isHtml && !sourceUrl.trim()) {
      throw new Error('Enter the original Novel Updates URL for saved HTML.');
    }
    const response = await fetch(`${API}/api/scraper/import`, {
      method: 'POST',
      headers: {
        'Content-Type': isHtml ? 'text/html' : 'application/json',
        'X-Filename': importFile.name,
        ...(isHtml ? { 'X-Source-URL': sourceUrl.trim() } : {})
      },
      body: importFile
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.detail || 'Import failed');
    setImportResult(payload);
    return payload;
  };

  return (
    <main className="scraper-shell">
      <header className="scraper-hero ds-page-header">
        <span className="scraper-icon"><Radar aria-hidden="true" /></span>
        <div>
          <p className="eyebrow">Local data workshop</p>
          <h1>Catalog scraper</h1>
          <p>Discover missing novels first, then refresh the older snapshot in small, respectful batches.</p>
        </div>
        <Badge tone={status?.running ? 'green' : 'neutral'}>
          {status?.running
            ? 'Batch running'
            : `${status?.artifact.artifact_status || 'Loading'} artifact`}
        </Badge>
      </header>

      <section className="scraper-grid metrics">
        <Metric label="Pending discovery work" value={status?.queue.pending_by_phase.discovery || 0} />
        <Metric label="New or unresolved" value={status?.queue.pending_by_phase.new_novel || 0} accent />
        <Metric label="Existing to refresh" value={status?.queue.pending_by_phase.refresh_existing || 0} />
        <Metric label="Completed" value={counts.complete || 0} />
        <Metric label="Blocked / failed" value={(counts.blocked || 0) + (counts.failed || 0)} warn />
      </section>

      <section className="scraper-grid panels">
        <Card className="scraper-panel controls">
          <CardHeader eyebrow="Bounded execution" title="Safe controls" description="One bounded batch can run at a time."
            action={<Database size={19} aria-hidden="true" />} />
          <DSButton variant="outline" disabled={busy || status?.running} onClick={() =>
            act(() => post('/api/scraper/seed-discovery'), 'Discovery pages added to the queue.')
          }><RefreshCw size={17} /> Seed missing-novel discovery</DSButton>
          <div className="control-grid">
          <label><span>Pages in next batch</span>
            <input type="number" min="1" max="100" value={maxItems}
              onChange={(event) => setMaxItems(Math.max(1, Math.min(100, Number(event.target.value))))} />
          </label>
          <label><span>Request transport</span>
            <select value={transport} disabled={busy || status?.running}
              onChange={(event) => setTransport(event.target.value as 'urllib' | 'browser')}>
              <option value="urllib">Standard HTTP (default)</option>
              <option value="browser">Saved browser session</option>
            </select>
          </label>
          </div>
          {transport === 'browser' && <div className="browser-session">
            <div className="browser-session-copy">
              <Globe2 size={18} />
              <div>
                <strong>Manual browser session</strong>
                <p>
                  {status?.browser_session.error
                    ? status.browser_session.error
                    : status?.browser_session.setup_running
                      ? 'A headed browser is open. Handle login or the challenge yourself.'
                      : status?.browser_session.prepared
                        ? 'A saved local browser profile is available. Reopen setup whenever the session expires.'
                        : 'Open the browser once to prepare its private local session.'}
                </p>
              </div>
            </div>
            <div className="button-row">
              <DSButton variant="outline" disabled={busy || status?.running || status?.browser_session.setup_running}
                onClick={() => act(
                  () => post('/api/scraper/browser-session/open'),
                  'Browser setup is launching. Complete the site steps manually.'
                )}>
                <Globe2 size={17} /> Open setup browser
              </DSButton>
              <DSButton variant="outline" disabled={busy || !status?.browser_session.setup_running}
                onClick={() => act(
                  () => post('/api/scraper/browser-session/finish'),
                  'Session save requested. Wait for the browser to close.'
                )}>
                Finish session setup
              </DSButton>
            </div>
            <small>Private profile: {status?.browser_session.profile || 'Loading…'}</small>
          </div>}
          <div className="button-row">
            <DSButton variant="primary" disabled={busy || status?.running || status?.browser_session.setup_running} onClick={() =>
              act(
                () => post('/api/scraper/run', { max_items: maxItems, transport }),
                `Started a ${transport === 'browser' ? 'browser-session' : 'standard HTTP'} batch of up to ${maxItems} pages.`
              )
            }><Play size={17} /> Run batch</DSButton>
            <DSButton className="danger" variant="outline" disabled={busy || !status?.running} onClick={() =>
              act(() => post('/api/scraper/pause'), 'Stop requested; the current request will finish safely.')
            }><Pause size={17} /> Stop safely</DSButton>
          </div>
          {message && <p className="dashboard-message">{message}</p>}
          {status?.last_worker_result?.status === 'failed' && <p className="dashboard-error">
            {status.last_worker_result.reason || 'The scraper worker could not start.'}
          </p>}
          {status?.safety && <p className="safety-note"><AlertTriangle size={16} />
            Requests retain a {status.safety.request_delay_seconds}s delay and stop automatically on HTTP {status.safety.stops_on_http.join(', ')}.
          </p>}
        </Card>

        <Card className="scraper-panel">
          <CardHeader eyebrow="Run telemetry" title="Latest run" description={latest ? `Run #${latest.id}` : 'No runs recorded'}
            action={<Radar size={19} aria-hidden="true" />} />
          <Separator />
          {latest ? <dl className="run-detail">
            <div><dt>Status</dt><dd>{latest.status}</dd></div>
            <div><dt>Network pages</dt><dd>{latest.pages_scraped}</dd></div>
            <div><dt>Cached pages</dt><dd>{latest.pages_cached}</dd></div>
            <div><dt>Novels discovered</dt><dd>{latest.pages_discovered}</dd></div>
            <div><dt>Errors</dt><dd>{latest.errors}</dd></div>
            <div className="wide"><dt>Stopped because</dt><dd>{latest.stop_reason || '—'}</dd></div>
            <div className="wide"><dt>Last heartbeat</dt><dd>{latest.heartbeat_at}</dd></div>
          </dl> : <p className="empty">Run a small batch when you are ready.</p>}
        </Card>
      </section>

      <Card className="scraper-panel import-panel">
        <CardHeader eyebrow="Multi-Source Integration" title="AniList Multi-Media Ingestion"
          description="Sync popular or searched Anime and Manga directly from AniList's public GraphQL API."
          action={<Globe2 size={19} aria-hidden="true" />} />
        <Separator />
        <div className="import-grid">
          <label>Media search query <span>(optional)</span>
            <input type="text" placeholder="e.g. Frieren, Chainsaw Man, One Piece..."
              value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} />
          </label>
          <label>Pages to fetch <span>(20 per page)</span>
            <input type="number" min="1" max="5" value={maxItems}
              onChange={(event) => setMaxItems(Math.max(1, Math.min(5, Number(event.target.value))))} />
          </label>
          <div style={{ display: 'flex', gap: '0.5rem', gridColumn: 'span 2' }}>
            <DSButton variant="primary" disabled={busy} onClick={() =>
              act(async () => {
                const res = await post('/api/scraper/anilist/sync', {
                  pages: maxItems,
                  per_page: 20,
                  media_type: 'manga',
                  query: sourceUrl.trim() || undefined
                });
                setImportResult({
                  ingested_manga: res.ingested_count,
                  total_anilist_media: res.total_anilist_media
                });
                return res;
              }, `AniList Manga sync complete.`)
            }><Play size={17} /> Sync Manga</DSButton>
            <DSButton variant="primary" disabled={busy} onClick={() =>
              act(async () => {
                const res = await post('/api/scraper/anilist/sync', {
                  pages: maxItems,
                  per_page: 20,
                  media_type: 'anime',
                  query: sourceUrl.trim() || undefined
                });
                setImportResult({
                  ingested_anime: res.ingested_count,
                  total_anilist_media: res.total_anilist_media
                });
                return res;
              }, `AniList Anime sync complete.`)
            }><Play size={17} /> Sync Anime</DSButton>
          </div>
        </div>
      </Card>

      <Card className="scraper-panel import-panel">
        <CardHeader eyebrow="Offline recovery" title="Import captured pages"
          description="Use a HAR or saved HTML when the live site presents a bot challenge."
          action={<FileUp size={19} aria-hidden="true" />} />
        <Separator />
        <div className="import-grid">
          <label>Captured file
            <input type="file" accept=".har,.html,.htm,application/json,text/html"
              onChange={(event) => {
                setImportFile(event.target.files?.[0] || null);
                setImportResult(null);
              }} />
          </label>
          <label>Original page URL <span>(HTML only)</span>
            <input type="url" placeholder="https://www.novelupdates.com/series/..."
              value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} />
          </label>
          <DSButton variant="primary" disabled={busy || !importFile} onClick={() =>
            act(uploadImport, 'Offline capture processed.')
          }><FileUp size={17} /> Import locally</DSButton>
        </div>
        <p className="safety-note"><AlertTriangle size={16} />
          The importer reads only successful Novel Updates HTML responses. It never replays cookies or headers and never stores the raw HAR.
        </p>
        {importResult && <dl className="import-results">
          {Object.keys(importResult).map(key =>
            <div key={key}><dt>{key.replace(/_/g, ' ')}</dt><dd>{importResult[key] || 0}</dd></div>
          )}
        </dl>}
      </Card>

      <Card className="scraper-panel error-panel">
        <CardHeader eyebrow="Needs attention" title="Recent queue issues"
          description="No credentials or raw pages are shown here."
          action={<AlertTriangle size={19} aria-hidden="true" />} />
        <Separator />
        {(counts.blocked || 0) > 0 && <DSButton variant="outline" className="retry-blocked" disabled={busy || status?.running}
          onClick={() => {
            if (!window.confirm(`Retry ${counts.blocked} blocked queue item(s)? Use this only after preparing a working browser session or otherwise resolving the block.`)) return;
            void act(
              () => post('/api/scraper/retry-blocked'),
              `${counts.blocked} blocked queue item(s) returned to pending.`
            );
          }}>
          <RefreshCw size={17} /> Retry blocked items
        </DSButton>}
        {status?.recent_errors.length ? <div className="error-list">{status.recent_errors.map((item, index) =>
          <div key={`${item.url}-${index}`}><span>{item.status}</span><strong>{item.type}</strong><code>{item.last_error}</code><small>{item.updated_at}</small></div>
        )}</div> : <p className="empty">No recorded queue errors.</p>}
      </Card>
    </main>
  );
}

function Metric({ label, value, accent, warn }: { label: string; value: number; accent?: boolean; warn?: boolean }) {
  return <Card className={`metric ${accent ? 'accent' : ''} ${warn ? 'warn' : ''}`}><strong>{value.toLocaleString()}</strong><span>{label}</span></Card>;
}
