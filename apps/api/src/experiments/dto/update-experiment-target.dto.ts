import { IsIn, IsString } from "class-validator";

export class UpdateExperimentTargetDto {
  @IsString()
  @IsIn(["WEB_CONTENT", "MODEL_BEHAVIOR"], { message: "targetChangeType 只允许 WEB_CONTENT / MODEL_BEHAVIOR" })
  targetChangeType!: string;
}
