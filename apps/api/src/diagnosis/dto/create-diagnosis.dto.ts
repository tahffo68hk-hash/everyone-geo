import { IsOptional, IsUUID } from "class-validator";

/** POST /reports/:reportId/diagnoses —— 生成 GEO 问题诊断（绑定 Report 快照）。 */
export class CreateDiagnosisDto {
  /**
   * 可选第二份报告（对比用，Provider Gap）。仅当两份报告可比（COMPARABLE 或
   * 仅 Provider/模型差异的 PARTIALLY_COMPARABLE）才允许；NOT_COMPARABLE → 400。
   */
  @IsOptional()
  @IsUUID()
  secondaryReportId?: string;
}
