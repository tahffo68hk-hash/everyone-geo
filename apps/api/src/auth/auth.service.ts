import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { OrgRole, User } from "@prisma/client";
import * as argon2 from "argon2";
import { JWT_EXPIRES_IN } from "../config/env";
import { PrismaService } from "../prisma.service";
import { RegisterDto } from "./dto/register.dto";
import { LoginDto } from "./dto/login.dto";

type SafeUser = {
  id: string;
  email: string;
  name: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * 认证服务：注册 / 登录 / 会话查询。
 * 密码哈希统一使用 Argon2id（参数取 0.45 默认值），认证态用 JWT + HttpOnly Cookie。
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    const email = dto.email.toLowerCase();
    const existing = await this.prisma.client.user.findUnique({
      where: { email },
    });
    if (existing) {
      throw new ConflictException("该邮箱已注册");
    }

    const passwordHash = await argon2.hash(dto.password);
    const orgName = dto.organizationName?.trim() || `${dto.name} 的组织`;

    // 用户 + 默认组织 + OWNER 成员关系在一个事务内完成，杜绝半成品账号。
    const result = await this.prisma.client.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email,
          name: dto.name,
          passwordHash,
          status: "ACTIVE",
        },
      });
      const organization = await tx.organization.create({
        data: {
          name: orgName,
          slug: await this.uniqueSlugFromName(tx as never, orgName),
        },
      });
      await tx.organizationMember.create({
        data: {
          userId: user.id,
          organizationId: organization.id,
          role: OrgRole.OWNER,
        },
      });
      return { user, organization };
    });

    const token = await this.signToken(result.user);
    return {
      accessToken: token,
      user: this.toSafe(result.user),
      organization: result.organization,
    };
  }

  async login(dto: LoginDto) {
    const email = dto.email.toLowerCase();
    const user = await this.prisma.client.user.findUnique({ where: { email } });

    // 统一错误文案，不暴露「邮箱是否存在」。
    if (!user?.passwordHash) {
      throw new UnauthorizedException("邮箱或密码错误");
    }
    const ok = await argon2.verify(user.passwordHash, dto.password);
    if (!ok) {
      throw new UnauthorizedException("邮箱或密码错误");
    }
    if (user.status === "SUSPENDED") {
      throw new ForbiddenException("账号已停用，请联系管理员");
    }

    const token = await this.signToken(user);
    return { accessToken: token, user: this.toSafe(user) };
  }

  /** 会话查询：读取当前用户及其组织（含项目计数）。 */
  async me(userId: string) {
    const user = await this.prisma.client.user.findUnique({
      where: { id: userId },
      include: {
        memberships: {
          include: {
            organization: {
              include: { _count: { select: { projects: true, members: true } } },
            },
          },
        },
      },
    });
    if (!user) {
      throw new UnauthorizedException("用户不存在");
    }
    return {
      user: this.toSafe(user),
      organizations: user.memberships.map((m) => ({
        ...m.organization,
        role: m.role,
      })),
    };
  }

  private signToken(user: { id: string; email: string }): Promise<string> {
    return this.jwt.signAsync(
      { sub: user.id, email: user.email },
      {
        expiresIn: JWT_EXPIRES_IN,
        algorithm: "HS256",
      } as import("@nestjs/jwt").JwtSignOptions,
    );
  }

  private toSafe(user: User): SafeUser {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      status: user.status,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  /** 由组织名生成唯一 slug；冲突时追加短随机后缀重试。 */
  private async uniqueSlugFromName(
    tx: {
      organization: {
        findUnique(args: { where: { slug: string } }): Promise<unknown>;
      };
    },
    name: string,
  ): Promise<string> {
    const base =
      name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
        .replace(/^-+|-+$/g, "") || "org";
    let slug = base;
    for (let i = 0; i < 5; i++) {
      const found = await tx.organization.findUnique({ where: { slug } });
      if (!found) return slug;
      slug = `${base}-${Math.random().toString(36).slice(2, 6)}`;
    }
    throw new Error("配置异常：无法生成唯一组织 slug");
  }
}
