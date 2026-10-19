// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { classifyText } from '../../../web/src/profile/detectImport';
import { mergeProfiles } from '../../../web/src/profile/store';
import type { LocalUserProfile } from '../../../web/src/profile/types';
import { isMalListHtml, mapMalStatus, parseMalHtml, parseMalXml, resolveMalIds } from '../../../web/src/profile/malXml';

const MANGA_XML = `<?xml version="1.0" encoding="UTF-8" ?>
<myanimelist>
  <myinfo><user_id>1</user_id><user_name>tester</user_name><user_export_type>2</user_export_type></myinfo>
  <manga>
    <manga_mangadb_id>151358</manga_mangadb_id>
    <manga_title><![CDATA["Okaeri, Papa"]]></manga_title>
    <my_read_volumes>1</my_read_volumes><my_read_chapters>15</my_read_chapters>
    <my_start_date>2023-12-29</my_start_date><my_finish_date>0000-00-00</my_finish_date>
    <my_score>0</my_score><my_status>Reading</my_status>
  </manga>
  <manga>
    <manga_mangadb_id>147204</manga_mangadb_id>
    <manga_title><![CDATA[+99 Reinforced Wooden Stick]]></manga_title>
    <my_read_volumes>0</my_read_volumes><my_read_chapters>50</my_read_chapters>
    <my_start_date>0000-00-00</my_start_date><my_finish_date>0000-00-00</my_finish_date>
    <my_score>9</my_score><my_status>On-Hold</my_status>
  </manga>
  <manga><manga_mangadb_id>147204</manga_mangadb_id><manga_title>dup</manga_title><my_status>Dropped</my_status></manga>
  <manga><manga_mangadb_id>0</manga_mangadb_id><manga_title>bad</manga_title></manga>
</myanimelist>`;

describe('MyAnimeList import', () => {
  it('parses a manga export', async () => {
    const parsed = await parseMalXml(MANGA_XML, 'mangalist.xml');
    expect(parsed.source).toBe('myanimelist');
    expect(parsed.username).toBe('tester');
    expect(parsed.malformed_rows).toBe(1);
    expect(parsed.duplicate_slugs).toEqual(['mal-manga-147204']);
    expect(parsed.entries).toHaveLength(2);
    const [first, second] = parsed.entries;
    expect(first).toMatchObject({
      slug: 'mal-manga-151358', imported_title: '"Okaeri, Papa"', status: 'reading',
      progress: 'ch 15 · vol 1', progress_units: 15, media_kind: 'manga', started_on: '2023-12-29',
    });
    expect(first.rating).toBeUndefined();
    expect(first.finished_on).toBeUndefined();
    expect(second).toMatchObject({ status: 'paused', rating: 4.5 });
  });

  it('parses anime exports', async () => {
    const xml = `<myanimelist><myinfo><user_name>t</user_name></myinfo><anime>
      <series_animedb_id>1</series_animedb_id><series_title>Cowboy Bebop</series_title>
      <my_watched_episodes>26</my_watched_episodes><my_score>10</my_score><my_status>Completed</my_status>
    </anime></myanimelist>`;
    const parsed = await parseMalXml(xml, 'animelist.xml');
    expect(parsed.entries[0]).toMatchObject({
      slug: 'mal-anime-1', media_kind: 'anime', status: 'completed', rating: 5, progress: 'ep 26',
    });
  });

  it('maps MAL statuses', () => {
    expect(mapMalStatus('Plan to Read')).toBe('plan_to_read');
    expect(mapMalStatus('Plan to Watch')).toBe('plan_to_read');
    expect(mapMalStatus('Watching')).toBe('reading');
    expect(mapMalStatus('Dropped')).toBe('dropped');
  });

  it('rewrites MAL entries onto AniList slugs and keeps the rest', async () => {
    const parsed = await parseMalXml(MANGA_XML, 'mangalist.xml');
    const fetchImpl = (async (_url: string, init: { body: string }) => {
      const { variables } = JSON.parse(init.body);
      const media = variables.type === 'MANGA' ? [{ id: 99, idMal: 151358 }] : [];
      return { ok: true, json: async () => ({ data: { Page: { media } } }) };
    }) as unknown as typeof fetch;
    const out = await resolveMalIds(parsed.entries, fetchImpl, 0);
    expect(out.map((entry) => entry.slug)).toEqual(['anilist-99', 'mal-manga-147204']);
  });

  it('keeps entries when AniList is unreachable', async () => {
    const parsed = await parseMalXml(MANGA_XML, 'mangalist.xml');
    const failing = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    expect(await resolveMalIds(parsed.entries, failing, 0)).toEqual(parsed.entries);
  });
});

describe('import file detection', () => {
  it('classifies each supported export', () => {
    expect(classifyText(MANGA_XML)).toBe('myanimelist');
    expect(classifyText('{"user":{"id":1},"lists":[]}')).toBe('anilist');
    expect(classifyText('{"entries":[],"source_fingerprints":[],"curated_lists":[]}')).toBe('backup');
    expect(classifyText('<html><div id="profile_content3"></div></html>')).toBe('novelupdates');
    expect(classifyText('hello')).toBe('unknown');
    expect(classifyText('{not json')).toBe('unknown');
  });
});

const rows = [
  { status: 1, score: 9, num_read_chapters: 50, num_read_volumes: 0, manga_title: '+99 "Wooden" Stick', manga_id: 147204, start_date_string: '04-05-22', finish_date_string: null },
  { status: 6, score: 0, num_read_chapters: 0, num_read_volumes: 0, manga_title: 'Plan One', manga_id: 5, start_date_string: null, finish_date_string: null },
];
const PAGE = `<html><head><meta property="og:url" content="https://myanimelist.net/mangalist/tester"></head><body>
<table class="list-table" data-items="${JSON.stringify(rows).replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"></table></body></html>`;

describe('saved MAL list page', () => {
  it('is recognised and parsed', async () => {
    expect(isMalListHtml(PAGE)).toBe(true);
    expect(classifyText(PAGE)).toBe('myanimelist');
    const parsed = await parseMalHtml(PAGE, 'list.html');
    expect(parsed.username).toBe('tester');
    expect(parsed.entries[0]).toMatchObject({
      slug: 'mal-manga-147204', imported_title: '+99 "Wooden" Stick', status: 'reading', rating: 4.5,
      progress: 'ch 50', started_on: '2022-04-05',
    });
    expect(parsed.entries[1].status).toBe('plan_to_read');
    expect(parsed.warnings).toEqual([]);
  });
});

describe('profile merge', () => {
  const profile = (entries: LocalUserProfile['entries']): LocalUserProfile => ({
    profile_id: 'p', parser_version: 1, dataset_version: 'v', imported_at: 't',
    source_fingerprints: [], entries, curated_lists: [],
  });
  const base = { imported_title: 'T', source_file: 'f' };

  it('adds new titles and keeps what an earlier import knew', () => {
    const current = profile([{ ...base, slug: 'a', status: 'reading', rating: 4, novel_id: 7 }]);
    const incoming = profile([
      { ...base, slug: 'a', status: 'completed', rating: undefined, novel_id: undefined },
      { ...base, slug: 'b', status: 'reading' },
    ]);
    const merged = mergeProfiles(current, incoming);
    expect(merged.entries).toHaveLength(2);
    expect(merged.entries.find((entry) => entry.slug === 'a')).toMatchObject({ status: 'completed', rating: 4, novel_id: 7 });
  });
});
