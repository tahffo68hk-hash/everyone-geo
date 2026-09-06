import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, UseGuards } from "@nestjs/common";
import { AuthGuard, JwtUserPayload } from "../common/auth.guard";
import { CurrentUser } from "../common/current-user.decorator";
import { OpportunitiesService } from "./opportunities.service";
import { UpdateOpportunityStatusDto } from "./dto/update-opportunity-status.dto";

/**
 * M7C Content Opportunities API（auth + tenant + DB isolation）。
 * 注：@nestjs/swagger 为 ESM-only，只在 main.ts 运行时启用，模块图不引入装饰器（与 M6B–M7B 同风格）。
 */
@Controller()
@UseGuards(AuthGuard)
export class OpportunitiesController {
  constructor(private readonly opportunities: OpportunitiesService) {}

  /** 为一份 Optimization RecommendationRun 生成内容机会（幂等：同 recRun+version 返回既有）。 */
  @Post("recommendation-runs/:id/opportunities")
  @HttpCode(201)
  create(@CurrentUser() user: JwtUserPayload, @Param("id", ParseUUIDPipe) id: string) {
    return this.opportunities.createFromRecommendations(user.sub, id);
  }

  /** 某 RecommendationRun 下的内容机会 Runs（历史版本并存）。 */
  @Get("recommendation-runs/:id/opportunities")
  listByRecommendationRun(@CurrentUser() user: JwtUserPayload, @Param("id", ParseUUIDPipe) id: string) {
    return this.opportunities.listByRecommendationRun(user.sub, id);
  }

  @Get("opportunity-runs/:id")
  getRun(@CurrentUser() user: JwtUserPayload, @Param("id", ParseUUIDPipe) id: string) {
    return this.opportunities.getRun(user.sub, id);
  }

  /** 某 OpportunityRun 的内容机会列表（Table 工作流用，含计数/引擎/竞品快照）。 */
  @Get("opportunity-runs/:id/opportunities")
  listOpportunities(@CurrentUser() user: JwtUserPayload, @Param("id", ParseUUIDPipe) id: string) {
    return this.opportunities.listOpportunities(user.sub, id);
  }

  /** 内容机会详情（含建议结构块 + 目标 Query + 引擎/竞品快照）。 */
  @Get("content-opportunities/:id")
  getOpportunity(@CurrentUser() user: JwtUserPayload, @Param("id", ParseUUIDPipe) id: string) {
    return this.opportunities.getOpportunity(user.sub, id);
  }

  @Get("content-opportunities/:id/recommendations")
  sourceRecommendations(@CurrentUser() user: JwtUserPayload, @Param("id", ParseUUIDPipe) id: string) {
    return this.opportunities.sourceRecommendations(user.sub, id);
  }

  @Get("content-opportunities/:id/queries")
  queries(@CurrentUser() user: JwtUserPayload, @Param("id", ParseUUIDPipe) id: string) {
    return this.opportunities.queries(user.sub, id);
  }

  @Get("content-opportunities/:id/evidence")
  evidence(@CurrentUser() user: JwtUserPayload, @Param("id", ParseUUIDPipe) id: string) {
    return this.opportunities.evidence(user.sub, id);
  }

  @Patch("content-opportunities/:id/status")
  updateStatus(@CurrentUser() user: JwtUserPayload, @Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateOpportunityStatusDto) {
    return this.opportunities.updateStatus(user.sub, id, dto);
  }
}
