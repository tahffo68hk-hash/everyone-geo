import { IsUUID } from "class-validator";

export class ReanalysisDto {
  /** 目标 Competitor Set（必须属于该项目且已 ACTIVE 冻结）。 */
  @IsUUID()
  competitorSetId!: string;
}
