/**
 * Turns Novel Updates list titles ("Peak Yanderes", "Best romance(not really, most are mid or below lmao)")
 * into shelf names that read like a streaming service: short, no editorializing, no author asides.
 */
/** Hand-picked shelf names where the generic cleanup leaves something odd (numbered series, in-jokes). */
export const LIST_NAME_OVERRIDES: Record<number, string> = {
  88138: 'Hidden Gems',
  108897: 'Epic Hidden Gems',
  143115: 'Must-Read Hidden Gems',
};

export function cleanListTitle(raw: string, id?: number): string {
  if (id != null && LIST_NAME_OVERRIDES[id]) return LIST_NAME_OVERRIDES[id];
  let t = raw.replace(/\([^)]*\)?/g, ' ');            // parenthetical asides, including unclosed ones
  t = t.split('/')[0];                                   // "A/ B/ C" alternates: keep the first
  t = t.replace(/^\s*(my|the)\s+(list\s+of\s+)?/i, (m) => (/list\s+of/i.test(m) ? '' : m));
  t = t.replace(/^\s*peak\s+/i, '');
  t = t.replace(/\b(tbr|forever)\b/gi, ' ').replace(/[_*]+/g, ' ');
  t = t.replace(/\s+/g, ' ').trim().replace(/[-:,.\s]+$/, '');
  if (!t) return raw.trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}
