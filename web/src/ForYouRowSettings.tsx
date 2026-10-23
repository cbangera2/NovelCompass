import { useEffect, useMemo, useState } from 'react';
import { LayoutList, Plus, RotateCcw, X } from 'lucide-react';
import { Card, CardHeader } from './design-system';
import { createDataSource } from './data';
import { GENRE_ROWS, MIN_GENRE_ROW_TITLES } from './forYouGenres';
import { customRowTitle, useForYouRowPrefs, type CustomRowKind } from './forYouRowPrefs';
import type { MediaTypeChoice } from './mediaFilterState';
import { Select } from './ui';
import './for-you-settings.css';

const FORMATS: Array<{ type: MediaTypeChoice; label: string }> = [
  { type: 'novel', label: 'Light novels' },
  { type: 'manga', label: 'Manga' },
  { type: 'anime', label: 'Anime' },
];

const FORMAT_SHORT: Record<MediaTypeChoice, string> = { novel: 'Novels', manga: 'Manga', anime: 'Anime' };

/**
 * Whether `name` is a genre or a tag depends on the format (Tragedy is a genre for novels and a tag for
 * anime), so probe both and keep whichever has titles. Returns null when neither has enough for a row.
 */
async function resolveRowField(type: MediaTypeChoice, name: string): Promise<{ field: 'genre' | 'tag'; name: string; total: number } | { error: string }> {
  const source = await createDataSource();
  const options = await source.getOptions().catch(() => null);
  const lower = name.toLowerCase();
  const canonical =
    options?.genres.find((g) => g.toLowerCase() === lower) ?? options?.tags?.find((t) => t.toLowerCase() === lower) ?? name;
  const probe = (field: 'genre' | 'tag') => source
    .browseNovels({ media_type: type, [field]: canonical, exclude_genres: 'Hentai,Smut', page: 1, page_size: 1 })
    .then((response) => response.total)
    .catch(() => 0);
  const [genreTotal, tagTotal] = await Promise.all([probe('genre'), probe('tag')]);
  const field = genreTotal >= tagTotal ? 'genre' : 'tag';
  const total = Math.max(genreTotal, tagTotal);
  if (total < MIN_GENRE_ROW_TITLES) {
    const label = FORMATS.find((f) => f.type === type)!.label.toLowerCase();
    return { error: total ? `Only ${total} ${label} match "${canonical}" — too few for a row.` : `No ${label} match "${canonical}". Pick one from the suggestions.` };
  }
  return { field, name: canonical, total };
}

function RowToggle({ label, note, shown, onToggle }: { label: string; note?: string; shown: boolean; onToggle: (shown: boolean) => void }) {
  return (
    <button type="button" className={`fy-set-chip${shown ? ' on' : ''}`} aria-pressed={shown} onClick={() => onToggle(!shown)}>
      <span>{label}</span>{note && <small>{note}</small>}
    </button>
  );
}

export default function ForYouRowSettings(): JSX.Element {
  const { prefs, setHidden, addCustom, removeCustom, reset } = useForYouRowPrefs();
  const [type, setType] = useState<MediaTypeChoice>('anime');
  const [kind, setKind] = useState<CustomRowKind>('rating');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const shown = (key: string) => !prefs.hidden.includes(key);

  useEffect(() => {
    let cancelled = false;
    createDataSource()
      .then((source) => source.getOptions())
      .then((options) => { if (!cancelled) setSuggestions([...new Set([...options.genres, ...(options.tags ?? [])])].sort((a, b) => a.localeCompare(b))); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const customCount = prefs.custom.length;
  const hiddenCount = prefs.hidden.length;
  const datalistId = useMemo(() => `fy-row-options-${Math.random().toString(36).slice(2, 7)}`, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const text = name.trim();
    if (!text) { setError('Type a genre or tag, like Sports or Yandere.'); return; }
    setBusy(true);
    setError('');
    const result = await resolveRowField(type, text);
    setBusy(false);
    if ('error' in result) { setError(result.error); return; }
    addCustom({ type, kind, field: result.field, name: result.name });
    setName('');
  };

  return (
    <Card className="settings-card" id="for-you-rows">
      <CardHeader
        title="For You rows"
        description="Choose which rows show up on For You, and add your own: any genre or tag, for light novels, manga or anime, ranked by rating or popularity."
        action={<LayoutList size={19} />}
      />

      <h3 className="fy-set-heading">Your rows</h3>
      {customCount > 0 ? (
        <ul className="fy-set-custom">
          {prefs.custom.map((row) => (
            <li key={row.id}>
              <span>{customRowTitle(row)}</span>
              <button type="button" aria-label={`Remove ${customRowTitle(row)}`} onClick={() => removeCustom(row.id)}><X size={14} /></button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="settings-hint">None yet. Add one below, for example "Most popular anime: Sports".</p>
      )}
      <form className="fy-set-form" onSubmit={submit}>
        <Select label="Format" value={type} onChange={(event) => setType(event.target.value as MediaTypeChoice)}>
          {FORMATS.map((f) => <option key={f.type} value={f.type}>{f.label}</option>)}
        </Select>
        <Select label="Ranked by" value={kind} onChange={(event) => setKind(event.target.value as CustomRowKind)}>
          <option value="rating">Top rated</option>
          <option value="popular">Most popular</option>
        </Select>
        <label className="fy-set-field">
          <span>Genre or tag</span>
          <input
            type="text"
            list={datalistId}
            value={name}
            placeholder="Sports, Yandere, Isekai…"
            onChange={(event) => { setName(event.target.value); setError(''); }}
          />
          <datalist id={datalistId}>{suggestions.map((option) => <option key={option} value={option} />)}</datalist>
        </label>
        <button type="submit" className="fy-set-add" disabled={busy}><Plus size={15} />{busy ? 'Checking…' : 'Add row'}</button>
      </form>
      {error && <p className="fy-set-error" role="alert">{error}</p>}

      <h3 className="fy-set-heading">Built-in rows</h3>
      <p className="settings-hint">Tap a row to hide it. You can also hide a row from its header on For You.</p>
      <div className="fy-set-group">
        <strong>Top picks</strong>
        <div className="fy-set-chips"><RowToggle label="Top picks for you" shown={shown('blend')} onToggle={(on) => setHidden('blend', !on)} /></div>
      </div>
      <div className="fy-set-group">
        <strong>Top rated</strong>
        <div className="fy-set-chips">
          {FORMATS.map((f) => <RowToggle key={f.type} label={f.label} shown={shown(`top-${f.type}`)} onToggle={(on) => setHidden(`top-${f.type}`, !on)} />)}
        </div>
      </div>
      <div className="fy-set-group">
        <strong>Most popular</strong>
        <div className="fy-set-chips">
          {FORMATS.map((f) => <RowToggle key={f.type} label={f.label} shown={shown(`popular-${f.type}`)} onToggle={(on) => setHidden(`popular-${f.type}`, !on)} />)}
        </div>
      </div>
      <div className="fy-set-group">
        <strong>Anime &amp; manga genres</strong>
        <div className="fy-set-chips">
          {GENRE_ROWS.map((row) => (
            <RowToggle
              key={row.key}
              label={row.label}
              note={row.formats.map((f) => FORMAT_SHORT[f]).join(' · ')}
              shown={shown(`genre-${row.key}`)}
              onToggle={(on) => setHidden(`genre-${row.key}`, !on)}
            />
          ))}
        </div>
      </div>

      <button type="button" className="settings-reset-button" disabled={!customCount && !hiddenCount} onClick={reset}>
        <RotateCcw size={15} />Reset rows to default
      </button>
    </Card>
  );
}
