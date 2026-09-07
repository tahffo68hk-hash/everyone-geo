import {
  ArrayMaxSize, IsArray, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Length, Max, MaxLength, Min, ValidateNested,
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
