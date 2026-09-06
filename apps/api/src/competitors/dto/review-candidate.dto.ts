import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, Length, Matches } from "class-validator";

/** 人工可选的竞争类型（评审时必须显式选择；UNKNOWN/NON_COMPETITOR 不可手动指定）。 */
export const REVIEW_COMPETITOR_TYPES = ["DIRECT", "ADJACENT", "SUBSTITUTE"] as const;

export class ReviewCandidateDto {
  /** APPROVED / REJECTED。不允许经 API 设回 DISCOVERED（只能人工评审推进）。 */
  @IsOptional()
  @IsIn(["APPROVED", "REJECTED"], { message: "status 仅允许 APPROVED 或 REJECTED" })
  status?: "APPROVED" | "REJECTED";

  /** Approve 时必须显式提供 DIRECT/ADJACENT/SUBSTITUTE（不得自动猜测）。 */
  @IsOptional()
  @IsIn([...REVIEW_COMPETITOR_TYPES, "NON_COMPETITOR"], { message: "competitorType 非法" })
  competitorType?: "DIRECT" | "ADJACENT" | "SUBSTITUTE" | "NON_COMPETITOR";

  @IsOptional()
  @IsString()
  @Length(1, 120)
  @Matches(/^[^\s].*[^\s]$|^[^\s]$/, { message: "canonicalName 不能为空且首尾不能为空白" })
  canonicalName?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @Length(1, 120, { each: true })
  aliases?: string[];
}
