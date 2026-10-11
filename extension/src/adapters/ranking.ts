import type {
  LiveRankingPage,
  LiveRankingRow,
  ParseWarning,
  RankingFilterOption,
} from './contracts';

const TRUSTED_ORIGIN = 'https://www.novelupdates.com';
const SERIES_PATH = /^\/series\/[a-z0-9]+(?:-[a-z0-9]+)*\/?$/;

export interface RankingParseResult {
  ok: boolean;
  page: LiveRankingPage;
  message?: string;
}

/**
 * Normalizes the server-rendered ranking page without copying host HTML or
 * event handlers into the extension. Selectors intentionally include both
 * Novel Updates' current classes and semantic fallbacks for fixtures/markup
 * drift.
 */
export function parseRankingPage(document: Document, currentUrl: string): RankingParseResult {
  const warnings: ParseWarning[] = [];
  const url = trustedUrl(currentUrl, currentUrl);
  const rows = parseRows(document, currentUrl);
  const filters = {
    rankingTypes: parseRankingTypes(document, currentUrl),
    languages: parseCheckboxOptions(document, [
      'input[name="rl"]',
      'input[name="rl[]"]',
      '[data-ranking-language] input',
    ]),
    storyStatuses: parseControlOptions(document, [
      'select[name="status"]',
      'select[name="ss"]',
      '[data-ranking-status]',
    ]),
    genres: parseGenres(document),
    ...parseMinimumChapters(document),
  };
  const pagination = parsePagination(document, currentUrl);
  const title =
    cleanText(document.querySelector('h1, [data-ranking-heading]')?.textContent) ||
    'Series Ranking';

  if (!rows.length) {
    warnings.push({
      code: 'unsupported-markup',
      field: 'rows',
      message: 'No ranking rows were found in the loaded page.',
    });
  }

  return {
    ok: Boolean(url && rows.length),
    page: {
      title,
      activeRankingLabel:
        filters.rankingTypes.find((option) => option.selected)?.label ??
        cleanText(document.querySelector('[data-active-ranking]')?.textContent) ??
        undefined,
      filters,
      rows,
      warnings,
      ...pagination,
    },
    ...(!url
      ? { message: 'The ranking page URL is not a trusted Novel Updates URL.' }
      : !rows.length
        ? { message: 'Novel Updates ranking markup is not supported.' }
        : {}),
  };
}

function parseRows(document: Document, currentUrl: string): LiveRankingRow[] {
  const explicit = Array.from(
    document.querySelectorAll<HTMLElement>(
      '.search_main_box_nu, .ranking-item, [data-ranking-row]',
    ),
  );
  const candidates = explicit.length
    ? explicit
    : uniqueElements(
        Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="/series/"]'))
          .map((anchor) => anchor.closest<HTMLElement>('article, li, tr, .row, div'))
          .filter((row): row is HTMLElement => Boolean(row)),
      );

  return candidates.flatMap((element, index) => {
    const seriesAnchor = Array.from(element.querySelectorAll<HTMLAnchorElement>('a[href]')).find(
      (anchor) => {
        const parsed = trustedUrl(anchor.getAttribute('href'), currentUrl);
        return Boolean(parsed && SERIES_PATH.test(parsed.pathname));
      },
    );
    const seriesUrl = trustedUrl(seriesAnchor?.getAttribute('href'), currentUrl);
    const title = cleanText(
      seriesAnchor?.textContent ??
        element.querySelector('.ranking-title, [data-ranking-title]')?.textContent,
    ).replace(/^#\d+\s*/, '');
    if (!seriesUrl || !title) return [];

    const text = cleanText(element.textContent);
    const rank =
      positiveInteger(element.dataset.rank) ??
      positiveInteger(
        cleanText(
          element.querySelector('.ranking-number, .search_rank, [data-rank]')?.textContent,
        ).match(/#?\s*(\d+)/)?.[1],
      ) ??
      index + 1;
    const image = element.querySelector<HTMLImageElement>('img[src]');
    const coverUrl = trustedAssetUrl(image?.getAttribute('src'), currentUrl);
    const rating = decimal(
      element.dataset.rating ??
        text.match(/\b(?:CN|JP|KR|TH|VN|MY|ID|FIL)\s*\((\d(?:\.\d+)?)\)/i)?.[1] ??
        text.match(
          /\b(?:Chinese|Japanese|Korean|Thai|Vietnamese|Filipino|Indonesian|Khmer|Malaysian)\s*\((\d(?:\.\d+)?)\)/i,
        )?.[1] ??
        text.match(/\bRating\s*:?\s*(\d(?:\.\d+)?)/i)?.[1],
    );

    return [
      {
        rank,
        title,
        seriesUrl: seriesUrl.href,
        ...(coverUrl ? { coverUrl } : {}),
        ...parseLanguage(element),
        ...(rating !== undefined ? { rating } : {}),
        ...numberField(element, 'chapterCount', /(\d[\d,]*)\s+Chapters?\b/i),
        ...textField(element, 'releaseFrequency', /\bEvery\s+[\d.]+\s+Day\(s\)/i),
        ...numberField(element, 'readerCount', /(\d[\d,]*)\s+Readers?\b/i),
        ...numberField(element, 'reviewCount', /(\d[\d,]*)\s+Reviews?\b/i),
        ...textField(element, 'lastUpdated', /\b\d{2}-\d{2}-\d{4}\b/),
        description: cleanDescription(
          element.querySelector('.search_body_nu, .ranking-description, [data-description]')
            ?.textContent,
        ),
        genres: parseLinkedLabels(element, currentUrl, /\/(?:genre|stag)\//),
      } satisfies LiveRankingRow,
    ];
  });
}

function parseRankingTypes(document: Document, currentUrl: string): RankingFilterOption[] {
  const selectOptions = parseControlOptions(document, [
    'select[name="rank"]',
    '[data-ranking-types]',
  ]);
  if (selectOptions.length) return selectOptions;

  const knownLabels = /^(Popular \((?:Month|All)\)|Activity \((?:Week|Month|All)\))$/i;
  const currentRank = new URL(currentUrl).searchParams.get('rank') ?? '';
  return Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]')).flatMap((anchor) => {
    const label = cleanText(anchor.textContent);
    const url = trustedUrl(anchor.getAttribute('href'), currentUrl);
    if (!url || !knownLabels.test(label) || url.pathname !== '/series-ranking/') return [];
    const value = url.searchParams.get('rank') ?? '';
    return [{ label, value, selected: value === currentRank || (!currentRank && !value) }];
  });
}

function parseLanguage(element: HTMLElement): { language?: string } {
  const explicit = cleanText(element.querySelector('[data-language]')?.textContent);
  const text = explicit || cleanText(element.textContent);
  const full = text.match(
    /\b(Chinese|Japanese|Korean|Thai|Vietnamese|Filipino|Indonesian|Khmer|Malaysian)\b/i,
  )?.[1];
  if (full) return { language: full };
  const code = text.match(/\b(CN|JP|KR|TH|VN|MY|ID|FIL)\s*\(/i)?.[1]?.toUpperCase();
  const languages: Record<string, string> = {
    CN: 'Chinese',
    JP: 'Japanese',
    KR: 'Korean',
    TH: 'Thai',
    VN: 'Vietnamese',
    MY: 'Malaysian',
    ID: 'Indonesian',
    FIL: 'Filipino',
  };
  return code && languages[code] ? { language: languages[code] } : {};
}

function cleanDescription(value: string | null | undefined): string | undefined {
  const cleaned = cleanText(value)
    .replace(/\s*(?:\.\.\.\s*)?more>>\s*/gi, ' ')
    .replace(/\s*<<less\s*/gi, ' ')
    .trim();
  return cleaned || undefined;
}

function parseControlOptions(document: Document, selectors: string[]): RankingFilterOption[] {
  const root = firstMatch(document, selectors);
  if (!root) return [];
  if (root instanceof HTMLSelectElement) {
    return Array.from(root.options).map((option) => ({
      label: cleanText(option.textContent) || option.value,
      value: option.value,
      selected: option.selected,
    }));
  }
  const controls = root.matches('input') ? [root] : Array.from(root.querySelectorAll('input'));
  return controls.map((input) => ({
    label: labelFor(input),
    value: input.getAttribute('value') ?? '',
    selected: (input as HTMLInputElement).checked,
  }));
}

function parseCheckboxOptions(document: Document, selectors: string[]): RankingFilterOption[] {
  const seen = new Set<Element>();
  return selectors.flatMap((selector) =>
    Array.from(document.querySelectorAll<HTMLInputElement>(selector)).flatMap((input) => {
      if (seen.has(input)) return [];
      seen.add(input);
      return [
        {
          label: labelFor(input),
          value: input.value,
          selected: input.checked,
        },
      ];
    }),
  );
}

function parseGenres(document: Document): LiveRankingPage['filters']['genres'] {
  const inputs = Array.from(
    document.querySelectorAll<HTMLInputElement>(
      'input[name="gi"], input[name="gi[]"], input[name="ge"], input[name="ge[]"], [data-ranking-genre] input',
    ),
  );
  return inputs.map((input) => ({
    label: labelFor(input),
    value: input.value,
    selected: input.checked || input.dataset.state === 'include',
    excluded: input.dataset.state === 'exclude' || input.classList.contains('exclude'),
  }));
}

function parseMinimumChapters(document: Document): { minimumChapters?: number } {
  const input = document.querySelector<HTMLInputElement>(
    'input[name="mchap"], input[name="chapters"], [data-minimum-chapters]',
  );
  const minimumChapters = positiveInteger(input?.value);
  return minimumChapters === undefined ? {} : { minimumChapters };
}

function parsePagination(document: Document, currentUrl: string) {
  const links = Array.from(
    document.querySelectorAll<HTMLAnchorElement>(
      '.digg_pagination a[href], .pagination a[href], [data-ranking-pagination] a[href]',
    ),
  );
  const pageLinks = links.flatMap((link) => {
    const url = trustedUrl(link.getAttribute('href'), currentUrl);
    const page = positiveInteger(link.textContent);
    return url && page ? [{ page, url: url.href }] : [];
  });
  const currentPage =
    positiveInteger(
      document.querySelector(
        '.digg_pagination .current, .pagination .current, [aria-current="page"]',
      )?.textContent,
    ) ??
    positiveInteger(new URL(currentUrl).searchParams.get('pg')) ??
    1;
  const previousUrl = paginationRel(links, currentUrl, 'prev');
  const nextUrl = paginationRel(links, currentUrl, 'next');
  return {
    currentPage,
    pageLinks,
    ...(previousUrl ? { previousUrl } : {}),
    ...(nextUrl ? { nextUrl } : {}),
  };
}

function paginationRel(
  links: HTMLAnchorElement[],
  currentUrl: string,
  rel: 'prev' | 'next',
): string | undefined {
  const link = links.find(
    (candidate) =>
      candidate.relList.contains(rel) ||
      candidate.classList.contains(rel) ||
      cleanText(candidate.textContent).toLowerCase().includes(rel),
  );
  return trustedUrl(link?.getAttribute('href'), currentUrl)?.href;
}

function parseLinkedLabels(element: Element, currentUrl: string, path: RegExp) {
  return Array.from(element.querySelectorAll<HTMLAnchorElement>('a[href]')).flatMap((anchor) => {
    const url = trustedUrl(anchor.getAttribute('href'), currentUrl);
    const label = cleanText(anchor.textContent);
    return url && path.test(url.pathname) && label ? [{ label, url: url.href }] : [];
  });
}

function textField<K extends string>(
  element: HTMLElement,
  key: K,
  pattern: RegExp,
): Partial<Record<K, string>> {
  const explicit = cleanText(element.querySelector(`[data-${camelToDash(key)}]`)?.textContent);
  const value = explicit || cleanText(element.textContent).match(pattern)?.[0];
  return value ? ({ [key]: value } as Partial<Record<K, string>>) : {};
}

function numberField<K extends string>(
  element: HTMLElement,
  key: K,
  pattern: RegExp,
): Partial<Record<K, number>> {
  const explicit = element.querySelector(`[data-${camelToDash(key)}]`)?.textContent;
  const value = positiveInteger(explicit ?? cleanText(element.textContent).match(pattern)?.[1]);
  return value === undefined ? {} : ({ [key]: value } as Partial<Record<K, number>>);
}

function trustedUrl(value: string | null | undefined, currentUrl: string): URL | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value, currentUrl);
    return url.protocol === 'https:' && url.origin === TRUSTED_ORIGIN ? url : undefined;
  } catch {
    return undefined;
  }
}

function trustedAssetUrl(value: string | null | undefined, currentUrl: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value, currentUrl);
    return url.protocol === 'https:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function firstMatch(document: Document, selectors: string[]): Element | undefined {
  for (const selector of selectors) {
    const match = document.querySelector(selector);
    if (match) return match;
  }
  return undefined;
}

function labelFor(input: Element): string {
  const id = input.getAttribute('id');
  const explicit = id ? input.ownerDocument.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
  return (
    cleanText(explicit?.textContent) ||
    cleanText(input.closest('label')?.textContent) ||
    input.getAttribute('aria-label') ||
    input.getAttribute('value') ||
    'Option'
  );
}

function cleanText(value: string | null | undefined): string {
  return value?.replace(/\s+/g, ' ').trim() ?? '';
}

function positiveInteger(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const number = Number(value.replace(/[^\d]/g, ''));
  return Number.isSafeInteger(number) && number > 0 ? number : undefined;
}

function decimal(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function camelToDash(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function uniqueElements(elements: HTMLElement[]): HTMLElement[] {
  return elements.filter((element, index) => elements.indexOf(element) === index);
}
