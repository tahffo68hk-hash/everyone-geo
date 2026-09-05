/**
 * Classifiable provider errors.
 *
 * Providers do NOT retry internally; they classify failures so the caller
 * (Worker / BullMQ) can decide:
 *   retryable   - timeout / rate_limit / server / network / mock_failure
 *   permanent   - auth / bad_request / disabled / not_configured /
 *                 empty_response / invalid_response / invalid_config
 *
 * Messages must never contain secrets (API keys, Authorization headers).
 */

export type ProviderErrorKind =
  | 'invalid_config'
  | 'mock_failure'
  | 'timeout'
  | 'rate_limit'
  | 'server'
  | 'network'
  | 'auth'
  | 'bad_request'
  | 'disabled'
  | 'not_configured'
  | 'empty_response'
  | 'invalid_response';

const retryable = new Set<ProviderErrorKind>(['timeout', 'rate_limit', 'server', 'network', 'mock_failure']);

export function isRetryableProviderError(kind: ProviderErrorKind): boolean {
  return retryable.has(kind);
}

/** User-safe message: never embed keys, tokens or raw provider payloads. */
export class LLMProviderError extends Error {
  constructor(
    public readonly kind: ProviderErrorKind,
    message: string,
    public readonly httpStatus?: number,
  ) {
    super(message);
    this.name = 'LLMProviderError';
  }
}

export const providerErrorMessage = (kind: ProviderErrorKind): string => {
  switch (kind) {
    case 'invalid_config': return 'Provider engine configuration is invalid.';
    case 'mock_failure': return 'Mock engine returned a simulated failure.';
    case 'timeout': return 'Provider request timed out.';
    case 'rate_limit': return 'Provider rate limit reached; retry later.';
    case 'server': return 'Provider server error; retry later.';
    case 'network': return 'Provider network error; retry later.';
    case 'auth': return 'Provider authentication failed (API key rejected).';
    case 'bad_request': return 'Provider rejected the request as invalid.';
    case 'disabled': return 'Real providers are disabled on this server.';
    case 'not_configured': return 'Provider is not configured (API key missing).';
    case 'empty_response': return 'Provider returned an empty response.';
    case 'invalid_response': return 'Provider returned a malformed response.';
    default: return 'Provider execution failed.';
  }
};

export class ProviderTimeoutError extends LLMProviderError {
  constructor() { super('timeout', providerErrorMessage('timeout')); this.name = 'ProviderTimeoutError'; }
}
export class ProviderAuthError extends LLMProviderError {
  constructor(httpStatus: number) { super('auth', providerErrorMessage('auth'), httpStatus); this.name = 'ProviderAuthError'; }
}
export class ProviderRateLimitError extends LLMProviderError {
  constructor(httpStatus: number) { super('rate_limit', providerErrorMessage('rate_limit'), httpStatus); this.name = 'ProviderRateLimitError'; }
}
export class ProviderServerError extends LLMProviderError {
  constructor(httpStatus: number) { super('server', providerErrorMessage('server'), httpStatus); this.name = 'ProviderServerError'; }
}
export class ProviderBadRequestError extends LLMProviderError {
  constructor(httpStatus: number) { super('bad_request', providerErrorMessage('bad_request'), httpStatus); this.name = 'ProviderBadRequestError'; }
}
export class ProviderDisabledError extends LLMProviderError {
  constructor() { super('disabled', providerErrorMessage('disabled')); this.name = 'ProviderDisabledError'; }
}
export class ProviderNotConfiguredError extends LLMProviderError {
  constructor() { super('not_configured', providerErrorMessage('not_configured')); this.name = 'ProviderNotConfiguredError'; }
}
export class ProviderEmptyResponseError extends LLMProviderError {
  constructor() { super('empty_response', providerErrorMessage('empty_response')); this.name = 'ProviderEmptyResponseError'; }
}
export class ProviderInvalidResponseError extends LLMProviderError {
  constructor() { super('invalid_response', providerErrorMessage('invalid_response')); this.name = 'ProviderInvalidResponseError'; }
}
export class ProviderConfigError extends LLMProviderError {
  constructor() { super('invalid_config', providerErrorMessage('invalid_config')); this.name = 'ProviderConfigError'; }
}
export class ProviderMockFailureError extends LLMProviderError {
  constructor() { super('mock_failure', providerErrorMessage('mock_failure')); this.name = 'ProviderMockFailureError'; }
}
export class ProviderNetworkError extends LLMProviderError {
  constructor() { super('network', providerErrorMessage('network')); this.name = 'ProviderNetworkError'; }
}
