export type ConnectorErrorCode =
  | 'AUTH_EXPIRED'
  | 'AUTH_REVOKED'
  | 'SCOPE_MISSING'
  | 'CONTENT_INVALID'
  | 'ASSET_INVALID'
  | 'RATE_LIMITED'
  | 'PLATFORM_REJECTED'
  | 'PLATFORM_UNAVAILABLE'
  | 'UNKNOWN';

export class ConnectorError extends Error {
  constructor(
    public readonly code: ConnectorErrorCode,
    public readonly safeMessage: string,
    public readonly httpStatus?: number,
    public readonly retryable: boolean = false,
    public readonly details?: Record<string, unknown>,
  ) {
    super(safeMessage);
    this.name = 'ConnectorError';
  }
}

/** 规范化外部 HTTP 响应错误，过滤敏感信息并判定重试属性。 */
export function normalizeHttpError(
  status: number,
  body: unknown,
  fallbackMessage = 'Platform error',
): ConnectorError {
  const safeBody = sanitizeErrorPayload(body);
  const rawMsg = typeof safeBody === 'object' && safeBody !== null
    ? (safeBody as any).message || (safeBody as any).error || JSON.stringify(safeBody)
    : String(body || fallbackMessage);

  if (status === 401) {
    return new ConnectorError('AUTH_EXPIRED', `Authentication expired or invalid: ${rawMsg}`, 401, false, safeBody);
  }
  if (status === 403) {
    return new ConnectorError('SCOPE_MISSING', `Permission or scope missing: ${rawMsg}`, 403, false, safeBody);
  }
  if (status === 429) {
    return new ConnectorError('RATE_LIMITED', `Rate limit exceeded: ${rawMsg}`, 429, true, safeBody);
  }
  if (status === 400 || status === 422) {
    return new ConnectorError('CONTENT_INVALID', `Content rejected by platform: ${rawMsg}`, status, false, safeBody);
  }
  if (status >= 500 && status <= 599) {
    return new ConnectorError('PLATFORM_UNAVAILABLE', `Platform service temporarily unavailable: ${rawMsg}`, status, true, safeBody);
  }

  return new ConnectorError('PLATFORM_REJECTED', `Platform rejected request: ${rawMsg}`, status, false, safeBody);
}

/** 过滤错误载荷中的敏感凭证（如 access_token, refresh_token, secret 等）。 */
export function sanitizeErrorPayload(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== 'object') {
    return { error: String(payload ?? 'Unknown error') };
  }
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    const lower = key.toLowerCase();
    if (
      lower.includes('token') ||
      lower.includes('secret') ||
      lower.includes('password') ||
      lower.includes('authorization') ||
      lower.includes('key')
    ) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeErrorPayload(value);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}
