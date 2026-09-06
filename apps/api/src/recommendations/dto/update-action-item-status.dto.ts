import { IsIn } from "class-validator";

/** PATCH /action-items/:id/status —— 行动项轻量状态（M7D 再升级实验生命周期）。 */
export class UpdateActionItemStatusDto {
  @IsIn(["TODO", "IN_PROGRESS", "DONE", "SKIPPED"], { message: "status 必须为 TODO / IN_PROGRESS / DONE / SKIPPED" })
  status!: string;
}
