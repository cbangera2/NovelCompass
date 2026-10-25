import { SlidersHorizontal } from 'lucide-react';
import type { ReactNode } from 'react';
import { NUMERIC_FILTERS, listPatch, type AdvancedFilterValues } from './advancedFilterModel';
import { TagCombobox } from './TagCombobox';
import './advanced-filters.css';

interface AdvancedFiltersProps {
  values: AdvancedFilterValues;
  onChange: (patch: Partial<AdvancedFilterValues>) => void;
  genres: string[];
  tags: string[];
  /** Page-specific sections (Browse's status and library, Discover's ranking recipe), rendered last. */
  children?: ReactNode;
  /** Names the page's own sections in the summary line ("plus ..."). */
  summaryExtra?: string;
}

/**
 * The advanced filter panel shared by Discover and Browse: genres, tags and catalog limits.
 * Numeric limits render only for the keys a page supplies in `values`.
 */
export function AdvancedFilters({ values, onChange, genres, tags, children, summaryExtra }: AdvancedFiltersProps) {
  const numeric = NUMERIC_FILTERS.filter((field) => values[field.key] !== undefined);
  // Genres are a closed list; fall back to free text only when the list could not be loaded.
  const genresClosed = genres.length > 0;
  return (
    <details className="advanced-panel advanced-filters">
      <summary>
        <span>
          <strong><SlidersHorizontal size={16} aria-hidden="true" /> Advanced filters</strong>
          <small>Genres, tags, and catalog limits{summaryExtra ? ` · plus ${summaryExtra}` : ''}</small>
        </span>
        <span className="summary-action">Customize</span>
      </summary>
      <div className="advanced-content">
        <section className="advanced-section">
          <div className="section-heading"><div><h3>Genres</h3><p>Type to search. Required genres must all match; excluded genres must not.</p></div></div>
          <div className="advanced-pair">
            <TagCombobox label="Include genres" noun="genre" tone="include" values={values.includeGenres} options={genres}
              allowCustom={!genresClosed} placeholder="Fantasy, Adventure" onChange={(next) => onChange(listPatch(values, 'includeGenres', next))} />
            <TagCombobox label="Exclude genres" noun="genre" tone="exclude" values={values.excludeGenres} options={genres}
              allowCustom={!genresClosed} placeholder="Harem" onChange={(next) => onChange(listPatch(values, 'excludeGenres', next))} />
          </div>
        </section>
        <section className="advanced-section">
          <div className="section-heading"><div><h3>Tags</h3><p>Type to search Novel Updates tags, or enter your own and press Enter. Paste a comma-separated list to add several.</p></div></div>
          <div className="advanced-pair">
            <TagCombobox label="Include tags" noun="tag" tone="include" values={values.includeTags} options={tags}
              placeholder="Time Loop, Cunning Protagonist" onChange={(next) => onChange(listPatch(values, 'includeTags', next))} />
            <TagCombobox label="Exclude tags" noun="tag" tone="exclude" values={values.excludeTags} options={tags}
              placeholder="Netorare" onChange={(next) => onChange(listPatch(values, 'excludeTags', next))} />
          </div>
        </section>
        {numeric.length > 0 && (
          <section className="advanced-section">
            <div className="section-heading"><div><h3>Catalog limits</h3><p>Leave a field empty for no limit.</p></div></div>
            <div className="advanced-numbers">
              {numeric.map((field) => (
                <label key={field.key}>
                  {field.label}
                  <input
                    type="number"
                    min="0"
                    max={'max' in field ? field.max : undefined}
                    step={'step' in field ? field.step : 1}
                    value={values[field.key] || ''}
                    placeholder="Any"
                    onChange={(event) => onChange({ [field.key]: Math.max(0, Number(event.target.value) || 0) })}
                  />
                </label>
              ))}
            </div>
          </section>
        )}
        {children}
      </div>
    </details>
  );
}
