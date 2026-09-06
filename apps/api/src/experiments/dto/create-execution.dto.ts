import { IsIn, IsISO8601, IsOptional, IsString, MaxLength } from "class-validator";

export const EXECUTION_TYPES = [
  "MANUAL_CONTENT_UPDATE", "MANUAL_PAGE_CREATE", "MANUAL_FAQ_UPDATE",
  "MANUAL_DOCUMENTATION_UPDATE", "MANUAL_OTHER",
] as const;

export class CreateExecutionDto {
  @IsString()
  @IsIn(EXECUTION_TYPES as unknown as string[])
  executionType: string;

  @IsString()
  @MaxLength(2000)
  changeSummary: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  assetType?: string;

  /** 用户记录的 URL / 页面标识（本系统不 fetch、不验证）。 */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  assetReference?: string;

  @IsISO8601()
  executedAt: string;
}
