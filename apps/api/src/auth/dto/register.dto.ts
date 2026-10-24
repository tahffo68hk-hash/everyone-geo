import { IsEmail, IsOptional, IsString, Length, MaxLength } from "class-validator";

export class RegisterDto {
  @IsEmail({}, { message: "email 格式不正确" })
  @MaxLength(255)
  email!: string;

  @IsString({ message: "name 必须为字符串" })
  @MaxLength(100, { message: "name 最长 100 字符" })
  name!: string;

  @IsString()
  @Length(8, 128, { message: "password 长度需在 8-128 之间" })
  password!: string;

  /** 注册时自动创建的默认组织名；缺省用 “{name} 的组织” */
  @IsOptional()
  @IsString()
  @MaxLength(100, { message: "organizationName 最长 100 字符" })
  organizationName?: string;
}
