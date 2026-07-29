export const DATA_BROKER_PROTOCOL_VERSION = 1;

export type DataBrokerRequest =
  | {
      type: 'novel-compass:data:fetch';
      protocolVersion: typeof DATA_BROKER_PROTOCOL_VERSION;
      path: string;
    }
  | {
      type: 'novel-compass:data:status';
      protocolVersion: typeof DATA_BROKER_PROTOCOL_VERSION;
    }
  | {
      type: 'novel-compass:data:remove';
      protocolVersion: typeof DATA_BROKER_PROTOCOL_VERSION;
    };

export type DataPackStatus = {
  state: 'not-downloaded' | 'ready' | 'error' | 'update-required';
  datasetVersion?: string;
  lastUpdatedAt?: string;
  bytes?: number;
  message?: string;
};

export type DataBrokerResponse =
  | {
      ok: true;
      datasetVersion: string;
      body: unknown;
      cache: 'packaged' | 'hit' | 'network';
    }
  | { ok: true; status: DataPackStatus }
  | { ok: true; removed: true }
  | {
      ok: false;
      code:
        | 'invalid-request'
        | 'unavailable'
        | 'integrity-failed'
        | 'update-required'
        | 'unsupported-data';
      message: string;
      retryable: boolean;
    };

export function isDataBrokerRequest(value: unknown): value is DataBrokerRequest {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<DataBrokerRequest>;
  return (
    candidate.protocolVersion === DATA_BROKER_PROTOCOL_VERSION &&
    (candidate.type === 'novel-compass:data:fetch' ||
      candidate.type === 'novel-compass:data:status' ||
      candidate.type === 'novel-compass:data:remove')
  );
}

export function normalizeArtifactPath(value: string): string | undefined {
  if (!value || value.length > 240 || value.includes('\\')) return undefined;
  const normalized = value.replace(/^\/+/, '');
  if (
    !normalized.endsWith('.json') ||
    normalized.split('/').some((part) => !part || part === '.' || part === '..') ||
    /[?#\0]/.test(normalized)
  ) {
    return undefined;
  }
  return normalized;
}
