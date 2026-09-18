import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard, JwtUserPayload } from "../common/auth.guard";
import { CurrentUser } from "../common/current-user.decorator";
import { RetestOrchestrationService } from "./retest-orchestration.service";
import { CreateRetestRunDto } from "./dto/retest-orchestration.dto";

@Controller()
@UseGuards(AuthGuard)
export class RetestOrchestrationController {
  constructor(private readonly retest: RetestOrchestrationService) {}

  /**
   * 为已发布落地资产发起 GEO 重测任务 (Retest Run)
   * POST /published-assets/:id/retests 或 POST /api/content/published-assets/:id/retests
   */
  @Post(["published-assets/:id/retests", "api/content/published-assets/:id/retests", "content/published-assets/:id/retests"])
  @HttpCode(201)
  createRetestRun(
    @CurrentUser() u: JwtUserPayload,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: CreateRetestRunDto,
  ) {
    return this.retest.createRetestRun(u.sub, id, dto);
  }

  /**
   * 查询单次重测任务详情与状态
   * GET /retests/:id 或 GET /api/content/retests/:id
   */
  @Get(["retests/:id", "api/content/retests/:id", "content/retests/:id"])
  getRetestRun(
    @CurrentUser() u: JwtUserPayload,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.retest.getRetestRun(u.sub, id);
  }

  /**
   * 查询单次重测任务下的各问题 Item 及对应 Evidence / Baseline 凭证
   * GET /retests/:id/items 或 GET /api/content/retests/:id/items
   */
  @Get(["retests/:id/items", "api/content/retests/:id/items", "content/retests/:id/items"])
  getRetestItems(
    @CurrentUser() u: JwtUserPayload,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.retest.getRetestItems(u.sub, id);
  }

  /**
   * 查询某落地资产的所有 Retest 历史记录
   * GET /published-assets/:id/retests 或 GET /api/content/published-assets/:id/retests
   */
  @Get(["published-assets/:id/retests", "api/content/published-assets/:id/retests", "content/published-assets/:id/retests"])
  listAssetRetests(
    @CurrentUser() u: JwtUserPayload,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.retest.listAssetRetests(u.sub, id);
  }

  /**
   * 手动触发/重试执行 Retest 任务
   * POST /retests/:id/process 或 POST /api/content/retests/:id/process
   */
  @Post(["retests/:id/process", "api/content/retests/:id/process", "content/retests/:id/process"])
  @HttpCode(200)
  processRetest(
    @CurrentUser() u: JwtUserPayload,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.retest.executeRetestRunForUser(u.sub, id);
  }
}
