import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import type { JwtUserPayload } from "./auth.guard";

/**
 * 从请求上下文读取当前登录用户（由 AuthGuard 写入 request.user）。
 * 用法：@CurrentUser() user: JwtUserPayload
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): JwtUserPayload | undefined => {
    const req = ctx.switchToHttp().getRequest<{ user?: JwtUserPayload }>();
    return req.user;
  },
);
