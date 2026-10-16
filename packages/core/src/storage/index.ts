import { getConfig } from '../config';
import { MemoryStorage } from './memory';
import { S3Storage } from './s3';
import type { ObjectStorage } from './types';

export type { ByteRange, ObjectStorage, StoredObject } from './types';
export { MemoryStorage } from './memory';
export { S3Storage } from './s3';

let instance: ObjectStorage | undefined;

export function getStorage(): ObjectStorage {
  if (instance) return instance;
  instance = getConfig().STORAGE_DRIVER === 'memory' ? new MemoryStorage() : new S3Storage();
  return instance;
}

/** Test helper: swap the storage implementation. */
export function setStorage(storage: ObjectStorage | undefined): void {
  instance = storage;
}
