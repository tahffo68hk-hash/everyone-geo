/**
 * WEB-004: callback-only published asset registration candidate.
 * This module is a proposed browser boundary, NOT a server DTO or API mapper.
 */
export interface PublishedAssetFormContext {
  projectId: string;
  draftId: string;
  revisionId: string;
  publicationId?: string;
  title: string;
  platform: string;
}

export interface RegistrationCandidate {
  projectId: string;
  draftId: string;
  revisionId: string;
  publicationId?: string;
  title: string;
  platform: string;
  canonicalUrl?: string;
  externalAssetId?: string;
  verificationStatus: "UNVERIFIED" | "MANUAL_VERIFIED";
  verificationNote?: string;
  actualPublishedAt: string | null;
  userConfirmed: boolean;
}

export type RegistrationValidation =
  | { ok: true; value: RegistrationCandidate }
  | { ok: false; errors: Partial<Record<keyof RegistrationCandidate, string>> };

type CandidateKey = keyof RegistrationCandidate;
type ValidationErrors = Partial<Record<CandidateKey, string>>;

function trimmed(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function checkRequiredText(
  key: CandidateKey,
  value: unknown,
  label: string,
  maximum: number,
  errors: ValidationErrors,
): string {
  const result = trimmed(value);
  if (!result) errors[key] = `请填写${label}`;
  else if (Array.from(result).length > maximum) errors[key] = `${label}不能超过 ${maximum} 个字符`;
  return result;
}

/** Conservative UI-only checks against obviously synthetic and local URLs. */
function isSyntheticOrLocalUrl(url: URL): boolean {
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  const localHost =
    host === "localhost" ||
    host.startsWith("localhost.") ||
    host.endsWith(".localhost") ||
    host === "0.0.0.0" ||
    host === "[::]" ||
    host === "[::1]" ||
    /^127(?:\.\d{1,3}){3}$/.test(host) ||
    /^\[::ffff:(?:7f[0-9a-f]{2}|127\.)/i.test(host);
  if (localHost || /(?:mock|fake)/i.test(host)) return true;

  // Check synthetic tokens in host, path, search or fragment, including mock_123/fake-123.
  // Decode once to catch simple %-encoded markers; malformed encoding is handled safely.
  let searchable = `${host}${url.pathname}${url.search}${url.hash}`.toLowerCase();
  try {
    searchable = decodeURIComponent(searchable);
  } catch {
    return true;
  }
  return /(?:^|[\/.?#&=_:\-])(?:mock|fake)(?=$|[\/.?#&=_:\-])/i.test(searchable);
}

function checkUrl(value: string): string | null {
  if (Array.from(value).length > 1024) return "发布链接不能超过 1024 个字符";
  try {
    // Require explicit scheme; URL() with a base would silently accept relative paths.
    if (!/^https?:\/\//i.test(value)) return "请输入以 http:// 或 https:// 开头的完整链接";
    const parsed = new URL(value);
    const authority = value.slice(value.indexOf("//") + 2).split(/[/?#]/, 1)[0];
    if (authority.includes("@")) return "链接不得包含账户密码或用户信息";
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "仅支持 HTTP/HTTPS 链接";
    if (!parsed.hostname || parsed.username || parsed.password) return "链接不得包含账户密码且必须有主机名";
    if (isSyntheticOrLocalUrl(parsed)) return "不能登记 Mock、Fake、localhost 或 loopback 链接";
    return null;
  } catch {
    return "请输入有效的完整 HTTP/HTTPS 链接";
  }
}

/**
 * Parse a timezone-explicit ISO date-time with round-trip calendar validation.
 * No implicit local timezone, Date.now(), or network lookups.
 */
function parseZonedIsoDateTime(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute, second = "00", , zone] = match;
  const numbers = [year, month, day, hour, minute, second].map(Number);
  const [y, mo, d, h, mi, s] = numbers;
  if (y === 0 || mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;

  let offsetMinutes = 0;
  if (zone !== "Z") {
    const tzHour = Number(zone.slice(1, 3));
    const tzMinute = Number(zone.slice(4, 6));
    if (tzHour > 23 || tzMinute > 59) return null;
    offsetMinutes = (zone[0] === "+" ? 1 : -1) * (tzHour * 60 + tzMinute);
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  const localView = new Date(timestamp + offsetMinutes * 60_000);
  if (!Number.isFinite(localView.getTime())) return null;
  const datePart = localView.toISOString().slice(0, 19);
  const expected = `${year}-${month}-${day}T${hour}:${minute}:${second}`;
  return datePart === expected ? timestamp : null;
}

/** Validates and returns a trimmed, canonical candidate; does not perform authorization. */
export function validateRegistrationCandidate(
  value: RegistrationCandidate,
  now: Date,
): RegistrationValidation {
  const errors: ValidationErrors = {};
  const projectId = checkRequiredText("projectId", value.projectId, "项目 ID", 256, errors);
  const draftId = checkRequiredText("draftId", value.draftId, "草稿 ID", 256, errors);
  const revisionId = checkRequiredText("revisionId", value.revisionId, "版本 ID", 256, errors);
  const publicationId = trimmed(value.publicationId);
  if (publicationId && Array.from(publicationId).length > 256) errors.publicationId = "发布记录 ID 不能超过 256 个字符";

  const title = checkRequiredText("title", value.title, "资产标题", 256, errors);
  const platform = checkRequiredText("platform", value.platform, "发布平台", 64, errors);
  const canonicalUrl = trimmed(value.canonicalUrl);
  const externalAssetId = trimmed(value.externalAssetId);
  const verificationNote = trimmed(value.verificationNote);

  if (canonicalUrl) {
    const urlError = checkUrl(canonicalUrl);
    if (urlError) errors.canonicalUrl = urlError;
  }
  if (Array.from(externalAssetId).length > 256) errors.externalAssetId = "外部资产 ID 不能超过 256 个字符";
  else if (/^(?:mock|fake)(?:$|[-_])/i.test(externalAssetId)) errors.externalAssetId = "外部资产 ID 不能使用 Mock/Fake 标识";
  if (Array.from(verificationNote).length > 2000) errors.verificationNote = "核验说明不能超过 2000 个字符";

  const isManual = value.verificationStatus === "MANUAL_VERIFIED";
  if (!isManual && value.verificationStatus !== "UNVERIFIED") {
    errors.verificationStatus = "只能选择未核验或人工核验";
  }
  if (isManual && !canonicalUrl && !externalAssetId) {
    errors.canonicalUrl = "人工核验至少填写发布链接或外部资产 ID";
    errors.externalAssetId = "人工核验至少填写发布链接或外部资产 ID";
  }
  if (isManual && !verificationNote) errors.verificationNote = "人工核验必须填写核验说明";

  let actualPublishedAt: string | null = null;
  if (value.actualPublishedAt !== null && typeof value.actualPublishedAt !== "string") {
    errors.actualPublishedAt = "实际发布时间必须是包含时区的 ISO 字符串或未知";
  } else {
    actualPublishedAt = trimmed(value.actualPublishedAt) || null;
  }

  if (isManual && !actualPublishedAt) {
    errors.actualPublishedAt = "人工核验必须填写带明确时区的实际发布时间";
  }
  if (actualPublishedAt !== null) {
    const timestamp = parseZonedIsoDateTime(actualPublishedAt);
    if (timestamp === null) errors.actualPublishedAt = "请输入有效的 ISO 时间并明确时区（如 2026-10-10T15:30:00+08:00）";
    else if (!Number.isFinite(now.getTime())) errors.actualPublishedAt = "校验基准时间无效，不能提交";
    else if (timestamp > now.getTime()) errors.actualPublishedAt = "实际发布时间不能晚于当前校验时刻";
  } else if (!Number.isFinite(now.getTime())) {
    errors.actualPublishedAt = "校验基准时间无效，不能提交";
  }

  if (value.userConfirmed !== true) errors.userConfirmed = "请先确认资产信息及项目归属";
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      projectId,
      draftId,
      revisionId,
      ...(publicationId ? { publicationId } : {}),
      title,
      platform,
      ...(canonicalUrl ? { canonicalUrl } : {}),
      ...(externalAssetId ? { externalAssetId } : {}),
      verificationStatus: value.verificationStatus,
      ...(verificationNote ? { verificationNote } : {}),
      actualPublishedAt,
      userConfirmed: true,
    },
  };
}
