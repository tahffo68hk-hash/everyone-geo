import type { CookieOptions, Response } from "express";
import { AUTH_COOKIE_NAME } from "../config/env";

/**
 * 认证 Cookie 策略（AUTH-001 / D-013）：
 * - httpOnly：JS 不可读，防 XSS 窃取
 * - sameSite=lax：跨站写 Cookie 被拒，CSRF 面收敛
 * - secure：生产强制 HTTPS；本地开发 http 不开启
 * - path=/：全站可用
 */
export function authCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7d
  };
}

export function setAuthCookie(res: Response, token: string): void {
  res.cookie(AUTH_COOKIE_NAME, token, authCookieOptions());
}

export function clearAuthCookie(res: Response): void {
  res.clearCookie(AUTH_COOKIE_NAME, {
    ...authCookieOptions(),
    maxAge: undefined,
  });
}
