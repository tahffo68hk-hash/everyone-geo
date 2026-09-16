import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard, JwtUserPayload } from "../common/auth.guard";
import { CurrentUser } from "../common/current-user.decorator";
import { ContentStrategyService } from "./content-strategy.service";
import {
  GenerateStrategyDto,
  UpdatePlanItemDto,
  CreateDraftFromPlanItemDto,
  ListStrategiesDto,
} from "./dto/content-strategy.dto";

@Controller()
@UseGuards(AuthGuard)
export class ContentStrategyController {
  constructor(private readonly service: ContentStrategyService) {}

  /**
   * 一键从 Opportunity / Recommendation 生成内容战略与内容生产计划
   */
  @Post("projects/:id/content-strategies/generate")
  @HttpCode(201)
  generateStrategy(
    @CurrentUser() u: JwtUserPayload,
    @Param("id", ParseUUIDPipe) projectId: string,
    @Body() dto: GenerateStrategyDto,
  ) {
    return this.service.generateStrategy(u.sub, projectId, dto);
  }

  /**
   * 查看项目下的内容战略列表
   */
  @Get("projects/:id/content-strategies")
  listStrategies(
    @CurrentUser() u: JwtUserPayload,
    @Param("id", ParseUUIDPipe) projectId: string,
    @Query() dto: ListStrategiesDto,
  ) {
    return this.service.listStrategies(u.sub, projectId, dto);
  }

  /**
   * 获取特定内容战略的详细 9 维度解析与关联内容计划项
   */
  @Get("content-strategies/:id")
  getStrategy(
    @CurrentUser() u: JwtUserPayload,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.service.getStrategy(u.sub, id);
  }

  /**
   * 更新某个计划项的信息（如状态、标题、目标、排序等）
   */
  @Patch("content-strategies/:strategyId/plan-items/:itemId")
  updatePlanItem(
    @CurrentUser() u: JwtUserPayload,
    @Param("strategyId", ParseUUIDPipe) strategyId: string,
    @Param("itemId", ParseUUIDPipe) itemId: string,
    @Body() dto: UpdatePlanItemDto,
  ) {
    return this.service.updatePlanItem(u.sub, strategyId, itemId, dto);
  }

  /**
   * 闭环打通：一键从计划项派生带有完整结构化大纲和事实约束的 ContentDraft
   */
  @Post("content-strategies/:strategyId/plan-items/:itemId/create-draft")
  @HttpCode(201)
  createDraftFromPlanItem(
    @CurrentUser() u: JwtUserPayload,
    @Param("strategyId", ParseUUIDPipe) strategyId: string,
    @Param("itemId", ParseUUIDPipe) itemId: string,
    @Body() dto: CreateDraftFromPlanItemDto,
  ) {
    return this.service.createDraftFromPlanItem(u.sub, strategyId, itemId, dto);
  }
}
