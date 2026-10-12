/**
 * PublishedAsset 的对外发布时间锚点。
 *
 * `publishedAt` 列非空且默认 now()，LOC-002 之后真实时间以 `actualPublishedAt` 为准；
 * 当 `publicationTimeSource === "UNKNOWN"` 时 `publishedAt` 只是落库时刻，不能作为发布前/后分界。
 * LOC-002 之前的历史资产（publicationTimeSource 为空）保留 `publishedAt` 兜底语义。
 */
export function resolvePublicationAnchor(asset: {
  actualPublishedAt?: Date | string | null;
  publishedAt?: Date | string | null;
  publicationTimeSource?: string | null;
}): Date | null {
  if (asset.actualPublishedAt) return new Date(asset.actualPublishedAt);
  if (asset.publicationTimeSource === "UNKNOWN") return null;
  return asset.publishedAt ? new Date(asset.publishedAt) : null;
}
