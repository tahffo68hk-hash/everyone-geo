import { IsIn, IsOptional, IsString, IsUUID } from "class-validator";

export class CreateChangePlanDto {
  @IsOptional()
  @IsUUID()
  siteAssetId?: string | null;
}

export class ChangePlanStatusDto {
  @IsString()
  @IsIn(["DRAFT", "APPROVED", "EXECUTED_MANUALLY", "CANCELLED"], { message: "status 只允许 DRAFT / APPROVED / EXECUTED_MANUALLY / CANCELLED" })
  status!: string;
}

export class ChangeItemStatusDto {
  @IsString()
  @IsIn(["PENDING", "DONE", "SKIPPED"], { message: "item status 只允许 PENDING / DONE / SKIPPED" })
  status!: string;
}
