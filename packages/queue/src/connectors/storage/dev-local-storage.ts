import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import type { ContentStorageAdapter, StoredAssetMetadata } from './storage.interface';

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export class DevLocalStorageAdapter implements ContentStorageAdapter {
  readonly adapterType = 'dev-local' as const;

  baseDir(): string {
    return process.env.CONTENT_ASSET_STORAGE_DIR
      ? resolve(process.env.CONTENT_ASSET_STORAGE_DIR)
      : join(tmpdir(), 'geo-content-assets-dev');
  }

  async put(
    organizationId: string,
    bytes: Buffer,
    mimeType: string,
    filename?: string,
  ): Promise<StoredAssetMetadata> {
    const safeOrg = UUID_RE.test(organizationId) ? organizationId : 'unknown';
    const ext = filename?.includes('.') ? filename.slice(filename.lastIndexOf('.')) : '';
    const key = `${safeOrg}/${randomUUID()}${ext}`;
    const base = this.baseDir();
    await mkdir(join(base, safeOrg), { recursive: true });
    await writeFile(join(base, key), bytes);

    const checksum = createHash('sha256').update(bytes).digest('hex');

    return {
      storageRef: `dev-local://${key}`,
      storageKey: key,
      mimeType,
      sizeBytes: bytes.length,
      checksum,
      publicUrl: `file://${join(base, key).replace(/\\/g, '/')}`,
      adapter: 'dev-local',
    };
  }

  async get(storageKey: string): Promise<Buffer> {
    const filePath = join(this.baseDir(), storageKey);
    return readFile(filePath);
  }

  async getSignedUrl(storageKey: string): Promise<string> {
    // 本地开发模拟签名 URL
    return `http://localhost:3001/api/assets/dev-download/${encodeURIComponent(storageKey)}?sig=dev-mock-sig`;
  }
}
