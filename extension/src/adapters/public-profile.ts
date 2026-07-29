import type {
  LivePublicProfilePage,
  ParseWarning,
  PublicProfileList,
  PublicProfileStat,
} from './contracts';

const TRUSTED_ORIGIN = 'https://www.novelupdates.com';
const LIST_PATH = /^\/viewlist\/\d+\/?$/;
const PROFILE_PATH = /^\/user(?:\/\d+)?(?:\/[^/]+)?\/?$/;

export interface PublicProfileParseResult {
  ok: boolean;
  page: LivePublicProfilePage;
  message?: string;
}

/** Converts the public profile DOM to inert text and same-origin HTTPS links. */
export function parsePublicProfilePage(
  document: Document,
  currentUrl: string,
): PublicProfileParseResult {
  const current = trustedUrl(currentUrl, currentUrl);
  const warnings: ParseWarning[] = [];
  const name =
    cleanText(
      document.querySelector(
        '[data-profile-name], .p_m_username, .profile-name, .user-name, .user-profile h1, h1',
      )?.textContent,
    ) || profileNameFromPath(current?.pathname);
  const avatarUrl = trustedAssetUrl(
    document
      .querySelector<HTMLImageElement>(
        '[data-profile-avatar] img[src], img[data-profile-avatar][src], .p_avatar img[src], .profile-avatar img[src], .user-avatar img[src], .avatar[src]',
      )
      ?.getAttribute('src'),
    currentUrl,
  );
  const summaryRoot =
    document.querySelector<HTMLElement>(
      '[data-profile-summary], .profile-summary, .user-profile, #user-profile, main',
    ) ?? document.body;
  const summaryText = cleanText(summaryRoot?.textContent);
  const pairedStats = parsePairedStats(document);
  const rank =
    cleanText(document.querySelector('[data-profile-rank], .userrate.urank, .profile-rank, .user-rank')?.textContent) ||
    capture(summaryText, /\b(?:Rank|Role)\s*:?\s*([^|•\n]+?)(?=\s{2,}|Joined|Lists|$)/i);
  const joinedAt =
    cleanText(
      document.querySelector('[data-profile-joined], .profile-joined, time[datetime]')?.textContent,
    ) ||
    pairedStats.find((stat) => /^joined$/i.test(stat.label))?.value ||
    capture(summaryText, /\bJoined\s*:?\s*([^|•\n]+?)(?=\s{2,}|Rank|Lists|$)/i);
  const bio = cleanText(
    document.querySelector(
      '[data-profile-bio], .profile-bio, .user-description, .profile-description',
    )?.textContent,
  );
  const stats = parseStats(document, summaryText);
  const lists = parseLists(document, currentUrl);
  const navigation = parseNavigation(document, currentUrl);
  const toolLinks = parseToolLinks(document, currentUrl);

  if (!name) {
    warnings.push({
      code: 'unsupported-markup',
      field: 'name',
      message: 'No public profile identity was found.',
    });
  }
  return {
    ok: Boolean(current && PROFILE_PATH.test(current.pathname) && name),
    page: {
      name,
      ...(avatarUrl ? { avatarUrl } : {}),
      ...(rank ? { rank } : {}),
      ...(joinedAt ? { joinedAt } : {}),
      ...(bio ? { bio } : {}),
      stats,
      lists,
      navigation,
      toolLinks,
      warnings,
    },
    ...(!current
      ? { message: 'The profile URL is not a trusted Novel Updates URL.' }
      : !name
        ? { message: 'Novel Updates public profile markup is not supported.' }
        : {}),
  };
}

function parseStats(document: Document, summaryText: string): PublicProfileStat[] {
  const explicit = Array.from(
    document.querySelectorAll<HTMLElement>(
      '[data-profile-stat], .p_pairstats .row_pairs, .profile-stat, .user-stat',
    ),
  ).flatMap((element) => {
    const label =
      cleanText(element.dataset.label) ||
      cleanText(element.querySelector('dt, .label, strong')?.textContent);
    const value =
      cleanText(element.dataset.value) ||
      cleanText(element.querySelector('dd, .value, span')?.textContent) ||
      cleanText(element.textContent).replace(label, '').trim();
    return label && value ? [{ label, value }] : [];
  });
  if (explicit.length) {
    return dedupeStats(explicit).filter((stat) => !/^joined$/i.test(stat.label));
  }

  const patterns = [
    ['Lists', /\b(\d[\d,]*)\s+(?:Created\s+)?Lists?\b/i],
    ['Comments', /\b(\d[\d,]*)\s+Comments?\b/i],
    ['Reviews', /\b(\d[\d,]*)\s+Reviews?\b/i],
    ['Reading List', /\b(\d[\d,]*)\s+(?:Novels?\s+)?(?:in\s+)?Reading List\b/i],
  ] as const;
  return patterns.flatMap(([label, pattern]) => {
    const value = summaryText.match(pattern)?.[1];
    return value ? [{ label, value }] : [];
  });
}

function parsePairedStats(document: Document): PublicProfileStat[] {
  return Array.from(document.querySelectorAll<HTMLElement>('.p_pairstats .row_pairs')).flatMap(
    (element) => {
      const label = cleanText(element.querySelector('dt')?.textContent);
      const value = cleanText(element.querySelector('dd')?.textContent);
      return label && value ? [{ label, value }] : [];
    },
  );
}

function parseLists(document: Document, currentUrl: string): PublicProfileList[] {
  const seen = new Set<string>();
  return Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]')).flatMap((anchor) => {
    const url = trustedUrl(anchor.getAttribute('href'), currentUrl);
    const title = cleanText(anchor.textContent);
    if (!url || !LIST_PATH.test(url.pathname) || !title || seen.has(url.href)) return [];
    seen.add(url.href);
    const row =
      anchor.closest<HTMLElement>(
        '[data-profile-list], .lid_box_sub, .lbx, .profile-list, .recommendation-list, .list-item, article, li, tr',
      ) ?? anchor.parentElement;
    const text = cleanText(row?.textContent);
    const description = cleanText(
      row?.querySelector('[data-list-description], .b_lid, .list-description, .listdesc, p')?.textContent,
    );
    return [{
      title,
      url: url.href,
      ...(description && description !== title ? { description } : {}),
      ...numericField(text, 'seriesCount', /(\d[\d,]*)\s+Series\b/i),
      ...numericField(text, 'commentCount', /(\d[\d,]*)\s+Comments?\b/i),
      ...numericField(text, 'viewCount', /(\d[\d,]*)\s+Views?\b/i),
      ...numericField(text, 'followCount', /(\d[\d,]*)\s+Follows?\b/i),
      tags: parseListTags(row, currentUrl),
    }];
  });
}

function parseNavigation(document: Document, currentUrl: string) {
  return parseLinks(
    document.querySelector('[data-profile-tabs], .profile-tabs, .user-tabs, .nav-tabs'),
    currentUrl,
    PROFILE_PATH,
  );
}

function parseToolLinks(document: Document, currentUrl: string) {
  return parseLinks(
    document.querySelector(
      '[data-profile-tools], .p_btn_list.profile, .profile-tools, .user-tools',
    ),
    currentUrl,
    /^\/(?:userlist|reading-list|account|your-profile|recommendation-lists|add-release|add-group|add-series|report-problem|nu-edit-logs)(?:\/|$)/,
  );
}

function parseListTags(root: ParentNode | null | undefined, currentUrl: string) {
  if (!root) return [];
  const linked = parseLinks(root, currentUrl, /^\/(?:listtag|genre|stag)\/[^/]+\/?$/);
  const seen = new Set(linked.map((tag) => tag.label.toLowerCase()));
  const plain = Array.from(
    root.querySelectorAll<HTMLElement>('.gennew.search.listtags span, [data-list-tags] span'),
  ).flatMap((element) => {
    const label = cleanText(element.textContent);
    if (!label || seen.has(label.toLowerCase())) return [];
    seen.add(label.toLowerCase());
    return [{ label }];
  });
  return [...linked, ...plain];
}

function parseLinks(root: ParentNode | null | undefined, currentUrl: string, pattern: RegExp) {
  if (!root) return [];
  const seen = new Set<string>();
  return Array.from(root.querySelectorAll<HTMLAnchorElement>('a[href]')).flatMap((anchor) => {
    const url = trustedUrl(anchor.getAttribute('href'), currentUrl);
    const label = cleanText(anchor.textContent);
    if (!url || !pattern.test(url.pathname) || !label || seen.has(url.href)) return [];
    seen.add(url.href);
    return [{ label, url: url.href }];
  });
}

function numericField(
  text: string,
  field: 'seriesCount' | 'commentCount' | 'viewCount' | 'followCount',
  pattern: RegExp,
) {
  const match = text.match(pattern)?.[1];
  return match ? { [field]: Number.parseInt(match.replace(/,/g, ''), 10) } : {};
}

function trustedUrl(value: string | null | undefined, base: string): URL | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value, base);
    return url.protocol === 'https:' && url.origin === TRUSTED_ORIGIN ? url : undefined;
  } catch {
    return undefined;
  }
}

function trustedAssetUrl(value: string | null | undefined, base: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value, base);
    return url.protocol === 'https:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function profileNameFromPath(pathname = ''): string {
  const segments = pathname.split('/').filter(Boolean);
  const segment = segments[segments.length - 1];
  return segment && segment !== 'user' && !/^\d+$/.test(segment)
    ? decodeURIComponent(segment).replace(/-/g, ' ')
    : '';
}

function capture(text: string, pattern: RegExp): string {
  return cleanText(text.match(pattern)?.[1]);
}

function dedupeStats(stats: PublicProfileStat[]): PublicProfileStat[] {
  const seen = new Set<string>();
  return stats.filter((stat) => {
    const key = stat.label.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function cleanText(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}
