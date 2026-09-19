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
import { LearningService } from "./learning.service";
import {
  GenerateLearningObservationsDto,
  QueryLearningObservationsDto,
} from "./dto/learning.dto";

@Controller()
@UseGuards(AuthGuard)
export class LearningController {
  constructor(private readonly learning: LearningService) {}

  /**
   * 为某条 OutcomeComparison 生成或获取事实型学习观察
   * POST /outcomes/:id/learning-observations
   */
  @Post([
    "outcomes/:id/learning-observations",
    "api/content/outcomes/:id/learning-observations",
    "content/outcomes/:id/learning-observations",
  ])
  @HttpCode(200)
  generateOutcomeObservations(
    @CurrentUser() u: JwtUserPayload,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: GenerateLearningObservationsDto,
  ) {
    return this.learning.generateOutcomeObservations(u.sub, id, dto);
  }

  /**
   * 查询某条 OutcomeComparison 的所有学习观察
   * GET /outcomes/:id/learning-observations
   */
  @Get([
    "outcomes/:id/learning-observations",
    "api/content/outcomes/:id/learning-observations",
    "content/outcomes/:id/learning-observations",
  ])
  getOutcomeObservations(
    @CurrentUser() u: JwtUserPayload,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.learning.getOutcomeObservations(u.sub, id);
  }

  /**
   * 查询某篇 PublishedAsset 的所有学习观察
   * GET /published-assets/:id/learning-observations
   */
  @Get([
    "published-assets/:id/learning-observations",
    "api/content/published-assets/:id/learning-observations",
    "content/published-assets/:id/learning-observations",
  ])
  listAssetObservations(
    @CurrentUser() u: JwtUserPayload,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.learning.listAssetObservations(u.sub, id);
  }

  /**
   * 查询项目下所有的学习观察
   * GET /projects/:id/learning-observations
   */
  @Get([
    "projects/:id/learning-observations",
    "api/content/projects/:id/learning-observations",
    "content/projects/:id/learning-observations",
  ])
  listProjectObservations(
    @CurrentUser() u: JwtUserPayload,
    @Param("id", ParseUUIDPipe) id: string,
    @Query() query: QueryLearningObservationsDto,
  ) {
    return this.learning.listProjectObservations(u.sub, id, query);
  }

  /**
   * 查询项目级学习摘要与模式聚合分析
   * GET /projects/:id/learning-summary
   */
  @Get([
    "projects/:id/learning-summary",
    "api/content/projects/:id/learning-summary",
    "content/projects/:id/learning-summary",
  ])
  getProjectLearningSummary(
    @CurrentUser() u: JwtUserPayload,
    @Param("id", ParseUUIDPipe) id: string,
    @Query("version") version?: string,
  ) {
    return this.learning.getProjectLearningSummary(u.sub, id, version);
  }
}
