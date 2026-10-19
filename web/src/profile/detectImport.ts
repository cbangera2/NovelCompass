/**
 * Work out what an uploaded file is, so the importer needs no "pick your source" step.
 * Handles gzip (MyAnimeList exports ship as .xml.gz) by sniffing the magic bytes, not the extension.
 */
import { isAniListGdprExport } from './anilistGdpr';
import { isMalListHtml, isMalXml } from './malXml';

export type ImportKind = 'backup' | 'anilist' | 'myanimelist' | 'novelupdates' | 'unknown';

export interface SniffedFile {
  file: File;
  kind: ImportKind;
  text: string;
}

export const IMPORT_FILE_ACCEPT = '.json,.xml,.gz,.html,.htm,application/json,text/xml,text/html,application/gzip';

async function readText(file: File): Promise<string> {
  const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  if (head[0] === 0x1f && head[1] === 0x8b) {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error(`${file.name} is gzipped and this browser cannot unzip it. Unzip it first, then choose the .xml.`);
    }
    return new Response(file.stream().pipeThrough(new DecompressionStream('gzip'))).text();
  }
  return file.text();
}

export function classifyText(text: string): ImportKind {
  const trimmed = text.trimStart();
  if (trimmed.startsWith('{')) {
    try {
      const value: unknown = JSON.parse(trimmed);
      if (isAniListGdprExport(value)) return 'anilist';
      const item = value as Record<string, unknown>;
      if (Array.isArray(item?.entries) && Array.isArray(item?.source_fingerprints)) return 'backup';
    } catch {
      return 'unknown';
    }
    return 'unknown';
  }
  if (isMalXml(trimmed) || isMalListHtml(trimmed)) return 'myanimelist';
  if (trimmed.includes('profile_content3')) return 'novelupdates';
  return 'unknown';
}

export async function sniffFile(file: File): Promise<SniffedFile> {
  const text = await readText(file);
  return { file, kind: classifyText(text), text };
}

export const IMPORT_KIND_LABELS: Record<ImportKind, string> = {
  backup: 'Novel Compass backup',
  anilist: 'AniList export',
  myanimelist: 'MyAnimeList export',
  novelupdates: 'NovelUpdates page',
  unknown: 'unrecognised file',
};
