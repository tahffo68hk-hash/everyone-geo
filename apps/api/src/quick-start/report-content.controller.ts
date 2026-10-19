import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard, JwtUserPayload } from "../common/auth.guard";
import { CurrentUser } from "../common/current-user.decorator";
import {
  ConfirmModelCallDto,
  CreateDistributionTasksDto,
  GenerateContentDto,
  SaveContentDto,
} from "./dto/quick-start.dto";
import { DistributionService } from "./distribution.service";
import { ReportContentService } from "./report-content.service";

@Controller("quick-start")
@UseGuards(AuthGuard)
export class ReportContentController {
  constructor(
    private readonly reports: ReportContentService,
    private readonly distribution: DistributionService,
  ) {}

  @Get("reports/:id")
  getReport(@Param("id") id: string, @CurrentUser() user?: JwtUserPayload) {
    return this.reports.getReport(id, user!.sub);
  }

  @Post("reports/:id/suggestions")
  @HttpCode(200)
  generateSuggestions(
    @Param("id") id: string,
    @CurrentUser() user: JwtUserPayload,
    @Body() dto: ConfirmModelCallDto,
  ) {
    return this.reports.generateSuggestions(id, user.sub, dto.confirmed === true);
  }

  @Post("reports/:id/content")
  generateContent(
    @Param("id") id: string,
    @CurrentUser() user: JwtUserPayload,
    @Body() dto: GenerateContentDto,
  ) {
    return this.reports.generateContent(id, user.sub, dto);
  }

  @Patch("content/:id")
  saveContent(
    @Param("id") id: string,
    @CurrentUser() user: JwtUserPayload,
    @Body() dto: SaveContentDto,
  ) {
    return this.reports.saveContent(id, user.sub, dto);
  }

  @Post("content/:id/distribution-tasks")
  createDistributionTasks(
    @Param("id") id: string,
    @CurrentUser() user: JwtUserPayload,
    @Body() dto: CreateDistributionTasksDto,
  ) {
    return this.distribution.createTasks(id, user.sub, dto);
  }
}

@Controller("distribution")
@UseGuards(AuthGuard)
export class DistributionController {
  constructor(private readonly distribution: DistributionService) {}

  @Get("tasks")
  listTasks(
    @CurrentUser() user?: JwtUserPayload,
    @Query("organizationId") organizationId?: string,
  ) {
    return this.distribution.listTasks(user!.sub, organizationId);
  }

  @Get("tasks/:id")
  getTask(@Param("id") id: string, @CurrentUser() user?: JwtUserPayload) {
    return this.distribution.getTask(id, user!.sub);
  }
}
