import { IsUUID } from "class-validator";

/** POST /reports/compare —— 报告 A vs 报告 B（先判定可比性再算 Delta）。 */
export class CompareReportsDto {
  @IsUUID()
  reportAId!: string;

  @IsUUID()
  reportBId!: string;
}
