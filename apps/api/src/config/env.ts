import * as dotenv from "dotenv";
import * as path from "path";

import * as fs from "fs";

export function ensureEnvLoaded(): void {
  const candidates = [
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "../../.env"),
    path.resolve(__dirname, "../../.env"),
    path.resolve(__dirname, "../../../.env"),
    path.resolve(__dirname, "../../../../.env"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      dotenv.config({ path: candidate });
      break;
    }
  }
}

ensureEnvLoaded();

/** JWT 签名密钥：缺失或过短时拒绝启动（fail-fast）。 */
export function getJwtSecret(): string {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 16) {
    throw new Error(
      "ConfigurationError: JWT_SECRET 未配置或长度不足 16。请在仓库根 .env 中设置随机值后重试。",
    );
  }
  return s;
}

/** JWT 过期时长（透传给 @nestjs/jwt 的 signOptions.expiresIn）。 */
export const JWT_EXPIRES_IN =
  process.env.JWT_EXPIRES_IN ?? "7d";

/** 认证会话 Cookie 名（与前端 apps/web/src/middleware.ts 保持同步）。 */
export const AUTH_COOKIE_NAME = "geolens_token";
