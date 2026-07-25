import { CuratedListSummary, ParsedProfileFile, ProfileEntry, ReadingStatus } from './types';

export const PROFILE_PARSER_VERSION = 1;
export const MAX_PROFILE_FILE_BYTES = 15 * 1024 * 1024;

const SERIES_URL = /^https:\/\/www\.novelupdates\.com\/series\/([a-z0-9-]+)\/?(?:[?#].*)?$/i;
const VIEWLIST_URL = /^https:\/\/www\.novelupdates\.com\/viewlist\/(\d+)\/?(?:[?#].*)?$/i;

function clean(value?: string | null): string {
  return (value || '').replace(/\s+/g, ' ').trim();
}

function detectStatus(doc: Document): ReadingStatus {
  const label = clean(doc.querySelector('#profile_content3 .am_mn.linkactive')?.textContent).toLowerCase();
  if (label.includes('plan')) return 'plan_to_read';
  if (label.includes('completed')) return 'completed';
  return 'reading';
}

function profileUsername(doc: Document): string | undefined {
  const canonical = doc.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href || '';
  const match = canonical.match(/novelupdates\.com\/user\/\d+\/([^/]+)\//i);
  if (match) return decodeURIComponent(match[1]);
  const ownProfile = [...doc.querySelectorAll<HTMLAnchorElement>('a[href*="/user/"]')]
    .map((anchor) => anchor.href.match(/novelupdates\.com\/user\/\d+\/([^/]+)\//i))
    .find(Boolean);
  return ownProfile?.[1] ? decodeURIComponent(ownProfile[1]) : undefined;
}

function parseLists(doc: Document): CuratedListSummary[] {
  const seen = new Set<number>();
  const lists: CuratedListSummary[] = [];
  for (const anchor of doc.querySelectorAll<HTMLAnchorElement>('a[href*="/viewlist/"]')) {
    const match = anchor.href.match(VIEWLIST_URL);
    if (!match) continue;
    const id = Number(match[1]);
    if (seen.has(id)) continue;
    const card = anchor.closest('.nup-secondary-list-card, .lbx');
    if (!card) continue;
    seen.add(id);
    const stats = clean(card.querySelector('.search_stats')?.textContent);
    const text = clean(card.textContent);
    const descriptionNode = card.querySelector('.nup-secondary-list-card-body > div:last-child, .b_lid > div:last-child');
    lists.push({
      id,
      title: clean(anchor.textContent),
      description: clean(descriptionNode?.textContent) || undefined,
      series_count: Number(stats.match(/(\d[\d,]*)\s+(?:Series|Novels?)/i)?.[1]?.replace(/,/g, '')) || undefined,
      followers: Number(stats.match(/(\d[\d,]*)\s+Followers?/i)?.[1]?.replace(/,/g, '')) || undefined,
      is_private: /\bPrivate\b/i.test(text),
      membership_available: false
    });
  }
  return lists;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function parseProfileFile(file: File): Promise<ParsedProfileFile> {
  if (file.size > MAX_PROFILE_FILE_BYTES) throw new Error(`${file.name} is larger than 15 MB.`);
  const html = await file.text();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const root = doc.querySelector('#profile_content3 .p_load_rl');
  if (!root) throw new Error(`${file.name} is not a saved Novel Updates profile reading-list page.`);
  const detected = detectStatus(doc);
  const entries: ProfileEntry[] = [];
  const duplicateSlugs: string[] = [];
  const seen = new Set<string>();
  let malformed = 0;
  const rows = [...root.querySelectorAll<HTMLTableRowElement>('table tr')];
  for (const row of rows) {
    const cells = row.querySelectorAll<HTMLTableCellElement>('td');
    if (!cells.length) continue;
    const anchor = cells[1]?.querySelector<HTMLAnchorElement>('a[href]');
    const match = anchor?.href.match(SERIES_URL);
    if (!anchor || !match) {
      malformed += 1;
      continue;
    }
    const slug = match[1].toLowerCase();
    if (seen.has(slug)) {
      duplicateSlugs.push(slug);
      continue;
    }
    seen.add(slug);
    const ratingText = clean(cells[3]?.textContent);
    const rating = /^\d(?:\.\d+)?$/.test(ratingText) ? Number(ratingText) : undefined;
    const progress = clean(cells[2]?.textContent).replace(/^\[\s*|\s*\]$/g, '') || undefined;
    entries.push({
      slug,
      imported_title: clean(anchor.getAttribute('title')) || clean(anchor.textContent),
      status: detected,
      rating,
      progress,
      source_file: file.name
    });
  }
  if (!rows.length || !entries.length) {
    throw new Error(`${file.name} has no supported reading-list rows. Open a category, wait for it to load, then save the page.`);
  }
  return {
    filename: file.name,
    fingerprint: await sha256(html),
    detected_status: detected,
    selected_status: detected,
    username: profileUsername(doc),
    entries,
    curated_lists: parseLists(doc),
    malformed_rows: malformed,
    duplicate_slugs: duplicateSlugs,
    warnings: malformed ? [`${malformed} malformed row${malformed === 1 ? '' : 's'} skipped.`] : []
  };
}

export function withStatus(file: ParsedProfileFile, status: ReadingStatus): ParsedProfileFile {
  return { ...file, selected_status: status, entries: file.entries.map((entry) => ({ ...entry, status })) };
}
