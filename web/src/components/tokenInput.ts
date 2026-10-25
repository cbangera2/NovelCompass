/** Pure parsing and matching helpers behind TagCombobox (genre and tag pickers). */

/** Case/whitespace-insensitive comparison key. */
export const tokenKey = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();

const clean = (value: string) => value.trim().replace(/\s+/g, ' ');

/** Split typed or pasted text on commas and line breaks. Empty pieces are dropped. */
export function parseTokens(text: string): string[] {
  return text.split(/[,\n\r\t]+/).map(clean).filter(Boolean);
}

/** Comma-separated URL/API strings to a de-duplicated list (first spelling wins). */
export function parseList(value: string | undefined | null): string[] {
  return dedupe(parseTokens(value || ''));
}

/** The comma-separated form the data layer and URLs use. */
export const formatList = (values: string[]) => values.join(',');

export function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = tokenKey(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Map of lower-cased option to its canonical spelling. */
export function optionLookup(options: string[]): Map<string, string> {
  const lookup = new Map<string, string>();
  options.forEach((option) => {
    const key = tokenKey(option);
    if (key && !lookup.has(key)) lookup.set(key, option);
  });
  return lookup;
}

export interface AddResult {
  values: string[];
  /** Tokens that were new and kept. */
  added: string[];
  /** Tokens dropped because they are not in the option list (only when custom values are not allowed). */
  rejected: string[];
}

/**
 * Add tokens to a list: case-insensitive de-duplication, canonical option spelling,
 * and optional rejection of values that are not in the option list.
 */
export function addTokens(
  current: string[],
  incoming: string[],
  options: { lookup?: Map<string, string>; allowCustom: boolean },
): AddResult {
  const seen = new Set(current.map(tokenKey));
  const values = [...current];
  const added: string[] = [];
  const rejected: string[] = [];
  incoming.map(clean).filter(Boolean).forEach((token) => {
    const key = tokenKey(token);
    const known = options.lookup?.get(key);
    if (!known && !options.allowCustom) {
      rejected.push(token);
      return;
    }
    if (seen.has(key)) return;
    seen.add(key);
    const value = known || token;
    values.push(value);
    added.push(value);
  });
  return { values, added, rejected };
}

export function removeToken(current: string[], token: string): string[] {
  const key = tokenKey(token);
  return current.filter((value) => tokenKey(value) !== key);
}

/** Lower is better; -1 means no match. Exact, then prefix, then word prefix, then substring. */
export function matchRank(option: string, query: string): number {
  const text = tokenKey(option);
  const needle = tokenKey(query);
  if (!needle) return 0;
  if (text === needle) return 0;
  if (text.startsWith(needle)) return 1;
  if (text.split(/[\s\-/(),:'"]+/).some((word) => word.startsWith(needle))) return 2;
  return text.includes(needle) ? 3 : -1;
}

/** Suggestions for a query, excluding already selected values. Ties keep the option order. */
export function rankMatches(options: string[], query: string, selected: string[], limit = 50): string[] {
  const taken = new Set(selected.map(tokenKey));
  const scored: Array<{ option: string; rank: number; index: number }> = [];
  options.forEach((option, index) => {
    if (taken.has(tokenKey(option))) return;
    const rank = matchRank(option, query);
    if (rank >= 0) scored.push({ option, rank, index });
  });
  scored.sort((a, b) => a.rank - b.rank || a.index - b.index);
  return scored.slice(0, limit).map((entry) => entry.option);
}

/** Split a label around the first case-insensitive occurrence of the query, for highlighting. */
export function splitMatch(label: string, query: string): [string, string, string] {
  const needle = query.trim();
  if (!needle) return [label, '', ''];
  const at = label.toLowerCase().indexOf(needle.toLowerCase());
  if (at < 0) return [label, '', ''];
  return [label.slice(0, at), label.slice(at, at + needle.length), label.slice(at + needle.length)];
}
