import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from "@nestjs/common";
import { AuthGuard, JwtUserPayload } from "../common/auth.guard";
import { CurrentUser } from "../common/current-user.decorator";
import { ReportsService } from "./reports.service";
import { CreateReportDto } from "./dto/create-report.dto";
import { CompareReportsDto } from "./dto/compare-reports.dto";

/**
 * M6C Benchmark Report API（auth + tenant ownership + DB isolation）。
 * 注：@nestjs/swagger 为 ESM-only，只在 main.ts 运行时启用，模块图不引入装饰器。
 */
@Controller()
@UseGuards(AuthGuard)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  /** 为已完成的 BenchmarkRun 生成不可变 GEO 报告快照（同 run 允许多版本，不覆盖）。 */
  @Post("benchmark-runs/:id/reports")
  @HttpCode(201)
  createReport(
    @CurrentUser() user: JwtUserPayload,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: CreateReportDto,
  ) {
    return this.reports.createReport(user.sub, id, dto);
  }

  @Get("projects/:projectId/reports")
  listReports(@CurrentUser() user: JwtUserPayload, @Param("projectId", ParseUUIDPipe) projectId: string) {
    return this.reports.listReports(user.sub, projectId);
  }

  @Get("reports/:id")
  getReport(@CurrentUser() user: JwtUserPayload, @Param("id", ParseUUIDPipe) id: string) {
    return this.reports.getReport(user.sub, id);
  }

  /** Report → BenchmarkRun → Query → Run → Evidence 可追溯行。 */
  @Get("reports/:id/evidence")
  reportEvidence(@CurrentUser() user: JwtUserPayload, @Param("id", ParseUUIDPipe) id: string) {
    return this.reports.reportEvidence(user.sub, id);
  }

  /** 报告对比：先判定可比性（COMPARABLE / PARTIALLY_COMPARABLE / NOT_COMPARABLE），再给 Δ。 */
  @Post("reports/compare")
  compare(@CurrentUser() user: JwtUserPayload, @Body() dto: CompareReportsDto) {
    return this.reports.compare(user.sub, dto);
  }
}
