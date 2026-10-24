import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { AUTH_COOKIE_NAME } from "../config/env";

export interface JwtUserPayload {
  /** 用户 UUID */
  sub: string;
  email: string;
  iat?: number;
  exp?: number;
}

/**
 * 认证守卫：从 HttpOnly Cookie 提取 JWT，校验通过后写入 request.user。
 * 认证态完全依赖 Cookie，不信任 Authorization header（防御优先）。
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<
      { cookies?: Record<string, string>; user?: JwtUserPayload }
    >();
    const token = req.cookies?.[AUTH_COOKIE_NAME];
    if (!token) {
      throw new UnauthorizedException("未登录");
    }
    try {
      const payload = await this.jwt.verifyAsync<JwtUserPayload>(token);
      if (!payload?.sub) {
        throw new UnauthorizedException("登录态无效");
      }
      req.user = payload;
      return true;
    } catch {
      throw new UnauthorizedException("登录态无效或已过期");
    }
  }
}
