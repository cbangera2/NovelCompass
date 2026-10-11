import { describe, expect, it } from 'vitest';

import {
  DATA_BROKER_PROTOCOL_VERSION,
  isDataBrokerRequest,
  normalizeArtifactPath,
} from '../../src/data/protocol';

describe('data broker protocol', () => {
  it('accepts versioned messages and rejects unrelated page messages', () => {
    expect(
      isDataBrokerRequest({
        type: 'novel-compass:data:fetch',
        protocolVersion: DATA_BROKER_PROTOCOL_VERSION,
        path: 'details/0a.json',
      }),
    ).toBe(true);
    expect(isDataBrokerRequest({ type: 'novel-compass:data:fetch', protocolVersion: 99 })).toBe(
      false,
    );
    expect(isDataBrokerRequest({ type: 'other', protocolVersion: 1 })).toBe(false);
    expect(
      isDataBrokerRequest({
        type: 'novel-compass:data:prepare',
        protocolVersion: DATA_BROKER_PROTOCOL_VERSION,
      }),
    ).toBe(true);
  });

  it('allows only relative JSON artifact paths', () => {
    expect(normalizeArtifactPath('/recommendations/0a.json')).toBe('recommendations/0a.json');
    expect(normalizeArtifactPath('../manifest.json')).toBeUndefined();
    expect(normalizeArtifactPath('https://evil.test/data.json')).toBeUndefined();
    expect(normalizeArtifactPath('details/0a.js')).toBeUndefined();
  });
});
