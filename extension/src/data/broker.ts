import type { DataBrokerResponse, DataPackStatus } from './protocol';
import { normalizeArtifactPath } from './protocol';

const METADATA_KEY = 'novelCompassDataPack';
const CACHE_PREFIX = 'novel-compass-data-';
const JSON_CONTENT_TYPE = /^(application\/json|text\/json)(?:;|$)/i;
const MAX_POINTER_BYTES = 64 * 1024;
const MAX_MANIFEST_BYTES = 512 * 1024;
const DEFAULT_ARTIFACT_LIMIT = 2 * 1024 * 1024;

type ArtifactDescriptor = {
  url: string;
  sha256: string;
  compressed_bytes?: number;
  uncompressed_bytes?: number;
};

type RemoteManifest = {
  schema_version: number;
  dataset_version: string;
  minimum_data_client_version?: number;
  artifacts: Record<string, ArtifactDescriptor> | ArtifactDescriptor[];
};

type LatestPointer = {
  dataset_version: string;
  manifest_url: string;
  manifest_sha256?: string;
};

type StoredMetadata = DataPackStatus & {
  manifestUrl?: string;
  manifest?: RemoteManifest;
};

export interface DataBrokerDependencies {
  fetch: typeof fetch;
  caches: Pick<CacheStorage, 'open' | 'delete' | 'keys'>;
  storage: {
    get(key: string): Promise<Record<string, unknown>>;
    set(items: Record<string, unknown>): Promise<void>;
    remove(key: string): Promise<void>;
  };
  packagedUrl(path: string): string;
  latestUrl: string;
  trustedOrigins: ReadonlySet<string>;
  now?: () => Date;
}

export class ExtensionDataBroker {
  private readonly inFlight = new Map<string, Promise<DataBrokerResponse>>();

  constructor(private readonly dependencies: DataBrokerDependencies) {}

  async fetchArtifact(rawPath: string): Promise<DataBrokerResponse> {
    const path = normalizeArtifactPath(rawPath);
    if (!path) return failure('invalid-request', 'Invalid data artifact path.', false);
    const current = this.inFlight.get(path);
    if (current) return current;
    const request = this.fetchArtifactOnce(path).finally(() => this.inFlight.delete(path));
    this.inFlight.set(path, request);
    return request;
  }

  async getStatus(): Promise<DataPackStatus> {
    return (await this.readMetadata()) ?? { state: 'not-downloaded' };
  }

  async prepare(): Promise<DataBrokerResponse> {
    const prior = await this.readMetadata();
    try {
      const manifest = await this.resolveManifest(prior);
      return {
        ok: true,
        status: {
          state: prior?.state === 'ready' ? 'ready' : 'not-downloaded',
          datasetVersion: manifest.dataset_version,
          lastUpdatedAt: prior?.lastUpdatedAt,
          bytes: prior?.bytes,
        },
      };
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Novel Compass data is unavailable.';
      await this.writeMetadata({
        ...(prior ?? {}),
        state: message.includes('update required') ? 'update-required' : 'error',
        message,
      });
      return failure(
        message.includes('update required') ? 'update-required' : 'unavailable',
        message,
        !message.includes('update required'),
      );
    }
  }

  async remove(): Promise<DataBrokerResponse> {
    const keys = await this.dependencies.caches.keys();
    await Promise.all(
      keys.filter((key) => key.startsWith(CACHE_PREFIX)).map((key) => this.dependencies.caches.delete(key)),
    );
    await this.dependencies.storage.remove(METADATA_KEY);
    return { ok: true, removed: true };
  }

  private async fetchArtifactOnce(path: string): Promise<DataBrokerResponse> {
    const packaged = await this.tryPackaged(path);
    if (packaged) return packaged;

    const prior = await this.readMetadata();
    try {
      const manifest = await this.resolveManifest(prior);
      const resolvedMetadata = await this.readMetadata();
      const descriptor = artifactMap(manifest.artifacts).get(path);
      if (!descriptor) {
        return failure('unsupported-data', `Dataset does not contain ${path}.`, false);
      }
      const artifactUrl = this.trustedUrl(descriptor.url, resolvedMetadata?.manifestUrl);
      const cache = await this.dependencies.caches.open(`${CACHE_PREFIX}${manifest.dataset_version}`);
      const cached = await cache.match(artifactUrl);
      if (cached) {
        try {
          return await this.validatedArtifact(cached, descriptor, manifest.dataset_version, 'hit');
        } catch {
          await cache.delete(artifactUrl);
        }
      }
      const response = await this.dependencies.fetch(artifactUrl, { cache: 'no-store' });
      const cacheableResponse = response.clone();
      const validated = await this.validatedArtifact(
        response,
        descriptor,
        manifest.dataset_version,
        'network',
      );
      if (validated.ok && 'body' in validated) {
        await cache.put(artifactUrl, cacheableResponse);
        await this.writeMetadata({
          state: 'ready',
          datasetVersion: manifest.dataset_version,
          lastUpdatedAt: (this.dependencies.now?.() ?? new Date()).toISOString(),
          bytes: (prior?.bytes ?? 0) + Number(descriptor.compressed_bytes ?? 0),
          manifestUrl: resolvedMetadata?.manifestUrl,
          manifest,
        });
      }
      return validated;
    } catch (reason) {
      let cached: DataBrokerResponse | undefined;
      try {
        cached = prior?.manifest
          ? await this.readCached(path, prior.manifest, prior.manifestUrl)
          : undefined;
      } catch {
        cached = undefined;
      }
      if (cached) return cached;
      const message = reason instanceof Error ? reason.message : 'Novel Compass data is unavailable.';
      const code = message.includes('update required')
        ? 'update-required'
        : message.includes('integrity check')
          ? 'integrity-failed'
          : 'unavailable';
      await this.writeMetadata({ ...(prior ?? {}), state: code === 'update-required' ? 'update-required' : 'error', message });
      return failure(code, message, code !== 'update-required');
    }
  }

  private async tryPackaged(path: string): Promise<DataBrokerResponse | undefined> {
    try {
      const response = await this.dependencies.fetch(this.dependencies.packagedUrl(path));
      if (!response.ok) return undefined;
      assertJsonResponse(response, DEFAULT_ARTIFACT_LIMIT);
      return {
        ok: true,
        datasetVersion: 'packaged',
        body: await response.json(),
        cache: 'packaged',
      };
    } catch {
      return undefined;
    }
  }

  private async resolveManifest(prior?: StoredMetadata): Promise<RemoteManifest> {
    try {
      const pointerResponse = await this.dependencies.fetch(this.dependencies.latestUrl, {
        cache: 'no-store',
      });
      const pointer = await readValidatedJson<LatestPointer>(pointerResponse, MAX_POINTER_BYTES);
      const manifestUrl = this.trustedUrl(pointer.manifest_url, this.dependencies.latestUrl);
      if (
        prior?.manifest &&
        prior.datasetVersion === pointer.dataset_version &&
        prior.manifestUrl === manifestUrl
      ) {
        return prior.manifest;
      }
      const manifestResponse = await this.dependencies.fetch(manifestUrl, { cache: 'no-store' });
      const bytes = await readValidatedBytes(manifestResponse, MAX_MANIFEST_BYTES);
      if (pointer.manifest_sha256) await assertDigest(bytes, pointer.manifest_sha256);
      const manifest = JSON.parse(new TextDecoder().decode(bytes)) as RemoteManifest;
      validateManifest(manifest, pointer.dataset_version);
      await this.writeMetadata({
        ...(prior ?? {}),
        state: prior?.state ?? 'not-downloaded',
        datasetVersion: manifest.dataset_version,
        manifestUrl,
        manifest,
      });
      return manifest;
    } catch (reason) {
      if (prior?.manifest) return prior.manifest;
      throw reason;
    }
  }

  private async validatedArtifact(
    response: Response,
    descriptor: ArtifactDescriptor,
    datasetVersion: string,
    cache: 'hit' | 'network',
  ): Promise<DataBrokerResponse> {
    const declaredSize = Number(
      descriptor.uncompressed_bytes ?? descriptor.compressed_bytes ?? DEFAULT_ARTIFACT_LIMIT,
    );
    const ceiling = Math.min(
      Math.max(declaredSize + Math.ceil(declaredSize * 0.05), 1024),
      DEFAULT_ARTIFACT_LIMIT,
    );
    const bytes = await readValidatedBytes(response, ceiling);
    await assertDigest(bytes, descriptor.sha256);
    return {
      ok: true,
      datasetVersion,
      body: JSON.parse(new TextDecoder().decode(bytes)),
      cache,
    };
  }

  private async readCached(
    path: string,
    manifest: RemoteManifest,
    manifestUrl?: string,
  ): Promise<DataBrokerResponse | undefined> {
    const descriptor = artifactMap(manifest.artifacts).get(path);
    if (!descriptor) return undefined;
    const cache = await this.dependencies.caches.open(`${CACHE_PREFIX}${manifest.dataset_version}`);
    const url = this.trustedUrl(descriptor.url, manifestUrl);
    const response = await cache.match(url);
    return response
      ? this.validatedArtifact(response, descriptor, manifest.dataset_version, 'hit')
      : undefined;
  }

  private trustedUrl(value: string, base?: string): string {
    const url = new URL(value, base);
    if (url.protocol !== 'https:' || !this.dependencies.trustedOrigins.has(url.origin)) {
      throw new Error('Dataset URL is not on the trusted Novel Compass origin.');
    }
    return url.href;
  }

  private async readMetadata(): Promise<StoredMetadata | undefined> {
    const result = await this.dependencies.storage.get(METADATA_KEY);
    const value = result[METADATA_KEY];
    return value && typeof value === 'object' ? (value as StoredMetadata) : undefined;
  }

  private writeMetadata(value: StoredMetadata): Promise<void> {
    return this.dependencies.storage.set({ [METADATA_KEY]: value });
  }
}

function artifactMap(value: RemoteManifest['artifacts']): Map<string, ArtifactDescriptor> {
  if (!Array.isArray(value)) return new Map(Object.entries(value));
  return new Map(value.map((item) => [new URL(item.url).pathname.split('/').pop() || '', item]));
}

function validateManifest(manifest: RemoteManifest, expectedVersion: string): void {
  if (!manifest || manifest.schema_version !== 1 || manifest.dataset_version !== expectedVersion) {
    throw new Error('Dataset manifest schema or version is unsupported.');
  }
  if ((manifest.minimum_data_client_version ?? 1) > 1) {
    throw new Error('Extension update required for this Novel Compass dataset.');
  }
  if (!manifest.artifacts || typeof manifest.artifacts !== 'object') {
    throw new Error('Dataset manifest has no artifact index.');
  }
}

function assertJsonResponse(response: Response, ceiling: number): void {
  if (!response.ok) throw new Error(`Dataset returned HTTP ${response.status}.`);
  const type = response.headers.get('content-type') || '';
  if (!JSON_CONTENT_TYPE.test(type)) throw new Error('Dataset response was not JSON.');
  const length = Number(response.headers.get('content-length') || 0);
  if (length > ceiling) throw new Error('Dataset response exceeded its size limit.');
}

async function readValidatedBytes(response: Response, ceiling: number): Promise<Uint8Array> {
  assertJsonResponse(response, ceiling);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > ceiling) throw new Error('Dataset response exceeded its size limit.');
  return bytes;
}

async function readValidatedJson<T>(response: Response, ceiling: number): Promise<T> {
  const bytes = await readValidatedBytes(response, ceiling);
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}

async function assertDigest(bytes: Uint8Array, expected: string): Promise<void> {
  const digestInput = Uint8Array.from(bytes);
  const actual = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', digestInput.buffer)))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  if (actual.toLowerCase() !== expected.replace(/^sha256-/, '').toLowerCase()) {
    throw new Error('Dataset integrity check failed.');
  }
}

function failure(
  code: Extract<DataBrokerResponse, { ok: false }>['code'],
  message: string,
  retryable: boolean,
): DataBrokerResponse {
  return { ok: false, code, message, retryable };
}
