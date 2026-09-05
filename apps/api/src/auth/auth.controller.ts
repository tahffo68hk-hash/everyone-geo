import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import { AuthGuard, JwtUserPayload } from "../common/auth.guard";
import { clearAuthCookie, setAuthCookie } from "../common/cookie.utils";
import { CurrentUser } from "../common/current-user.decorator";
import { AuthService } from "./auth.service";
import { LoginDto } from "./dto/login.dto";
import { RegisterDto } from "./dto/register.dto";

/**
 * 认证端点。
 * 会话通过 HttpOnly Cookie 传递；body 同时回传 accessToken 便于无浏览器客户端与测试使用。
 */
@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post("register")
  @HttpCode(201)
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.register(dto);
    setAuthCookie(res, result.accessToken);
    return {
      user: result.user,
      organization: result.organization,
      accessToken: result.accessToken,
    };
  }

  @Post("login")
  @HttpCode(200)
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.login(dto);
    setAuthCookie(res, result.accessToken);
    return { user: result.user, accessToken: result.accessToken };
  }

  @Post("logout")
  @HttpCode(200)
  @UseGuards(AuthGuard)
  logout(@Res({ passthrough: true }) res: Response) {
    clearAuthCookie(res);
    return { ok: true };
  }

  @Get("me")
  @UseGuards(AuthGuard)
  me(@CurrentUser() user?: JwtUserPayload) {
    return this.auth.me(user!.sub);
  }
}
