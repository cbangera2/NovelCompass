import { beforeEach, describe, expect, it, vi } from 'vitest';

const getNovel = vi.fn();
vi.mock('./data', () => ({
  configuredDataMode: () => 'api',
  createDataSource: () => Promise.resolve({ getNovel }),
  forcedDataMode: () => undefined,
  saveDataModePreference: () => undefined,
}));

const { ensureDetail, registerPreviews } = await import('./CoverPreview');

const detail = (id: number, synopsis = 'A long story.') => ({ id, title: `T${id}`, synopsis, author: 'Detail author', tags: ['x'] });

describe('ensureDetail', () => {
  beforeEach(() => getNovel.mockReset());

  it('does not fetch when a registered preview already has its synopsis', async () => {
    registerPreviews([{ id: 1, title: 'T1', synopsis: 'Known.' }]);
    expect((await ensureDetail(1, 'api'))?.synopsis).toBe('Known.');
    expect(getNovel).not.toHaveBeenCalled();
  });

  it('fetches a missing synopsis once, keeps what the surface registered, and serves the next hover from memory', async () => {
    getNovel.mockResolvedValue(detail(2));
    registerPreviews([{ id: 2, title: 'T2', author: 'Surface author', matchPercent: 80 }]);
    expect(await ensureDetail(2, 'api')).toMatchObject({ synopsis: 'A long story.', author: 'Surface author', matchPercent: 80, tags: ['x'] });
    await ensureDetail(2, 'api');
    expect(getNovel).toHaveBeenCalledTimes(1);
  });

  it('shares one request between concurrent hovers and retries after a failure', async () => {
    getNovel.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(detail(3));
    registerPreviews([{ id: 3, title: 'T3' }]);
    expect(await Promise.all([ensureDetail(3, 'api'), ensureDetail(3, 'api')])).toEqual([null, null]);
    expect(getNovel).toHaveBeenCalledTimes(1);
    expect((await ensureDetail(3, 'api'))?.synopsis).toBe('A long story.');
    expect(getNovel).toHaveBeenCalledTimes(2);
  });

  it('keeps data modes apart', async () => {
    registerPreviews([{ id: 4, title: 'T4', synopsis: 'Api only.' }]);
    getNovel.mockResolvedValue(detail(4, 'From static.'));
    expect((await ensureDetail(4, 'static'))?.synopsis).toBe('From static.');
  });
});
