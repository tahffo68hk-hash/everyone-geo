import { IsOptional, IsString, IsUrl, MaxLength } from "class-validator";

export class CreateSiteDto {
  @IsString()
  @MaxLength(120)
  name!: string;

  @IsUrl({ require_tld: false, protocols: ["http", "https"] }, { message: "baseUrl 必须为 http(s) URL" })
  baseUrl!: string;
}

export class CreateAssetDto {
  @IsUrl({ require_tld: false, protocols: ["http", "https"] }, { message: "url 必须为 http(s) URL" })
  url!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  assetType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  note?: string;
}
