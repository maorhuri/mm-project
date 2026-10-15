import { Readable } from 'node:stream';
import type { ObjectStorage, StoredObject } from './types';

/** In-memory storage for tests only. Clearly not durable. */
export class MemoryStorage implements ObjectStorage {
  readonly driver = 'memory' as const;
  private readonly objects = new Map<string, { body: Buffer; contentType: string }>();

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    this.objects.set(key, { body: Buffer.from(body), contentType });
  }

  async get(key: string): Promise<StoredObject | null> {
    const obj = this.objects.get(key);
    if (!obj) return null;
    return { body: Readable.from(obj.body), contentType: obj.contentType, contentLength: obj.body.length };
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }

  async exists(key: string): Promise<boolean> {
    return this.objects.has(key);
  }

  async presignGet(): Promise<string | null> {
    return null;
  }

  /** Test helper. */
  size(): number {
    return this.objects.size;
  }

  clear(): void {
    this.objects.clear();
  }
}
