import type {
  LinkedLabel,
  LiveRankSet,
  LiveRankings,
  LiveRating,
  LiveSeriesMetadata,
  NovelUpdatesPageIdentity,
  ParseWarning,
} from './contracts';
import { classifyNovelUpdatesDocument, type NovelUpdatesPageSignals } from './page-classifier';

const NOVEL_UPDATES_ORIGIN = 'https://www.novelupdates.com';

export type SeriesMetadataFatalReason = 'unsupported-page' | 'missing-identity' | 'missing-title';

export type SeriesMetadataParseResult =
  | { ok: true; value: LiveSeriesMetadata }
  | {
      ok: false;
      reason: SeriesMetadataFatalReason;
      message: string;
    };

export function parseLiveSeriesPageMetadata(
  document: Document,
  url: string | URL,
): SeriesMetadataParseResult {
  const classification = classifyNovelUpdatesDocument(url, document);
  if (classification.kind !== 'supported' || classification.identity.pageType !== 'series') {
    return {
      ok: false,
      reason: 'unsupported-page',
      message: 'The document is not a supported Novel Updates series page.',
    };
  }
  return parseLiveSeriesMetadata(document, classification.identity);
}

export function parseLiveSeriesMetadata(
  document: Document,
  identity: NovelUpdatesPageIdentity | undefined,
): SeriesMetadataParseResult {
  if (!identity || identity.pageType !== 'series' || !identity.slug) {
    return {
      ok: false,
      reason: 'missing-identity',
      message: 'A resolved series identity is required.',
    };
  }

  const warnings: ParseWarning[] = [];
  const title = firstText(document, ['.seriestitlenu', '.series-title', '[itemprop="name"]']);
  if (!title) {
    return {
      ok: false,
      reason: 'missing-title',
      message: 'The series title could not be parsed.',
    };
  }

  const coverUrl = parseCoverUrl(document, warnings);
  const description = textFromElement(document.querySelector('#editdescription'));
  const associatedNames = linesFromElement(document.querySelector('#editassociated'));
  const authors = linkedLabels(document, '#showauthors a', warnings, 'authors');
  const artists = linkedLabels(document, '#showartists a', warnings, 'artists');
  const genres = linkedLabels(document, '#seriesgenre a', warnings, 'genres');
  const tags = linkedLabels(document, '#showtags a', warnings, 'tags');
  const language = firstLinkedLabel(document, '#showlang a', warnings, 'language');
  const novelType = firstLinkedLabel(document, '#showtype a', warnings, 'novelType');
  const year = parseInteger(textFromElement(document.querySelector('#edityear')));
  const originalStatus = textFromElement(document.querySelector('#editstatus'));
  const translationStatus = textFromElement(document.querySelector('#showtranslated'));
  const licensed = parseBooleanLabel(textFromElement(document.querySelector('#showlicensed')));
  const completelyTranslated = parseBooleanLabel(translationStatus);
  const originalPublishers = linkedLabels(
    document,
    '#showopublisher a',
    warnings,
    'publishers.original',
  );
  const englishPublishers = linkedLabels(
    document,
    '#showepublisher a',
    warnings,
    'publishers.english',
  );
  const releaseFrequency = textFollowingHeading(document, 'Release Frequency');
  const rating = parseRating(document);
  const rankings = parseRankings(document);
  const recommendationLists = linkedLabels(document, '.ulc_sp a', warnings, 'recommendationLists');

  warnIfMissing(warnings, 'coverUrl', coverUrl);
  warnIfMissing(warnings, 'description', description);
  warnIfMissing(warnings, 'associatedNames', associatedNames);
  warnIfMissing(warnings, 'authors', authors);
  warnIfMissing(warnings, 'genres', genres);
  warnIfMissing(warnings, 'language', language);
  warnIfMissing(warnings, 'novelType', novelType);
  warnIfMissing(warnings, 'year', year);
  warnIfMissing(warnings, 'originalStatus', originalStatus);
  warnIfMissing(warnings, 'rating', rating);

  return {
    ok: true,
    value: {
      identity,
      title,
      ...(coverUrl ? { coverUrl } : {}),
      ...(description ? { description } : {}),
      associatedNames,
      authors,
      artists,
      genres,
      tags,
      ...(language ? { language } : {}),
      ...(novelType ? { novelType } : {}),
      ...(year ? { year } : {}),
      ...(originalStatus ? { originalStatus } : {}),
      ...(translationStatus ? { translationStatus } : {}),
      ...(licensed !== undefined ? { licensed } : {}),
      ...(completelyTranslated !== undefined ? { completelyTranslated } : {}),
      publishers: {
        original: originalPublishers,
        english: englishPublishers,
      },
      ...(releaseFrequency ? { releaseFrequency } : {}),
      ...(rating ? { rating } : {}),
      ...(rankings ? { rankings } : {}),
      recommendationLists,
      warnings,
    },
  };
}

export function pageSignalsForSeriesMetadata(document: Document): NovelUpdatesPageSignals {
  return {
    hasSeriesTitle: Boolean(
      document.querySelector('.seriestitlenu, .series-title, [itemprop="name"]'),
    ),
  };
}

function parseCoverUrl(document: Document, warnings: ParseWarning[]): string | undefined {
  const candidate =
    document.querySelector<HTMLImageElement>('.seriesimg img')?.src ??
    document.querySelector<HTMLElement>('[property="image"][content]')?.getAttribute('content') ??
    undefined;
  return validatedHttpsUrl(candidate, warnings, 'coverUrl', false);
}

function linkedLabels(
  document: Document,
  selector: string,
  warnings: ParseWarning[],
  field: string,
): LinkedLabel[] {
  const seen = new Set<string>();
  const results: LinkedLabel[] = [];
  for (const anchor of document.querySelectorAll<HTMLAnchorElement>(selector)) {
    const label = normalizeText(anchor.textContent);
    if (!label) continue;
    const url = validatedHttpsUrl(anchor.href, warnings, field, true);
    const key = `${label}\n${url ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({ label, ...(url ? { url } : {}) });
  }
  return results;
}

function firstLinkedLabel(
  document: Document,
  selector: string,
  warnings: ParseWarning[],
  field: string,
): LinkedLabel | undefined {
  return linkedLabels(document, selector, warnings, field)[0];
}

function validatedHttpsUrl(
  value: string | undefined,
  warnings: ParseWarning[],
  field: string,
  requireNovelUpdatesOrigin: boolean,
): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value, NOVEL_UPDATES_ORIGIN);
    if (
      url.protocol !== 'https:' ||
      (requireNovelUpdatesOrigin && url.origin !== NOVEL_UPDATES_ORIGIN)
    ) {
      throw new Error('untrusted URL');
    }
    return url.href;
  } catch {
    warnings.push({
      code: 'invalid-url',
      field,
      message: `Ignored an invalid or untrusted ${field} URL.`,
    });
    return undefined;
  }
}

function parseRating(document: Document): LiveRating | undefined {
  const aggregate = document.querySelector('[typeof="AggregateRating"]');
  const average =
    parseNumber(aggregate?.querySelector('[property="ratingValue"]')?.getAttribute('content')) ??
    parseNumber(document.querySelector('.uvotes')?.textContent);
  const voteCount =
    parseInteger(aggregate?.querySelector('[property="ratingCount"]')?.getAttribute('content')) ??
    parseVoteCount(document.querySelector('.uvotes')?.textContent);

  const distribution = Array.from(
    document.querySelectorAll<HTMLTableRowElement>('#myrates tr'),
  ).flatMap((row) => {
    const stars = parseInteger(row.cells[0]?.textContent);
    const voteText = normalizeText(row.querySelector('.votetext')?.textContent);
    if (!stars || !voteText) return [];
    const percentage = parseNumber(/([\d.]+)%/.exec(voteText)?.[1]);
    const count = parseInteger(/\((\d+)\s+votes?\)/i.exec(voteText)?.[1]);
    return [
      {
        stars,
        ...(count !== undefined ? { count } : {}),
        ...(percentage !== undefined ? { percentage } : {}),
      },
    ];
  });

  if (average === undefined && voteCount === undefined && distribution.length === 0) {
    return undefined;
  }
  return {
    ...(average !== undefined ? { average } : {}),
    ...(voteCount !== undefined ? { voteCount } : {}),
    ...(distribution.length ? { distribution } : {}),
  };
}

function parseRankings(document: Document): LiveRankings | undefined {
  const activityHeading = findHeading(document, 'Activity Stats');
  const readingHeading = findHeading(document, 'Reading List');
  const activity = rankSetFromSection(activityHeading);
  const readingList = rankSetFromSection(readingHeading);
  const readingListCount = parseInteger(
    readingHeading?.nextElementSibling?.textContent ?? textBetweenHeadings(readingHeading),
  );
  if (!activity && !readingList && readingListCount === undefined) {
    return undefined;
  }
  return {
    ...(activity ? { activity } : {}),
    ...(readingList ? { readingList } : {}),
    ...(readingListCount !== undefined ? { readingListCount } : {}),
  };
}

function rankSetFromSection(heading: Element | undefined): LiveRankSet | undefined {
  const text = textBetweenHeadings(heading);
  const weekly = parseInteger(/Weekly Rank:\s*#?([\d,]+)/i.exec(text)?.[1]);
  const monthly = parseInteger(/Monthly Rank:\s*#?([\d,]+)/i.exec(text)?.[1]);
  const allTime = parseInteger(/All Time Rank:\s*#?([\d,]+)/i.exec(text)?.[1]);
  if (weekly === undefined && monthly === undefined && allTime === undefined) {
    return undefined;
  }
  return {
    ...(weekly !== undefined ? { weekly } : {}),
    ...(monthly !== undefined ? { monthly } : {}),
    ...(allTime !== undefined ? { allTime } : {}),
  };
}

function textFollowingHeading(document: Document, label: string): string | undefined {
  return normalizeText(textBetweenHeadings(findHeading(document, label)));
}

function findHeading(document: Document, label: string): Element | undefined {
  return Array.from(document.querySelectorAll('h4, h5')).find(
    (heading) => normalizeText(heading.firstChild?.textContent) === label,
  );
}

function textBetweenHeadings(heading: Element | undefined): string {
  if (!heading) return '';
  const parts: string[] = [];
  let node = heading.nextSibling;
  while (node) {
    if (node.nodeType === 1 && /^(H4|H5)$/.test((node as Element).tagName)) {
      break;
    }
    parts.push(node.textContent ?? '');
    node = node.nextSibling;
  }
  return normalizeText(parts.join(' ')) ?? '';
}

function linesFromElement(element: Element | null): string[] {
  if (!element) return [];
  const parts: string[] = [];
  for (const node of Array.from(element.childNodes)) {
    if (node.nodeType === 1 && (node as Element).tagName === 'BR') {
      parts.push('\n');
    } else {
      parts.push(node.textContent ?? '');
    }
  }
  return parts
    .join('')
    .split(/\r?\n/)
    .map(normalizeText)
    .filter((value): value is string => Boolean(value));
}

function textFromElement(element: Element | null): string | undefined {
  return normalizeText(element?.textContent);
}

function firstText(document: Document, selectors: string[]): string | undefined {
  for (const selector of selectors) {
    const value = textFromElement(document.querySelector(selector));
    if (value) return value;
  }
  return undefined;
}

function normalizeText(value: string | null | undefined): string | undefined {
  const normalized = value?.replace(/\s+/g, ' ').trim();
  return normalized || undefined;
}

function parseBooleanLabel(value: string | undefined): boolean | undefined {
  if (!value || /^(?:n\/a|unknown|-)$/i.test(value)) return undefined;
  if (/^(?:yes|true)$/i.test(value)) return true;
  if (/^(?:no|false)$/i.test(value)) return false;
  return undefined;
}

function parseNumber(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const match = /-?[\d,.]+/.exec(value);
  if (!match) return undefined;
  const parsed = Number(match[0].replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseInteger(value: string | null | undefined): number | undefined {
  const parsed = parseNumber(value);
  return parsed !== undefined && Number.isSafeInteger(parsed) ? parsed : undefined;
}

function parseVoteCount(value: string | null | undefined): number | undefined {
  return parseInteger(/([\d,]+)\s+votes?/i.exec(value ?? '')?.[1]);
}

function warnIfMissing(warnings: ParseWarning[], field: string, value: unknown): void {
  if (value === undefined || value === null || (Array.isArray(value) && value.length === 0)) {
    warnings.push({
      code: 'missing-optional-section',
      field,
      message: `Optional series metadata field "${field}" was not found.`,
    });
  }
}
