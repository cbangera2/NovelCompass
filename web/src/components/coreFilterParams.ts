/** Filter options and URL params shared by Discover ("Refine matches") and Browse. */

export const CORE_LANGUAGE_FALLBACK = ['Korean', 'Chinese', 'Japanese'];
export const CORE_RATING_STEPS = [3, 3.5, 4, 4.3, 4.5];

export interface CoreFilterValues { language: string; minRating: number }

const titleCase = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

/** Case-insensitive de-duplicated language options (the catalog has both "korean" and "Korean"). */
export function languageOptions(available: string[] | undefined, current: string): Array<{ value: string; label: string }> {
  const byKey = new Map<string, { value: string; label: string }>();
  const add = (value: string) => {
    const key = value.trim().toLowerCase();
    if (!key) return;
    const existing = byKey.get(key);
    // Prefer the capitalised spelling as the canonical value.
    if (!existing || (existing.value === existing.value.toLowerCase() && value !== value.toLowerCase())) {
      byKey.set(key, { value, label: titleCase(key) });
    }
  };
  (available?.length ? available : CORE_LANGUAGE_FALLBACK).forEach(add);
  if (current) add(current);
  return [...byKey.values()].sort((a, b) => a.label.localeCompare(b.label));
}

/** Resolve a stored language (any casing) to the spelling the option list uses. */
export function canonicalLanguage(current: string, options: Array<{ value: string }>): string {
  return options.find((o) => o.value.toLowerCase() === current.toLowerCase())?.value ?? current;
}

export const formatMinRating = (value: number) => `${value.toFixed(1)}★+`;

/** Reads the shared params, accepting Discover's legacy `lang` / `r` aliases. */
export function readCoreFilterParams(params: URLSearchParams, fallback: CoreFilterValues): CoreFilterValues {
  const language = params.has('language') ? params.get('language') : params.get('lang');
  const rawRating = params.has('min_rating') ? params.get('min_rating') : params.get('r');
  const rating = rawRating === null ? NaN : Number(rawRating);
  return {
    language: language === null ? fallback.language : language,
    minRating: Number.isFinite(rating) ? Math.min(5, Math.max(0, rating)) : fallback.minRating,
  };
}

export function writeCoreFilterParams(params: URLSearchParams, values: CoreFilterValues): void {
  if (values.language) params.set('language', values.language);
  if (values.minRating) params.set('min_rating', String(values.minRating));
}
