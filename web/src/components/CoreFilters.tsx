import { X } from 'lucide-react';
import { useMemo } from 'react';
import { Button, Select } from '../ui';
import { CORE_RATING_STEPS, canonicalLanguage, formatMinRating, languageOptions } from './coreFilterParams';
import './core-filters.css';

interface CoreFiltersProps {
  language: string;
  minRating: number;
  /** Languages present in the loaded catalog; falls back to the common three. */
  languages?: string[];
  onLanguageChange: (value: string) => void;
  onMinRatingChange: (value: number) => void;
  /** Extra controls (Discover's Results, Browse's Sort) rendered in the same row. */
  children?: React.ReactNode;
  /** Use platform <select> elements (Browse's "native controls" mode). */
  native?: boolean;
}

/** Language + minimum rating, identical in Discover and Browse. */
export function CoreFilters({ language, minRating, languages, onLanguageChange, onMinRatingChange, children, native }: CoreFiltersProps) {
  const langOptions = useMemo(() => languageOptions(languages, language), [languages, language]);
  const ratings = useMemo(
    () => [...new Set([...CORE_RATING_STEPS, ...(minRating ? [minRating] : [])])].sort((a, b) => a - b),
    [minRating],
  );
  const languageControl = (
    <>
      <option value="">Any</option>
      {langOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </>
  );
  const ratingControl = (
    <>
      <option value="0">Any</option>
      {ratings.map((r) => <option key={r} value={String(r)}>{formatMinRating(r)}</option>)}
    </>
  );
  const languageValue = canonicalLanguage(language, langOptions);
  return (
    <div className="core-filters">
      {native ? (
        <>
          <label className="browse-native-select"><span>Language</span>
            <select value={languageValue} onChange={(e) => onLanguageChange(e.target.value)}>{languageControl}</select></label>
          <label className="browse-native-select"><span>Rating</span>
            <select value={String(minRating)} onChange={(e) => onMinRatingChange(Number(e.target.value))}>{ratingControl}</select></label>
        </>
      ) : (
        <>
          <Select label="Language" value={languageValue} onChange={(e) => onLanguageChange(e.currentTarget.value)}>{languageControl}</Select>
          <Select label="Rating" value={String(minRating)} onChange={(e) => onMinRatingChange(Number(e.currentTarget.value))}>{ratingControl}</Select>
        </>
      )}
      {children}
    </div>
  );
}

export interface ActiveFilter { label: string; clear: () => void }

/** Removable chips for active filters, shared by Discover and Browse. */
export function ActiveFilterChips({ filters, onClearAll, className = '' }: {
  filters: ActiveFilter[];
  onClearAll: () => void;
  className?: string;
}) {
  if (!filters.length) return null;
  return (
    <div className={`active-filter-chips ${className}`.trim()} aria-label="Active filters">
      {filters.map((filter) => (
        <Button variant="ghost" key={filter.label} onClick={filter.clear} aria-label={`Remove filter: ${filter.label}`}>
          {filter.label}<X size={12} aria-hidden="true" />
        </Button>
      ))}
      <Button variant="ghost" className="clear-all" onClick={onClearAll}>Clear all</Button>
    </div>
  );
}
