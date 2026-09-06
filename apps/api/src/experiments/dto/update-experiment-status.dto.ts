import { IsIn, IsString } from "class-validator";

/**
 * Experiment 人工状态：只允许取消（其余状态由动作自动推进）。
 * 不允许直接置 EVALUATED / RETEST_* —— 无效流转一律 400。
 */
export const EXPERIMENT_STATUS_CHANGES = ["CANCELLED"] as const;

export class UpdateExperimentStatusDto {
  @IsString()
  @IsIn(EXPERIMENT_STATUS_CHANGES as unknown as string[])
  status: string;
}
