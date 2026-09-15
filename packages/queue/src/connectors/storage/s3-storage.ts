import { createHash, createHmac, randomUUID } from 'node:crypto';
import type { ContentStorageAdapter, StoredAssetMetadata } from './storage.interface';

/**
 * 生产级 S3 兼容对象存储适配器（PHASE 13 · Production Asset Storage）。
 * 支持 AWS S3, Cloudflare R2, MinIO, 阿里云 OSS (S3 API).
 * 自带 AWS SigV4 预签名 URL 算法，不引入庞大 AWS SDK 依赖。
 */

export interface S3StorageConfig {
  endpoint: string; // e.g. "https://s3.us-east-1.amazonaws.com" or "https://<account>.r2.cloudflarestorage.com"
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicUrlPrefix?: string; // Optional CDN or public domain
}

export class S3CompatibleStorageAdapter implements ContentStorageAdapter {
  readonly adapterType = 's3-compatible' as const;
  private readonly config: S3StorageConfig;

  constructor(customConfig?: Partial<S3StorageConfig>) {
    this.config = {
      endpoint: customConfig?.endpoint || process.env.S3_ENDPOINT || 'http://127.0.0.1:9000',
      bucket: customConfig?.bucket || process.env.S3_BUCKET || 'geolens-assets',
      region: customConfig?.region || process.env.S3_REGION || 'auto',
      accessKeyId: customConfig?.accessKeyId || process.env.S3_ACCESS_KEY_ID || 'mock-access-key',
      secretAccessKey: customConfig?.secretAccessKey || process.env.S3_SECRET_ACCESS_KEY || 'mock-secret-key',
      publicUrlPrefix: customConfig?.publicUrlPrefix || process.env.S3_PUBLIC_URL_PREFIX,
    };
  }

  async put(
    organizationId: string,
    bytes: Buffer,
    mimeType: string,
    filename?: string,
  ): Promise<StoredAssetMetadata> {
    const ext = filename?.includes('.') ? filename.slice(filename.lastIndexOf('.')) : '';
    const storageKey = `${organizationId}/${randomUUID()}${ext}`;
    const checksum = createHash('sha256').update(bytes).digest('hex');

    // 生产环境中通过 HTTP PUT 上传至 S3 兼容服务
    // 如果配置了有效凭证且处于生产网络，执行 fetch
    if (process.env.EXTERNAL_PUBLISHING_ENABLED === 'true' && !this.config.accessKeyId.startsWith('mock')) {
      const uploadUrl = await this.getSignedUrl(storageKey, 3600, 'PUT');
      await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': mimeType },
        body: new Uint8Array(bytes),
      });
    }

    const publicUrl = this.config.publicUrlPrefix
      ? `${this.config.publicUrlPrefix.replace(/\/$/, '')}/${storageKey}`
      : `${this.config.endpoint.replace(/\/$/, '')}/${this.config.bucket}/${storageKey}`;

    return {
      storageRef: `s3://${this.config.bucket}/${storageKey}`,
      storageKey,
      mimeType,
      sizeBytes: bytes.length,
      checksum,
      publicUrl,
      adapter: 's3-compatible',
    };
  }

  async get(storageKey: string): Promise<Buffer> {
    const downloadUrl = await this.getSignedUrl(storageKey, 300, 'GET');
    const res = await fetch(downloadUrl);
    if (!res.ok) {
      throw new Error(`S3_FETCH_FAILED: ${res.statusText}`);
    }
    const arrayBuf = await res.arrayBuffer();
    return Buffer.from(arrayBuf);
  }

  /**
   * 生成 SigV4 Presigned URL (GET or PUT)。
   */
  async getSignedUrl(
    storageKey: string,
    expiresInSeconds = 3600,
    httpMethod: 'GET' | 'PUT' = 'GET',
  ): Promise<string> {
    const date = new Date();
    const dateStamp = date.toISOString().replace(/[:-]|\.\d{3}/g, '').substring(0, 8);
    const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, '').substring(0, 15) + 'Z';

    const cleanEndpoint = this.config.endpoint.replace(/\/$/, '');
    const path = `/${this.config.bucket}/${encodeURIComponent(storageKey).replace(/%2F/g, '/')}`;
    const host = new URL(cleanEndpoint).host;

    const credentialScope = `${dateStamp}/${this.config.region}/s3/aws4_request`;

    const queryParams: Record<string, string> = {
      'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
      'X-Amz-Credential': `${this.config.accessKeyId}/${credentialScope}`,
      'X-Amz-Date': amzDate,
      'X-Amz-Expires': String(expiresInSeconds),
      'X-Amz-SignedHeaders': 'host',
    };

    const sortedQuery = Object.keys(queryParams)
      .sort()
      .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(queryParams[k])}`)
      .join('&');

    const canonicalRequest = [
      httpMethod,
      path,
      sortedQuery,
      `host:${host}\n`,
      'host',
      'UNSIGNED-PAYLOAD',
    ].join('\n');

    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      credentialScope,
      createHash('sha256').update(canonicalRequest).digest('hex'),
    ].join('\n');

    const kDate = createHmac('sha256', 'AWS4' + this.config.secretAccessKey).update(dateStamp).digest();
    const kRegion = createHmac('sha256', kDate).update(this.config.region).digest();
    const kService = createHmac('sha256', kRegion).update('s3').digest();
    const kSigning = createHmac('sha256', kService).update('aws4_request').digest();
    const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');

    return `${cleanEndpoint}${path}?${sortedQuery}&X-Amz-Signature=${signature}`;
  }
}
