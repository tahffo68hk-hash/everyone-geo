import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { StoredCredential } from '../types';

/**
 * 安全凭证库（PHASE 10 · Credential Vault）。
 *
 * 核心安全保证：
 *   - 数据库只保留 credentialRef（如 vault://aes256gcm/wordpress/<id>），绝无明文 token/secret。
 *   - 使用 AES-256-GCM 认证加密。
 *   - Master key 来自环境变量 CREDENTIAL_VAULT_KEY（或由 JWT_SECRET 导出），绝不进数据库。
 *   - 凭证不进入 API response、Log、Audit Log、Evidence。
 */

export interface EncryptedPayload {
  iv: string;
  tag: string;
  ciphertext: string;
}

export class CredentialVault {
  private readonly masterKey: Buffer;
  // DEV_ONLY 本地加密凭证存储映射（在未接入外部 Vault / KMS 时使用内存隔离加密存储）
  private static readonly memoryVault = new Map<string, EncryptedPayload>();

  constructor(customKey?: string) {
    const rawKey = customKey || process.env.CREDENTIAL_VAULT_KEY || process.env.JWT_SECRET || 'dev-geolens-vault-master-key-2026-safe-fallback';
    this.masterKey = createHash('sha256').update(rawKey).digest();
  }

  /** 加密任意 JSON 结构。 */
  encrypt(plainObject: Record<string, unknown>): EncryptedPayload {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.masterKey, iv);
    const serialized = JSON.stringify(plainObject);
    let ciphertext = cipher.update(serialized, 'utf8', 'hex');
    ciphertext += cipher.final('hex');
    const tag = cipher.getAuthTag().toString('hex');
    return {
      iv: iv.toString('hex'),
      tag,
      ciphertext,
    };
  }

  /** 解密载荷。 */
  decrypt(payload: EncryptedPayload): Record<string, unknown> {
    const decipher = createDecipheriv('aes-256-gcm', this.masterKey, Buffer.from(payload.iv, 'hex'));
    decipher.setAuthTag(Buffer.from(payload.tag, 'hex'));
    let decrypted = decipher.update(payload.ciphertext, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return JSON.parse(decrypted);
  }

  /** 存储凭证，返回安全的 credentialRef。 */
  storeCredential(channel: string, id: string, credential: StoredCredential): string {
    const ref = `vault://aes256gcm/${channel.toLowerCase()}/${id}`;
    const encrypted = this.encrypt({ ...credential, credentialRef: ref });
    CredentialVault.memoryVault.set(ref, encrypted);
    return ref;
  }

  /** 读取并解密凭证。如果不存在返回 null。 */
  getCredential(credentialRef: string): StoredCredential | null {
    const payload = CredentialVault.memoryVault.get(credentialRef);
    if (!payload) return null;
    try {
      const data = this.decrypt(payload);
      return data as unknown as StoredCredential;
    } catch {
      return null;
    }
  }

  /** 删除凭证。 */
  deleteCredential(credentialRef: string): boolean {
    return CredentialVault.memoryVault.delete(credentialRef);
  }

  /** 过滤敏感字段，生成适合日志或 API 展示的安全展示视图（所有敏感字段被脱敏）。 */
  static redact(cred?: StoredCredential | null): Record<string, unknown> {
    if (!cred) return {};
    return {
      credentialRef: cred.credentialRef,
      hasApiKey: Boolean(cred.apiKey),
      hasAccessToken: Boolean(cred.accessToken),
      hasRefreshToken: Boolean(cred.refreshToken),
      tokenExpiresAt: cred.tokenExpiresAt ?? null,
      baseUrl: cred.baseUrl ?? null,
      username: cred.username ?? null,
      chatId: cred.chatId ?? null,
      channelId: cred.channelId ?? null,
      scopes: cred.scopes ?? [],
    };
  }
}

export const defaultCredentialVault = new CredentialVault();
