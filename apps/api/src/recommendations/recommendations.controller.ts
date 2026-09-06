import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, UseGuards } from "@nestjs/common";
import { AuthGuard, JwtUserPayload } from "../common/auth.guard";
import { CurrentUser } from "../common/current-user.decorator";
import { RecommendationsService } from "./recommendations.service";
import { UpdateRecommendationStatusDto } from "./dto/update-recommendation-status.dto";
import { UpdateActionItemStatusDto } from "./dto/update-action-item-status.dto";

/**
 * M7B Optimization Recommendations API（auth + tenant + DB isolation）。
 * 注：@nestjs/swagger 为 ESM-only，只在 main.ts 运行时启用，模块图不引入装饰器。
 */
@Controller()
@UseGuards(AuthGuard)
export class RecommendationsController {
  constructor(private readonly recommendations: RecommendationsService) {}

  /** 为一份 Diagnosis 生成优化建议（幂等：同 diagnosis+version 返回既有）。 */
  @Post("diagnoses/:diagnosisId/recommendations")
  @HttpCode(201)
  create(@CurrentUser() user: JwtUserPayload, @Param("diagnosisId", ParseUUIDPipe) diagnosisId: string) {
    return this.recommendations.createFromDiagnosis(user.sub, diagnosisId);
  }

  @Get("diagnoses/:diagnosisId/recommendations")
  listByDiagnosis(@CurrentUser() user: JwtUserPayload, @Param("diagnosisId", ParseUUIDPipe) diagnosisId: string) {
    return this.recommendations.listByDiagnosis(user.sub, diagnosisId);
  }

  @Get("recommendation-runs/:id")
  getRun(@CurrentUser() user: JwtUserPayload, @Param("id", ParseUUIDPipe) id: string) {
    return this.recommendations.getRun(user.sub, id);
  }

  @Get("recommendation-runs/:id/recommendations")
  listRecommendations(@CurrentUser() user: JwtUserPayload, @Param("id", ParseUUIDPipe) id: string) {
    return this.recommendations.listRecommendations(user.sub, id);
  }

  @Get("recommendations/:id")
  getRecommendation(@CurrentUser() user: JwtUserPayload, @Param("id", ParseUUIDPipe) id: string) {
    return this.recommendations.getRecommendation(user.sub, id);
  }

  @Get("recommendations/:id/findings")
  findings(@CurrentUser() user: JwtUserPayload, @Param("id", ParseUUIDPipe) id: string) {
    return this.recommendations.recommendationFindings(user.sub, id);
  }

  @Get("recommendations/:id/evidence")
  evidence(@CurrentUser() user: JwtUserPayload, @Param("id", ParseUUIDPipe) id: string) {
    return this.recommendations.recommendationEvidence(user.sub, id);
  }

  @Patch("recommendations/:id/status")
  updateRecommendationStatus(@CurrentUser() user: JwtUserPayload, @Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateRecommendationStatusDto) {
    return this.recommendations.updateRecommendationStatus(user.sub, id, dto);
  }

  @Patch("action-items/:id/status")
  updateActionItemStatus(@CurrentUser() user: JwtUserPayload, @Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateActionItemStatusDto) {
    return this.recommendations.updateActionItemStatus(user.sub, id, dto);
  }
}
