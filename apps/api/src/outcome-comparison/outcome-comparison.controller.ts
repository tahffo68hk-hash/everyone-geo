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
import { OutcomeComparisonService } from "./outcome-comparison.service";
import { GenerateOutcomeComparisonsDto } from "./dto/outcome-comparison.dto";

@Controller()
@UseGuards(AuthGuard)
export class OutcomeComparisonController {
  constructor(private readonly outcome: OutcomeComparisonService) {}

  /**
   * 为某次 RetestRun 生成/更新 Outcome 对比数据
   * POST /retests/:id/outcomes
   */
  @Post(["retests/:id/outcomes", "api/content/retests/:id/outcomes", "content/retests/:id/outcomes"])
  @HttpCode(200)
  generateOutcomes(
    @CurrentUser() u: JwtUserPayload,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: GenerateOutcomeComparisonsDto,
  ) {
    return this.outcome.generateRetestOutcomes(u.sub, id, dto);
  }

  /**
   * 查询某次 RetestRun 的 Outcome 对比结果与 Run 级聚合
   * GET /retests/:id/outcomes
   */
  @Get(["retests/:id/outcomes", "api/content/retests/:id/outcomes", "content/retests/:id/outcomes"])
  getRetestRunOutcomes(
    @CurrentUser() u: JwtUserPayload,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.outcome.getRetestRunOutcomes(u.sub, id);
  }

  /**
   * 查询单条 RetestItem 的 Outcome 对比明细
   * GET /retest-items/:id/outcome
   */
  @Get([
    "retest-items/:id/outcome",
    "api/content/retest-items/:id/outcome",
    "content/retest-items/:id/outcome",
    "retests/items/:id/outcome",
  ])
  getRetestItemOutcome(
    @CurrentUser() u: JwtUserPayload,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.outcome.getRetestItemOutcome(u.sub, id);
  }

  /**
   * 查询某落地资产在所有重测批次中的 Outcome 历史
   * GET /published-assets/:id/outcomes
   */
  @Get([
    "published-assets/:id/outcomes",
    "api/content/published-assets/:id/outcomes",
    "content/published-assets/:id/outcomes",
  ])
  listAssetOutcomes(
    @CurrentUser() u: JwtUserPayload,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.outcome.listAssetOutcomes(u.sub, id);
  }

  /**
   * 查询单个 Outcome 对比实体
   * GET /outcomes/:id
   */
  @Get(["outcomes/:id", "api/content/outcomes/:id", "content/outcomes/:id"])
  getOutcomeById(
    @CurrentUser() u: JwtUserPayload,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.outcome.getOutcomeById(u.sub, id);
  }
}
