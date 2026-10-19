import { AiProvider, QuickStartQuestionKind } from "@prisma/client";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from "class-validator";
import {
  CONTENT_PLATFORMS,
  MAX_QUICK_START_QUESTIONS,
  MIN_QUICK_START_QUESTIONS,
} from "../quick-start.constants";

export class CreateQuickStartSessionDto {
  @IsUUID()
  organizationId!: string;

  @IsOptional()
  @IsUUID()
  projectId?: string;

  @IsString()
  @MaxLength(100)
  brandName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  website?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  industry?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  competitors?: string[];

  @IsOptional()
  @IsEnum(AiProvider)
  provider?: AiProvider;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  model?: string;
}

export class InferIndustryDto {
  @IsString()
  @MaxLength(100)
  brandName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  website?: string;

  @IsOptional()
  @IsEnum(AiProvider)
  provider?: AiProvider;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  model?: string;

  @IsOptional()
  @IsBoolean()
  confirmed?: boolean;
}

export class UpdateQuickStartSettingsDto {
  @IsEnum(AiProvider)
  provider!: AiProvider;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  model?: string;
}

export class QuickStartQuestionDto {
  @IsOptional()
  @IsUUID()
  queryId?: string;

  @IsString()
  @MaxLength(500)
  text!: string;

  @IsEnum(QuickStartQuestionKind)
  kind!: QuickStartQuestionKind;

  @IsString()
  @MaxLength(100)
  intent!: string;
}

export class UpdateQuickStartQuestionsDto {
  @IsArray()
  @ArrayMinSize(MIN_QUICK_START_QUESTIONS)
  @ArrayMaxSize(MAX_QUICK_START_QUESTIONS)
  @ValidateNested({ each: true })
  @Type(() => QuickStartQuestionDto)
  questions!: QuickStartQuestionDto[];
}

export class ConfirmModelCallDto {
  @IsOptional()
  @IsBoolean()
  confirmed?: boolean;
}

export class GenerateContentDto extends ConfirmModelCallDto {
  @IsIn(CONTENT_PLATFORMS)
  channel!: string;

  @IsOptional()
  @IsUUID()
  suggestionId?: string;
}

export class SaveContentDto {
  @IsString()
  @MaxLength(200)
  title!: string;

  @IsString()
  @MaxLength(30000)
  body!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  hashtags?: string[];
}

export class CreateDistributionTasksDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(CONTENT_PLATFORMS.length)
  @IsIn(CONTENT_PLATFORMS, { each: true })
  platforms!: string[];
}
