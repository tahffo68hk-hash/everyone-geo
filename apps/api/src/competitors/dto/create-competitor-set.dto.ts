import { Type } from "class-transformer";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Min, ValidateNested } from "class-validator";

export class CompetitorSetEntryInputDto {
  /** 已 APPROVED 的候选 id（加入集合时快照其 canonicalName/aliases/competitorType）。 */
  @IsUUID()
  candidateId!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class CreateCompetitorSetDto {
  @IsString()
  @Length(1, 120)
  name!: string;

  @IsString()
  @Matches(/^[0-9A-Za-z][0-9A-Za-z._-]{0,31}$/, {
    message: "version 必须为 1–32 位字母、数字、点、下划线或连字符，且不能以符号开头",
  })
  version!: string;

  /**
   * 可选：显式指定条目（候选必须 APPROVED）。
   * 缺省 = 当前项目全部 APPROVED 候选快照（UI 默认「从当前已批准候选生成 vN」）。
   */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CompetitorSetEntryInputDto)
  entries?: CompetitorSetEntryInputDto[];
}
