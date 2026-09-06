import { IsOptional, IsString, MaxLength, Matches } from "class-validator";

/** POST /benchmark-runs/:id/reports —— 明确选择 analysisVersion（不默认漂移）。 */
export class CreateReportDto {
  /**
   * 报告使用的 Analysis 版本（m4-rule-v1 / m6b-competitors-v1）。
   * 不填时服务端按确定性规则选择：优先 m6b-competitors-v1（若该 Run 有对应分析），
   * 否则 m4-rule-v1。生成时 snapshot，之后出现新 Analysis version 不改变历史报告。
   */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  @Matches(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/, { message: "analysisVersion 必须为 1–64 位字母、数字、点、下划线或连字符" })
  analysisVersion?: string;

  /**
   * 仅当 analysisVersion=m6b-competitors-v1 时使用：绑定该 Run 分析所归属的
   * Competitor Set。默认取该版本分析行中记录的唯一 competitorSetId；多个候选时
   * 必须显式指定。生成后 snapshot id/name/version，Set v2 激活不影响旧报告。
   */
  @IsOptional()
  @IsString()
  @Matches(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/, { message: "competitorSetId 必须为 UUID" })
  competitorSetId?: string;
}
