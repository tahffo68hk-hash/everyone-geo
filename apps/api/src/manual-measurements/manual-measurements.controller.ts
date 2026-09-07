import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from "@nestjs/common";
import { AuthGuard, JwtUserPayload } from "../common/auth.guard";
import { CurrentUser } from "../common/current-user.decorator";
import { ManualMeasurementsService } from "./manual-measurements.service";
import { CreateManualBenchmarkDto, SkipManualRunDto, SubmitManualEvidenceDto } from "./dto/manual-measurements.dto";

/**
 * M8C-R0 Manual Verified Measurement API。
 * 认证 + tenant scope + project ownership 全部在此层强制（跨 tenant → 404，未认证 → 401）。
 */
@Controller()
@UseGuards(AuthGuard)
export class ManualMeasurementsController {
  constructor(private readonly manual: ManualMeasurementsService) {}

  @Post("benchmark-suites/:id/manual-runs")
  @HttpCode(201)
  create(@CurrentUser() user: JwtUserPayload, @Param("id", ParseUUIDPipe) id: string, @Body() dto: CreateManualBenchmarkDto) {
    return this.manual.createManualBenchmark(user.sub, id, dto);
  }

  @Get("manual-runs/:id")
  workspace(@CurrentUser() user: JwtUserPayload, @Param("id", ParseUUIDPipe) id: string) {
    return this.manual.workspaceFor(user.sub, id);
  }

  @Post("runs/:id/manual-evidence")
  @HttpCode(201)
  submit(@CurrentUser() user: JwtUserPayload, @Param("id", ParseUUIDPipe) id: string, @Body() dto: SubmitManualEvidenceDto) {
    return this.manual.submitEvidence(user.sub, id, dto);
  }

  @Post("runs/:id/manual-skip")
  @HttpCode(200)
  skip(@CurrentUser() user: JwtUserPayload, @Param("id", ParseUUIDPipe) id: string, @Body() dto: SkipManualRunDto) {
    return this.manual.skipRun(user.sub, id, dto.reason);
  }
}
