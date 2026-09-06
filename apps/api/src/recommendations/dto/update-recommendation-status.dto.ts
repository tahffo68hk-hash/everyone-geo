import { IsIn } from "class-validator";

/** PATCH /recommendations/:id/status —— 人工 review 状态（系统不自动 ACCEPT）。 */
export class UpdateRecommendationStatusDto {
  @IsIn(["PROPOSED", "ACCEPTED", "DISMISSED"], { message: "status 必须为 PROPOSED / ACCEPTED / DISMISSED" })
  status!: string;
}
