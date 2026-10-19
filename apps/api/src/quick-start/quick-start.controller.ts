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
  CreateQuickStartSessionDto,
  InferIndustryDto,
  UpdateQuickStartQuestionsDto,
  UpdateQuickStartSettingsDto,
} from "./dto/quick-start.dto";
import { QuickStartService } from "./quick-start.service";

@Controller("quick-start")
@UseGuards(AuthGuard)
export class QuickStartController {
  constructor(private readonly quickStart: QuickStartService) {}

  @Get("providers")
  providers() {
    return this.quickStart.providers();
  }

  @Post("industry-inference")
  @HttpCode(200)
  inferIndustry(@Body() dto: InferIndustryDto) {
    return this.quickStart.inferIndustry(dto);
  }

  @Get("sessions")
  listSessions(
    @CurrentUser() user?: JwtUserPayload,
    @Query("organizationId") organizationId?: string,
  ) {
    return this.quickStart.listSessions(user!.sub, organizationId);
  }

  @Post("sessions")
  async createSession(
    @CurrentUser() user: JwtUserPayload,
    @Body() dto: CreateQuickStartSessionDto,
  ) {
    return this.quickStart.createSession(user.sub, dto);
  }

  @Get("sessions/:id")
  getSession(@Param("id") id: string, @CurrentUser() user?: JwtUserPayload) {
    return this.quickStart.getSession(id, user!.sub);
  }

  @Patch("sessions/:id/settings")
  updateSettings(
    @Param("id") id: string,
    @CurrentUser() user: JwtUserPayload,
    @Body() dto: UpdateQuickStartSettingsDto,
  ) {
    return this.quickStart.updateSettings(id, user.sub, dto);
  }

  @Post("sessions/:id/questions/generate")
  @HttpCode(200)
  generateQuestions(
    @Param("id") id: string,
    @CurrentUser() user: JwtUserPayload,
    @Body() dto: ConfirmModelCallDto,
  ) {
    return this.quickStart.generateQuestions(id, user.sub, dto);
  }

  @Patch("sessions/:id/questions")
  updateQuestions(
    @Param("id") id: string,
    @CurrentUser() user: JwtUserPayload,
    @Body() dto: UpdateQuickStartQuestionsDto,
  ) {
    return this.quickStart.updateQuestions(id, user.sub, dto);
  }

  @Post("sessions/:id/runs")
  startRun(
    @Param("id") id: string,
    @CurrentUser() user: JwtUserPayload,
    @Body() dto: ConfirmModelCallDto,
  ) {
    return this.quickStart.startRun(id, user.sub, dto);
  }

  @Get("runs/:id")
  getRun(@Param("id") id: string, @CurrentUser() user?: JwtUserPayload) {
    return this.quickStart.getRun(id, user!.sub);
  }
}
