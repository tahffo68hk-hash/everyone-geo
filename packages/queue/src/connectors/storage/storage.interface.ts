export interface StoredAssetMetadata {
  storageRef: string;
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string; // sha256 hex
  publicUrl?: string;
  adapter: 'dev-local' | 's3-compatible';
}

export interface ContentStorageAdapter {
  readonly adapterType: 'dev-local' | 's3-compatible';

  put(
    organizationId: string,
    bytes: Buffer,
    mimeType: string,
    filename?: string,
  ): Promise<StoredAssetMetadata>;

  get(storageKey: string): Promise<Buffer>;

  getSignedUrl(storageKey: string, expiresInSeconds?: number): Promise<string>;
}
