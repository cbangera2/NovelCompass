import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  enableDataPack,
  NOVEL_COMPASS_DATA_ORIGIN,
  readDataPackStatus,
  removeDataPack,
} from '../../src/popup/data-controls';

const request = vi.fn();
const sendMessage = vi.fn();

beforeEach(() => {
  request.mockReset();
  sendMessage.mockReset();
  vi.stubGlobal('chrome', {
    permissions: { request },
    runtime: { sendMessage },
  });
});

describe('popup data controls', () => {
  it('requests the narrow origin only after explicit enablement', async () => {
    request.mockResolvedValue(true);
    sendMessage.mockResolvedValue({
      ok: true,
      status: { state: 'not-downloaded', datasetVersion: '2026-07-29' },
    });

    await expect(enableDataPack()).resolves.toMatchObject({
      state: 'not-downloaded',
      datasetVersion: '2026-07-29',
    });
    expect(request).toHaveBeenCalledWith({ origins: [NOVEL_COMPASS_DATA_ORIGIN] });
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'novel-compass:data:prepare',
      protocolVersion: 1,
    });
  });

  it('keeps core restyling available when permission is denied', async () => {
    request.mockResolvedValue(false);
    await expect(enableDataPack()).resolves.toEqual({
      state: 'error',
      message: 'Permission was not granted. Core Novel Updates restyling is still available.',
    });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('reads status and removes only broker data through typed messages', async () => {
    sendMessage
      .mockResolvedValueOnce({
        ok: true,
        status: { state: 'ready', datasetVersion: 'v1', bytes: 2048 },
      })
      .mockResolvedValueOnce({ ok: true, removed: true });
    await expect(readDataPackStatus()).resolves.toMatchObject({ state: 'ready', bytes: 2048 });
    await expect(removeDataPack()).resolves.toEqual({ state: 'not-downloaded' });
    expect(sendMessage.mock.calls.map(([message]) => message.type)).toEqual([
      'novel-compass:data:status',
      'novel-compass:data:remove',
    ]);
  });

  it('renders an update-required broker response without retry loops', async () => {
    request.mockResolvedValue(true);
    sendMessage.mockResolvedValue({
      ok: false,
      code: 'update-required',
      message: 'Extension update required.',
      retryable: false,
    });
    await expect(enableDataPack()).resolves.toEqual({
      state: 'update-required',
      message: 'Extension update required.',
    });
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });
});
