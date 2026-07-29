import {
  DATA_BROKER_PROTOCOL_VERSION,
  type DataBrokerResponse,
  type DataPackStatus,
} from '../data/protocol';

export const NOVEL_COMPASS_DATA_ORIGIN = 'https://cbangera2.github.io/*';

export async function readDataPackStatus(): Promise<DataPackStatus> {
  try {
    const response = await send('novel-compass:data:status');
    return response.ok && 'status' in response
      ? response.status
      : { state: 'error', message: response.ok ? 'Status unavailable.' : response.message };
  } catch {
    return { state: 'error', message: 'Optional data status is unavailable.' };
  }
}

export async function enableDataPack(): Promise<DataPackStatus> {
  const granted = await chrome.permissions.request({ origins: [NOVEL_COMPASS_DATA_ORIGIN] });
  if (!granted) {
    return {
      state: 'error',
      message: 'Permission was not granted. Core Novel Updates restyling is still available.',
    };
  }
  const response = await send('novel-compass:data:prepare');
  if (response.ok && 'status' in response) return response.status;
  return {
    state: response.ok ? 'error' : response.code === 'update-required' ? 'update-required' : 'error',
    message: response.ok ? 'Data setup did not complete.' : response.message,
  };
}

export async function removeDataPack(): Promise<DataPackStatus> {
  const response = await send('novel-compass:data:remove');
  if (!response.ok) return { state: 'error', message: response.message };
  return { state: 'not-downloaded' };
}

function send(
  type:
    | 'novel-compass:data:status'
    | 'novel-compass:data:prepare'
    | 'novel-compass:data:remove',
): Promise<DataBrokerResponse> {
  return chrome.runtime.sendMessage({
    type,
    protocolVersion: DATA_BROKER_PROTOCOL_VERSION,
  }) as Promise<DataBrokerResponse>;
}
