import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
} from "class-validator";

/** 与 packages/database/scripts/benchmark-queries.ts 的 BenchmarkCategory 保持一致。 */
export const BENCHMARK_CATEGORIES = [
  "tool-discovery",
  "comparison",
  "workflow",
  "recommendation",
  "pain-point",
  "competition",
  "sanity-control",
] as const;

export class BenchmarkQueryDto {
  @IsString()
  @Length(1, 500)
  queryText!: string;

  @IsIn(BENCHMARK_CATEGORIES)
  category!: string;

  @IsString()
  @Length(1, 200)
  intent!: string;

  @IsOptional()
  @IsString()
  @Length(2, 16)
  locale?: string;

  @IsOptional()
  @IsNumber()
  @Min(0.1)
  @Max(100)
  weight?: number;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  sanity?: boolean;

  // ---- M8E：Query 语义（DISCOVERY=自然可见度主口径 / BRANDED_SANITY=品牌认知测试 / CUSTOM）----
  @IsOptional()
  @IsIn(["DISCOVERY", "BRANDED_SANITY", "CUSTOM"], { message: "queryType 只允许 DISCOVERY / BRANDED_SANITY / CUSTOM" })
  queryType?: string;

  @IsOptional()
  @IsIn(["MANUAL", "BUILDER", "IMPORT", "SEED"], { message: "source 只允许 MANUAL / BUILDER / IMPORT / SEED" })
  source?: string;
}

export class CreateBenchmarkSuiteDto {
  @IsString()
  @Length(1, 120)
  name!: string;

  @IsString()
  @Matches(/^[0-9A-Za-z][0-9A-Za-z._-]{0,31}$/, {
    message: "version 必须为 1–32 位字母、数字、点、下划线或连字符，且不能以符号开头",
  })
  version!: string;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  description?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => BenchmarkQueryDto)
  queries!: BenchmarkQueryDto[];
}
