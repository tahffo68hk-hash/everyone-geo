import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/** 与后端 apps/api/src/config/env.ts 的 AUTH_COOKIE_NAME 保持同步 */
const AUTH_COOKIE = "geolens_token";
const PROTECTED_PREFIX = "/app";
const AUTH_PAGES = ["/login", "/register"];

/**
 * M3 路由守卫（轻量层）：
 * - 访问 /app 但无会话 Cookie → 重定向 /login
 * - 已登录用户访问 /login|/register → 重定向 /app
 * 真正的鉴权由后端 /auth/me 完成；此处仅做体验层拦截。
 */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const token = req.cookies.get(AUTH_COOKIE)?.value;

  if (pathname.startsWith(PROTECTED_PREFIX) && !token) {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  if (AUTH_PAGES.includes(pathname) && token) {
    return NextResponse.redirect(new URL("/app", req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/app/:path*", "/login", "/register"],
};
