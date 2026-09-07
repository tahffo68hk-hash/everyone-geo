import { IsIn, IsOptional, IsString, IsUrl, MaxLength, ValidateIf } from "class-validator";

export class SitemapImportDto {
  @IsOptional()
  @IsUrl({ require_tld: false, protocols: ["http", "https"] }, { message: "sitemapUrl 必须为 http(s) URL" })
  sitemapUrl?: string;
}

export class ManualSnapshotDto {
  @IsOptional()
  @IsIn(["BEFORE_CHANGE", "AFTER_CHANGE", "MANUAL_IMPORT"], { message: "snapshotType 只允许 BEFORE_CHANGE / AFTER_CHANGE / MANUAL_IMPORT" })
  snapshotType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @ValidateIf(o => !o.title)
  @IsString()
  @MaxLength(40000)
  text?: string;
}

export class MapOpportunityDto {
  @IsIn(["UPDATE_EXISTING", "CREATE_NEW", "UNKNOWN"], { message: "mappingType 只允许 UPDATE_EXISTING / CREATE_NEW / UNKNOWN" })
  mappingType!: string;

  @IsOptional()
  @IsString()
  siteAssetId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(400)
  note?: string;
}
