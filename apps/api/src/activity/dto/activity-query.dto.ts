import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from "class-validator";

export class ActivityQueryDto {
  @IsOptional()
  @IsUUID("4")
  projectId?: string;

  @IsOptional()
  @IsIn(["MONITOR", "BENCHMARK", "MANUAL", "EXPERIMENT", "RETEST"], {
    message: "未知任务类型",
  })
  type?: "MONITOR" | "BENCHMARK" | "MANUAL" | "EXPERIMENT" | "RETEST";

  @IsOptional()
  @IsString()
  @MaxLength(40)
  status?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}
