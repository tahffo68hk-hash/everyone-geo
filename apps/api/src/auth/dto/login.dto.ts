import { IsEmail, IsString, Length } from "class-validator";

export class LoginDto {
  @IsEmail({}, { message: "email 格式不正确" })
  email!: string;

  @IsString()
  @Length(1, 128, { message: "password 不能为空" })
  password!: string;
}
