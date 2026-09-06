import { IsIn, IsUUID } from "class-validator";

export class StartBenchmarkRunDto {
  /** 目标 Engine（M6A 单 Provider：demo ⇒ mock 引擎；real ⇒ deepseek 引擎）。 */
  @IsUUID()
  engineId!: string;

  /**
   * demo 只允许 mock provider（绝不产生真实调用）；
   * real 只允许 deepseek provider 且受 REAL_PROVIDER_MAX_RUNS_PER_TASK 上限约束。
   */
  @IsIn(["demo", "real"], { message: "runType 必须为 demo 或 real" })
  runType!: "demo" | "real";
}
