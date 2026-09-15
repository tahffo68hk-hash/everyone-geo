import {
  ArrayMaxSize, IsArray, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID,
  Length, Max, MaxLength, Min, ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";

export class UpsertTargetDto {
  @IsString()
  @Length(1, 120)
  canonicalName!: string;

  @IsOptional()
  @IsIn(["BRAND", "PRODUCT", "SERVICE", "ORGANIZATION", "OTHER"])
  entityType?: string;

  @IsOptional()
  @IsString()
  @Length(0, 200)
  productCategory?: string | null;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  website?: string | null;

  @IsOptional()
  @IsString()
  @Length(0, 2000)
  description?: string | null;
}

export class AddAliasDto {
  @IsString()
  @Length(1, 120)
  alias!: string;

  @IsOptional()
  @IsIn(["OFFICIAL", "PRODUCT", "ABBREVIATION", "LOCALIZED", "CUSTOM"])
  aliasType?: string;
}

export class UpdateAliasDto {
  @IsOptional()
  @IsIn(["OFFICIAL", "PRODUCT", "ABBREVIATION", "LOCALIZED", "CUSTOM"])
  aliasType?: string;

  @IsOptional()
  @Type(() => Boolean)
  enabled?: boolean;

  @IsOptional()
  @IsString()
  @Length(1, 120)
  alias?: string;
}

export class BuilderPreviewDto {
  @IsString()
  @Length(1, 200)
  category!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @IsString({ each: true })
  scenario?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @IsIn(["RECOMMEND", "HOW_TO", "COMPARE", "PROBLEM_SOLVING", "INFORMATIONAL"], { each: true })
  intents?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  audience?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  modifiers?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  custom?: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  cap?: number;
}

export class ImportPreviewDto {
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  lines!: string[];
}

class SaveRowDto {
  @IsString()
  @Length(1, 500)
  text!: string;

  @IsOptional()
  @IsString()
  @Length(1, 120)
  category?: string;

  @IsOptional()
  @IsString()
  @Length(1, 200)
  intent?: string;

  @IsIn(["DISCOVERY", "BRANDED_SANITY", "CUSTOM"])
  queryType!: "DISCOVERY" | "BRANDED_SANITY" | "CUSTOM";

  @IsOptional()
  @IsString()
  @Length(2, 16)
  locale?: string;

  @IsOptional()
  @Type(() => Boolean)
  enabled?: boolean;
}

export class SaveQueriesDto {
  @IsArray()
  @ArrayMaxSize(300)
  @ValidateNested({ each: true })
  @Type(() => SaveRowDto)
  rows!: SaveRowDto[];
}

export class CloneSuiteDto {
  @IsString()
  @Length(1, 32)
  @IsNotEmpty()
  version!: string;
}

/**
 * R2 · Query 表格查询（服务端分页 / 搜索 / 筛选 / 排序）。
 * 全部为可选条件；服务端重新校验 tenant + project + suite ownership，
 * 不信任前端传入的过滤范围。
 */
export class QueryListDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  @IsOptional()
  @IsIn(["enabled", "disabled"])
  status?: "enabled" | "disabled";

  @IsOptional()
  @IsIn(["DISCOVERY", "BRANDED_SANITY", "CUSTOM"])
  type?: "DISCOVERY" | "BRANDED_SANITY" | "CUSTOM";

  @IsOptional()
  @IsIn(["CLEAN", "TARGET_MENTIONED", "POSSIBLE_TARGET_MENTION"])
  contamination?: "CLEAN" | "TARGET_MENTIONED" | "POSSIBLE_TARGET_MENTION";

  @IsOptional()
  @IsIn(["createdAt", "queryText", "queryType", "status"])
  sort?: "createdAt" | "queryText" | "queryType" | "status";

  @IsOptional()
  @IsIn(["asc", "desc"])
  order?: "asc" | "desc";

  @IsOptional()
  @IsUUID("4")
  suiteId?: string;

  @IsOptional()
  @Type(() => Boolean)
  archived?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number;
}

/**
 * R2 · Query 批量操作。
 * operation = enable | disable | archive | move；move 需 targetSuiteId。
 * 兼容历史调用：body 含 rows 时退化为原有 saveQueries 语义（批量新增）。
 */
export class BatchQueriesDto {
  @IsOptional()
  @IsIn(["enable", "disable", "archive", "restore", "move"])
  operation?: "enable" | "disable" | "archive" | "restore" | "move";

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1000)
  @IsUUID("4", { each: true })
  queryIds?: string[];

  @IsOptional()
  @IsUUID("4")
  targetSuiteId?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(300)
  @ValidateNested({ each: true })
  @Type(() => SaveRowDto)
  rows?: SaveRowDto[];
}

/**
 * R2 · Cost Preflight（纯占位，不调真实 Provider / 不读价格表）。
 * 支持两种 scope（XOR，同时传 400）：
 *   - suiteId + engineIds + runType：整个 Query Set 预检（后端在 tenant/project 内计数，
 *     enabled=true && archived=false 的 query 才计入，不需要前端枚举 queryIds）。
 *   - queryIds + engineIds + runType：显式 query 列表（历史兼容）。
 * pricing/currency 恒为 null，前端必须显示「暂不可估算」，严禁硬编码任何价格。
 * runType 用于预检语义（demo / real 复用现有 BenchmarkRunType 语义），不引入新状态机。
 */
export class CostPreflightDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1000)
  @IsUUID("4", { each: true })
  queryIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID("4", { each: true })
  engineIds?: string[];

  /**
   * Suite-scoped 预检：suite 必须属于当前 tenant + project；与 queryIds XOR。
   */
  @IsOptional()
  @IsUUID("4")
  suiteId?: string;

  /** 预检运行类型：demo | real（复用现有 BenchmarkRunType 语义）。默认 demo。 */
  @IsOptional()
  @IsIn(["demo", "real"])
  runType?: "demo" | "real";
}
