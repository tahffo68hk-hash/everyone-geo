import { IsOptional, IsString, Length, MaxLength } from "class-validator";

/**
 * POST /organizations/:organizationId/projects —— 通用 GEO 监测项目创建。
 * 仅最小字段集；创建后 Project 无 Target（品牌为空），后续由监测对象/问题集向导补齐。
 * 禁止任何 seed/默认品牌写死（绝无 ProjectMentor）。
 */
export class CreateProjectDto {
  @IsString()
  @Length(1, 120, { message: "项目名称必须为 1–120 字符" })
  name!: string;

  @IsOptional()
  @IsString()
  @Length(0, 2000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  industry?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  region?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  targetAudience?: string;
}
