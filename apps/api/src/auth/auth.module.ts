import { Global, Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { getJwtSecret, JWT_EXPIRES_IN } from "../config/env";
import { AuthGuard } from "../common/auth.guard";
import { TenantService } from "../common/tenant.service";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";

/**
 * AuthModule：JWT 签发/校验、认证守卫、租户访问控制。
 * 标记为 Global，使全 API 可直接注入 JwtService / 使用 AuthGuard / TenantService。
 */
@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      global: true,
      useFactory: () => ({
        secret: getJwtSecret(),
        signOptions: { algorithm: "HS256" },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, AuthGuard, TenantService],
  exports: [JwtModule, AuthGuard, TenantService],
})
export class AuthModule {}
