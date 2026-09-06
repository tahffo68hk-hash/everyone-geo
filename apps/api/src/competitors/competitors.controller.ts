import { BadRequestException, Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { AuthGuard, JwtUserPayload } from "../common/auth.guard";
import { CurrentUser } from "../common/current-user.decorator";
import { CompetitorsService } from "./competitors.service";
import { CreateCompetitorSetDto } from "./dto/create-competitor-set.dto";
import { ReanalysisDto } from "./dto/reanalysis.dto";
import { ReviewCandidateDto } from "./dto/review-candidate.dto";

/**
 * M6B Competitor API（auth + org/project ownership + DB isolation 全部经
 * AuthGuard / TenantService 校验；跨租户一律 404 不泄露存在性）。
 * 注：@nestjs/swagger 为 ESM-only，只在 main.ts 运行时启用，模块图不引入装饰器。
 */
@Controller()
@UseGuards(AuthGuard)
export class CompetitorsController {
  constructor(private readonly competitors: CompetitorsService) {}

  @Post("projects/:projectId/competitor-discovery")
  @HttpCode(201)
  runDiscovery(@CurrentUser() user: JwtUserPayload, @Param("projectId", ParseUUIDPipe) projectId: string) {
    return this.competitors.runDiscovery(user.sub, projectId);
  }

  @Get("projects/:projectId/competitor-candidates")
  listCandidates(@CurrentUser() user: JwtUserPayload, @Param("projectId", ParseUUIDPipe) projectId: string) {
    return this.competitors.listCandidates(user.sub, projectId);
  }

  @Get("competitor-candidates/:id")
  getCandidate(@CurrentUser() user: JwtUserPayload, @Param("id", ParseUUIDPipe) id: string) {
    return this.competitors.getCandidate(user.sub, id);
  }

  @Patch("competitor-candidates/:id")
  reviewCandidate(
    @CurrentUser() user: JwtUserPayload,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: ReviewCandidateDto,
  ) {
    return this.competitors.reviewCandidate(user.sub, id, dto);
  }

  @Get("projects/:projectId/competitor-sets")
  listSets(@CurrentUser() user: JwtUserPayload, @Param("projectId", ParseUUIDPipe) projectId: string) {
    return this.competitors.listSets(user.sub, projectId);
  }

  @Post("projects/:projectId/competitor-sets")
  @HttpCode(201)
  createSet(
    @CurrentUser() user: JwtUserPayload,
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Body() dto: CreateCompetitorSetDto,
  ) {
    return this.competitors.createSet(user.sub, projectId, dto);
  }

  @Get("competitor-sets/:id")
  getSet(@CurrentUser() user: JwtUserPayload, @Param("id", ParseUUIDPipe) id: string) {
    return this.competitors.getSet(user.sub, id);
  }

  @Post("competitor-sets/:id/activate")
  activateSet(@CurrentUser() user: JwtUserPayload, @Param("id", ParseUUIDPipe) id: string) {
    return this.competitors.activateSet(user.sub, id);
  }

  @Post("projects/:projectId/competitor-reanalysis")
  reanalyze(
    @CurrentUser() user: JwtUserPayload,
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Body() dto: ReanalysisDto,
  ) {
    return this.competitors.reanalyze(user.sub, projectId, dto.competitorSetId);
  }

  @Get("projects/:projectId/competitor-sov")
  getShareOfVoice(
    @CurrentUser() user: JwtUserPayload,
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Query("competitorSetId") competitorSetId?: string,
  ) {
    if (competitorSetId !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(competitorSetId)) {
      throw new BadRequestException("competitorSetId 必须为合法 UUID");
    }
    return this.competitors.getShareOfVoice(user.sub, projectId, competitorSetId);
  }
}
