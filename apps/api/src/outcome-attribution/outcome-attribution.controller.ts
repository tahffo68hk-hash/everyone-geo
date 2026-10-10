import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard, JwtUserPayload } from "../common/auth.guard";
import { CurrentUser } from "../common/current-user.decorator";
import { OutcomeAttributionService } from "./outcome-attribution.service";
import { GenerateAttributionDto } from "./dto/outcome-attribution.dto";

@Controller()
@UseGuards(AuthGuard)
export class OutcomeAttributionController {
  constructor(private readonly attribution: OutcomeAttributionService) {}

  /**
   * 为某条 OutcomeComparison 生成或获取归因分析
   * POST /outcomes/:id/attribution
   */
  @Post(["outcomes/:id/attribution", "api/content/outcomes/:id/attribution", "content/outcomes/:id/attribution"])
  @HttpCode(200)
  generateAttribution(
    @CurrentUser() u: JwtUserPayload,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: GenerateAttributionDto,
  ) {
    return this.attribution.generateOutcomeAttribution(u.sub, id, dto);
  }

  /**
   * 查询某条 OutcomeComparison 的归因分析详情
   * GET /outcomes/:id/attribution
   */
  @Get(["outcomes/:id/attribution", "api/content/outcomes/:id/attribution", "content/outcomes/:id/attribution"])
  getOutcomeAttribution(
    @CurrentUser() u: JwtUserPayload,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.attribution.getOutcomeAttribution(u.sub, id);
  }

  /**
   * 查询某落地资产在所有重测批次中的 Attribution 历史
   * GET /published-assets/:id/attributions
   */
  @Get([
    "published-assets/:id/attributions",
    "api/content/published-assets/:id/attributions",
    "content/published-assets/:id/attributions",
  ])
  listAssetAttributions(
    @CurrentUser() u: JwtUserPayload,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.attribution.listAssetAttributions(u.sub, id);
  }

  /**
   * 查询某次 RetestRun 的所有 Attribution 结果与聚合分析
   * GET /retests/:id/attributions
   */
  @Get(["retests/:id/attributions", "api/content/retests/:id/attributions", "content/retests/:id/attributions"])
  getRetestRunAttributions(
    @CurrentUser() u: JwtUserPayload,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.attribution.getRetestRunAttributions(u.sub, id);
  }

  /**
   * M10E Workspace Level 1: 项目下所有落地资产的复测与归因摘要列表
   * GET /projects/:id/verification-assets
   */
  @Get([
    "projects/:id/verification-assets",
    "api/content/projects/:id/verification-assets",
    "content/projects/:id/verification-assets",
  ])
  listVerificationAssets(
    @CurrentUser() u: JwtUserPayload,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.attribution.listVerificationAssets(u.sub, id);
  }

  /**
   * M10E Workspace Level 2 & 3: 落地资产完整效果对比与归因 Workspace 投影
   * GET /published-assets/:id/outcome-workspace
   */
  @Get([
    "published-assets/:id/outcome-workspace",
    "api/content/published-assets/:id/outcome-workspace",
    "content/published-assets/:id/outcome-workspace",
  ])
  getAssetOutcomeWorkspace(
    @CurrentUser() u: JwtUserPayload,
    @Param("id", ParseUUIDPipe) id: string,
    @Query("retestRunId") retestRunId?: string,
    @Query("comparisonVersion") comparisonVersion?: string,
    @Query("attributionVersion") attributionVersion?: string,
  ) {
    return this.attribution.getAssetOutcomeWorkspace(
      u.sub,
      id,
      retestRunId,
      comparisonVersion,
      attributionVersion,
    );
  }
}
