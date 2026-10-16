import type { Readable } from 'node:stream';

export interface StoredObject {
  body: Readable;
  contentType: string;
  contentLength?: number;
}

/** Minimal object-storage contract. S3/MinIO in production, in-memory in tests. */
export interface ObjectStorage {
  readonly driver: 's3' | 'memory';
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<StoredObject | null>;
  delete(key: string): Promise<void>;
  /** Delete every object under a key prefix (e.g. a brand's folder). Returns the count. */
  deletePrefix(prefix: string): Promise<number>;
  exists(key: string): Promise<boolean>;
  /** Pre-signed download URL, or null when the driver cannot sign. */
  presignGet(key: string, ttlSeconds: number): Promise<string | null>;
}
