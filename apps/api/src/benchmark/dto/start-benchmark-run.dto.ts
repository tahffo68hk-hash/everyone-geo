import { IsIn, IsUUID } from "class-validator";

export class StartBenchmarkRunDto {
  /** 目标 Engine（M6A 单 Provider：demo ⇒ mock 引擎；real ⇒ deepseek 引擎）。 */
  @IsUUID()
  engineId!: string;

  /**
   * demo 只允许 mock provider（绝不产生真实调用）；
   * real 允许真实 provider（deepseek / qwen 等）。
   */
  @IsIn(["demo", "real"], { message: "runType 必须为 demo 或 real" })
  runType!: "demo" | "real";
}
