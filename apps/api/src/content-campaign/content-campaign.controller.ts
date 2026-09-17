import {
  BadRequestException,
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
import { ContentCampaignService } from "./content-campaign.service";
import {
  CreateContentCampaignDto,
  UpdateContentCampaignDto,
  GenerateCalendarDto,
  UpdateScheduleItemDto,
  QueueQueryDto,
} from "./dto/content-campaign.dto";

@Controller()
@UseGuards(AuthGuard)
export class ContentCampaignController {
  constructor(private readonly service: ContentCampaignService) {}

  /**
   * 1. 创建营销战役并实例化排期项
   * POST /api/content/campaigns 或 POST /content/campaigns 或 POST /projects/:id/content-campaigns
   */
  @Post(["api/content/campaigns", "content/campaigns", "projects/:id/content-campaigns"])
  @HttpCode(201)
  createCampaign(
    @CurrentUser() u: JwtUserPayload,
    @Param("id") paramProjectId: string | undefined,
    @Body() dto: CreateContentCampaignDto,
  ) {
    const projectId = paramProjectId || dto.projectId;
    return this.service.createCampaign(u.sub, projectId, dto);
  }

  /**
   * 2. 战役列表与进度汇总
   * GET /api/content/campaigns?projectId=... 或 GET /projects/:id/content-campaigns
   */
  @Get(["api/content/campaigns", "content/campaigns", "projects/:id/content-campaigns"])
  listCampaigns(
    @CurrentUser() u: JwtUserPayload,
    @Param("id") paramProjectId: string | undefined,
    @Query("projectId") queryProjectId: string | undefined,
  ) {
    const projectId = paramProjectId || queryProjectId;
    if (!projectId) {
      throw new BadRequestException("缺少 projectId 参数");
    }
    return this.service.listCampaigns(u.sub, projectId);
  }

  /**
   * 3. 战役详情、血缘与排期项列表
   * GET /api/content/campaigns/:id 或 GET /content/campaigns/:id
   */
  @Get(["api/content/campaigns/:id", "content/campaigns/:id"])
  getCampaign(
    @CurrentUser() u: JwtUserPayload,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.service.getCampaignById(u.sub, id);
  }

  /**
   * 4. 更新战役（状态、目标、周期调整等）
   * PATCH /api/content/campaigns/:id 或 PATCH /content/campaigns/:id
   */
  @Patch(["api/content/campaigns/:id", "content/campaigns/:id"])
  updateCampaign(
    @CurrentUser() u: JwtUserPayload,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateContentCampaignDto,
  ) {
    return this.service.updateCampaign(u.sub, id, dto);
  }

  /**
   * 5. 按规则自动排期（节奏、并行度、依赖拓扑）
   * POST /api/content/campaigns/:id/calendar/generate 或 POST /content/campaigns/:id/calendar/generate
   */
  @Post(["api/content/campaigns/:id/calendar/generate", "content/campaigns/:id/calendar/generate"])
  @HttpCode(200)
  generateCalendar(
    @CurrentUser() u: JwtUserPayload,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: GenerateCalendarDto,
  ) {
    return this.service.generateCalendar(u.sub, id, dto);
  }

  /**
   * 6. 日历视图（按天/按周聚合，含 overdue 与 nextAction）
   * GET /api/content/campaigns/:id/calendar 或 GET /content/campaigns/:id/calendar
   */
  @Get(["api/content/campaigns/:id/calendar", "content/campaigns/:id/calendar"])
  getCalendar(
    @CurrentUser() u: JwtUserPayload,
    @Param("id", ParseUUIDPipe) id: string,
    @Query("timezone") timezone?: string,
  ) {
    return this.service.getCalendar(u.sub, id, timezone);
  }

  /**
   * 7. 更新排期项（改期、指派人员、依赖绑定、状态更新）
   * PATCH /api/content/schedule-items/:id 或 PATCH /content/schedule-items/:id
   */
  @Patch(["api/content/schedule-items/:id", "content/schedule-items/:id"])
  updateScheduleItem(
    @CurrentUser() u: JwtUserPayload,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateScheduleItemDto,
  ) {
    return this.service.updateScheduleItem(u.sub, id, dto);
  }

  /**
   * 8. 生产执行队列（聚合待生产项，确定性排序，含指标汇总）
   * GET /api/content/production-queue?projectId=... 或 GET /projects/:id/production-queue
   */
  @Get(["api/content/production-queue", "content/production-queue", "projects/:id/production-queue"])
  getProductionQueue(
    @CurrentUser() u: JwtUserPayload,
    @Param("id") paramProjectId: string | undefined,
    @Query() query: QueueQueryDto,
  ) {
    const projectId = paramProjectId || query.projectId;
    if (!projectId) {
      throw new BadRequestException("缺少 projectId 参数");
    }
    return this.service.getProductionQueue(u.sub, projectId, query);
  }

  /**
   * 9. 触发生产（事实与物料准入阻断守卫 + 幂等草稿派生）
   * POST /api/content/schedule-items/:id/start-production 或 POST /content/schedule-items/:id/start-production
   */
  @Post(["api/content/schedule-items/:id/start-production", "content/schedule-items/:id/start-production"])
  @HttpCode(200)
  startProduction(
    @CurrentUser() u: JwtUserPayload,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.service.startProduction(u.sub, id);
  }
}
