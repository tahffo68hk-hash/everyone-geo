import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Channel } from '@geo/database';

/**
 * OAuth State 安全管理器（PHASE 12 · OAuth State Security）。
 *
 * 核心保证：
 *   - 防止 CSRF（随机 nonce + HMAC 签名）。
 *   - 租户/项目强绑定：organizationId & projectId 封装于经过防篡改签名的 state 中。
 *   - Callback 不能由外部指定租户，必须从已验证的 state 恢复。
 *   - 严格时效（默认 10 分钟）。
 *   - 校验回调地址匹配。
 */

export interface OAuthStatePayload {
  stateId: string;
  organizationId: string;
  projectId: string;
  channel: Channel;
  redirectUri: string;
  createdAt: number;
  nonce: string;
}

export class OAuthStateSecurity {
  private readonly signingSecret: string;
  private readonly maxAgeMs: number;

  constructor(signingSecret?: string, maxAgeMs = 10 * 60 * 1000) {
    this.signingSecret = signingSecret || process.env.JWT_SECRET || 'dev-oauth-state-signing-secret-geolens-2026';
    this.maxAgeMs = maxAgeMs;
  }

  /** 生成防篡改的 signed state 字符串。 */
  generateState(params: {
    organizationId: string;
    projectId: string;
    channel: Channel;
    redirectUri: string;
  }): string {
    const payload: OAuthStatePayload = {
      stateId: randomBytes(16).toString('hex'),
      organizationId: params.organizationId,
      projectId: params.projectId,
      channel: params.channel,
      redirectUri: params.redirectUri,
      createdAt: Date.now(),
      nonce: randomBytes(8).toString('hex'),
    };

    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = this.sign(encoded);
    return `${encoded}.${signature}`;
  }

  /** 验证 state，返回恢复出的租户/项目上下文，非法或过期时抛错。 */
  verifyState(state: string, expectedRedirectUri?: string): OAuthStatePayload {
    if (!state || !state.includes('.')) {
      throw new Error('INVALID_OAUTH_STATE_FORMAT');
    }

    const [encoded, signature] = state.split('.');
    const expectedSig = this.sign(encoded);

    const sigBuf = Buffer.from(signature, 'utf8');
    const expBuf = Buffer.from(expectedSig, 'utf8');

    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
      throw new Error('OAUTH_STATE_SIGNATURE_MISMATCH');
    }

    let payload: OAuthStatePayload;
    try {
      payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    } catch {
      throw new Error('INVALID_OAUTH_STATE_PAYLOAD');
    }

    const now = Date.now();
    if (now - payload.createdAt > this.maxAgeMs) {
      throw new Error('OAUTH_STATE_EXPIRED');
    }

    if (expectedRedirectUri && payload.redirectUri !== expectedRedirectUri) {
      throw new Error('REDIRECT_URI_MISMATCH');
    }

    return payload;
  }

  private sign(data: string): string {
    return createHmac('sha256', this.signingSecret).update(data).digest('base64url');
  }
}

export const defaultOAuthStateSecurity = new OAuthStateSecurity();
